import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  ConsentTransitionError,
  effectiveStatus,
  grantsPermission,
  isTerminal,
  CONSENT_STATUSES,
  type ConsentDataType,
} from "@/lib/consent/state";
import {
  buildConsentDocument,
  CONSENT_DOCUMENT_VERSION,
  versionDisclosesAudio,
  versionDisclosesImages,
} from "@/lib/consent/document";
import { AppError } from "@/lib/errors";
import { InternalConsentProvider } from "@/server/consent/provider";
import { evaluateConsentGate } from "@/server/consent/gate";
import {
  expireOverdue,
  findByToken,
  hashToken,
  listAudit,
  listConsentForConversation,
} from "@/server/repositories/consent";
import { listParticipants } from "@/server/repositories/conversations";
import { seedConversation, withTestDatabase } from "./support/db";

withTestDatabase();

function setup() {
  const { ownerId, conversation } = seedConversation();
  const participants = listParticipants(conversation.id);
  const other = participants.find((p) => !p.isSelf)!;
  const provider = new InternalConsentProvider();
  return { ownerId, conversation, other, provider };
}

function request(days = 14) {
  const { ownerId, conversation, other, provider } = setup();
  const created = provider.createRequest({
    ownerId,
    conversationId: conversation.id,
    participantId: other.id,
    requestedByLabel: "Sam Okonkwo",
    dataTypes: ["TEXT"],
    purpose: "Communication analysis.",
    aiProvider: "Anthropic (Claude)",
    validForDays: days,
  });
  return { ownerId, conversation, other, provider, created };
}

/* -------------------------------------------------------------------------
 * State machine
 * ---------------------------------------------------------------------- */

describe("consent state machine", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("PENDING", "VIEWED")).toBe(true);
    expect(canTransition("PENDING", "ACCEPTED")).toBe(true);
    expect(canTransition("VIEWED", "DECLINED")).toBe(true);
    expect(canTransition("ACCEPTED", "WITHDRAWN")).toBe(true);

    // Consent cannot come back from a decline, or be given twice.
    expect(canTransition("DECLINED", "ACCEPTED")).toBe(false);
    expect(canTransition("WITHDRAWN", "ACCEPTED")).toBe(false);
    expect(canTransition("EXPIRED", "ACCEPTED")).toBe(false);
    expect(canTransition("ACCEPTED", "DECLINED")).toBe(false);
  });

  it("throws rather than writing an illegal state", () => {
    expect(() => assertTransition("DECLINED", "ACCEPTED")).toThrowError(
      ConsentTransitionError,
    );
  });

  it("treats only ACCEPTED as permission", () => {
    for (const status of CONSENT_STATUSES) {
      expect(grantsPermission(status)).toBe(status === "ACCEPTED");
    }
  });

  it("marks decided states terminal apart from withdrawal of acceptance", () => {
    expect(isTerminal("ACCEPTED")).toBe(false);
    expect(isTerminal("DECLINED")).toBe(true);
    expect(isTerminal("WITHDRAWN")).toBe(true);
    expect(isTerminal("EXPIRED")).toBe(true);
  });

  it("expires at read time, not only when something writes it", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(effectiveStatus("PENDING", past)).toBe("EXPIRED");
    expect(effectiveStatus("PENDING", future)).toBe("PENDING");
    // A decision already made is not undone by the deadline passing.
    expect(effectiveStatus("ACCEPTED", past)).toBe("ACCEPTED");
  });
});

/* -------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------- */

describe("consent tokens", () => {
  it("stores only a hash of the token", () => {
    const { created, conversation } = request();
    const stored = listConsentForConversation(conversation.id)[0]!;
    expect(created.token.length).toBeGreaterThan(32);
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(findByToken(created.token)?.id).toBe(stored.id);
  });

  it("issues a different token every time", () => {
    const first = request().created.token;
    const second = request().created.token;
    expect(first).not.toBe(second);
    expect(hashToken(first)).not.toBe(hashToken(second));
  });

  it("does not resolve an unknown token", () => {
    request();
    expect(findByToken("not-a-real-token")).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Provider behaviour
 * ---------------------------------------------------------------------- */

describe("consent provider", () => {
  it("records a view once and then a decision", () => {
    const { created, provider } = request();

    expect(provider.markViewed(created.token).status).toBe("VIEWED");
    expect(provider.markViewed(created.token).status).toBe("VIEWED");

    const decided = provider.decide(created.token, "ACCEPTED");
    expect(decided.status).toBe("ACCEPTED");
    expect(decided.decidedAt).not.toBeNull();

    const events = listAudit(created.request.id).map((entry) => entry.event);
    expect(events).toEqual(["REQUESTED", "VIEWED", "ACCEPTED"]);
  });

  it("refuses a second decision on the same request", () => {
    const { created, provider } = request();
    provider.decide(created.token, "DECLINED");
    expect(() => provider.decide(created.token, "ACCEPTED")).toThrowError(AppError);
  });

  it("allows withdrawal after acceptance and records it", () => {
    const { created, provider } = request();
    provider.decide(created.token, "ACCEPTED");
    const withdrawn = provider.withdraw(created.token);

    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(listAudit(created.request.id).map((e) => e.event)).toContain("WITHDRAWN");
  });

  it("refuses withdrawal when nothing was accepted", () => {
    const { created, provider } = request();
    expect(() => provider.withdraw(created.token)).toThrowError(AppError);
  });

  it("refuses a decision after expiry, and records the expiry", () => {
    const { created, provider } = request();
    // Push the deadline into the past.
    expireOverdue(new Date(Date.now() + 40 * 24 * 3_600_000).toISOString());

    expect(() => provider.decide(created.token, "ACCEPTED")).toThrowError(AppError);
    expect(provider.getStatus(created.request.id)).toBe("EXPIRED");
    expect(listAudit(created.request.id).map((e) => e.event)).toContain("EXPIRED");
  });

  it("lets the requester revoke a request they sent", () => {
    const { created, provider, ownerId } = request();
    provider.decide(created.token, "ACCEPTED");
    const revoked = provider.revoke(created.request.id, ownerId);
    expect(revoked.status).toBe("WITHDRAWN");
  });

  it("does not let another owner revoke it", () => {
    const { created, provider } = request();
    expect(() => provider.revoke(created.request.id, "someone-else")).toThrowError(AppError);
  });

  it("never writes message content into the audit trail", () => {
    const { created, provider } = request();
    provider.decide(created.token, "ACCEPTED");
    const serialised = JSON.stringify(listAudit(created.request.id));
    expect(serialised).not.toContain("Okonkwo");
    expect(serialised.length).toBeLessThan(2_000);
  });
});

/* -------------------------------------------------------------------------
 * The gate
 * ---------------------------------------------------------------------- */

describe("consent gate", () => {
  it("blocks while the other participant has not been asked", () => {
    const { conversation } = setup();
    const gate = evaluateConsentGate(conversation.id);
    expect(gate.satisfied).toBe(false);
    expect(gate.blocking).toHaveLength(1);
    expect(gate.blocking[0]?.reason).toBe("NOT_REQUESTED");
  });

  it("does not require consent from the uploader", () => {
    const { conversation } = setup();
    const gate = evaluateConsentGate(conversation.id);
    const self = gate.requirements.find((r) => r.isSelf)!;
    expect(self.required).toBe(false);
    expect(self.satisfied).toBe(true);
  });

  it("stays blocked while the request is pending", () => {
    const { conversation } = request();
    expect(evaluateConsentGate(conversation.id).blocking[0]?.reason).toBe(
      "AWAITING_DECISION",
    );
  });

  it("opens once the participant agrees", () => {
    const { conversation, created, provider } = request();
    provider.decide(created.token, "ACCEPTED");
    const gate = evaluateConsentGate(conversation.id);
    expect(gate.satisfied).toBe(true);
    expect(gate.declined).toBe(false);
  });

  it("reports a decline distinctly from waiting", () => {
    const { conversation, created, provider } = request();
    provider.decide(created.token, "DECLINED");
    const gate = evaluateConsentGate(conversation.id);
    expect(gate.satisfied).toBe(false);
    expect(gate.declined).toBe(true);
  });

  it("closes again when consent is withdrawn", () => {
    const { conversation, created, provider } = request();
    provider.decide(created.token, "ACCEPTED");
    expect(evaluateConsentGate(conversation.id).satisfied).toBe(true);

    provider.withdraw(created.token);
    const gate = evaluateConsentGate(conversation.id);
    expect(gate.satisfied).toBe(false);
    expect(gate.blocking[0]?.reason).toBe("WITHDRAWN");
  });

  it("lets an acceptance stand when a second request is sent afterwards", () => {
    const { conversation, created, provider, ownerId, other } = request();
    provider.decide(created.token, "ACCEPTED");

    provider.createRequest({
      ownerId,
      conversationId: conversation.id,
      participantId: other.id,
      requestedByLabel: "Sam Okonkwo",
      dataTypes: ["TEXT"],
      purpose: "Communication analysis.",
      aiProvider: "Anthropic (Claude)",
      validForDays: 14,
    });

    expect(evaluateConsentGate(conversation.id).satisfied).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Document
 * ---------------------------------------------------------------------- */

describe("consent document", () => {
  const document = buildConsentDocument({
    participantName: "Alex Moreau",
    requestedByLabel: "Sam Okonkwo",
    conversationTitle: "Alex Moreau",
    messageCount: 1200,
    dateRange: { start: "2024-01-09", end: "2024-08-08" },
    dataTypes: ["TEXT"],
    purpose: "Communication analysis.",
    aiProvider: "Anthropic (Claude)",
    expiresAt: "2024-09-01T00:00:00.000Z",
  });

  it("is versioned", () => {
    expect(document.version).toBe(CONSENT_DOCUMENT_VERSION);
  });

  it("marks unrequested data types as excluded", () => {
    const section = document.sections.find((s) => s.heading.startsWith("2."))!;
    const included = section.items!.filter((item) => item.included).map((i) => i.label);
    expect(included).toEqual(["Text messages"]);
    expect(section.items!.filter((item) => !item.included)).toHaveLength(3);
  });

  it("covers purpose, AI processing, retention, withdrawal and consequences", () => {
    const headings = document.sections.map((s) => s.heading).join(" ");
    for (const required of [
      "Purpose",
      "AI processing",
      "Retention",
      "Withdrawal",
      "Consequences",
    ]) {
      expect(headings).toContain(required);
    }
  });

  it("does not claim to be a legal signature", () => {
    const text = JSON.stringify(document).toLowerCase();
    expect(text).toContain("not a qualified electronic signature");
    expect(text).not.toContain("legally binding");
    expect(text).not.toContain("gdpr compliant");
  });
});

/* -------------------------------------------------------------------------
 * Media scope
 * ---------------------------------------------------------------------- */

describe("consent scope is per content type", () => {
  function requestWith(dataTypes: ConsentDataType[]) {
    const { ownerId, conversation, other, provider } = setup();
    const created = provider.createRequest({
      ownerId,
      conversationId: conversation.id,
      participantId: other.id,
      requestedByLabel: "Sam Okonkwo",
      dataTypes,
      purpose: "Communication analysis.",
      aiProvider: "Anthropic (Claude)",
      validForDays: 14,
    });
    return { conversation, provider, created };
  }

  it("reports nothing consented while a decision is outstanding", () => {
    const { conversation } = requestWith(["TEXT", "IMAGES"]);
    expect(evaluateConsentGate(conversation.id).consentedDataTypes).toEqual([]);
  });

  it("reports exactly what was agreed to", () => {
    const { conversation, provider, created } = requestWith(["TEXT", "IMAGES", "AUDIO"]);
    provider.decide(created.token, "ACCEPTED");

    const gate = evaluateConsentGate(conversation.id);
    expect(gate.satisfied).toBe(true);
    expect(gate.consentedDataTypes.sort()).toEqual(["AUDIO", "IMAGES", "TEXT"]);
  });

  it("does not infer media consent from consent to analyse text", () => {
    // Section 33: agreeing to have words read is not agreeing to have
    // photographs opened.
    const { conversation, provider, created } = requestWith(["TEXT"]);
    provider.decide(created.token, "ACCEPTED");

    const gate = evaluateConsentGate(conversation.id);
    expect(gate.satisfied).toBe(true);
    expect(gate.consentedDataTypes).toEqual(["TEXT"]);
    expect(gate.consentedDataTypes).not.toContain("IMAGES");
  });

  it("drops a content type as soon as consent is withdrawn", () => {
    const { conversation, provider, created } = requestWith(["TEXT", "IMAGES"]);
    provider.decide(created.token, "ACCEPTED");
    expect(evaluateConsentGate(conversation.id).consentedDataTypes).toContain("IMAGES");

    provider.withdraw(created.token);
    expect(evaluateConsentGate(conversation.id).consentedDataTypes).toEqual([]);
  });
});

describe("the document is what a participant relied on", () => {
  it("describes media processing when the request covers it", () => {
    const document = buildConsentDocument({
      participantName: "Alex",
      requestedByLabel: "Sam",
      conversationTitle: "Alex and Sam",
      messageCount: 1_200,
      dateRange: { start: "2024-01-01", end: "2024-06-01" },
      expiresAt: "2024-07-01T00:00:00.000Z",
      dataTypes: ["TEXT", "IMAGES", "AUDIO"],
      purpose: "Communication analysis.",
      aiProvider: "Anthropic (Claude)",
    });
    const scope = document.sections.find((s) => s.heading.includes("Processing scope"))!;
    const text = scope.body.join(" ");

    expect(text).toContain("checked automatically for sensitive content");
    expect(text).toContain("transcribed");
    // The old blanket promise must be gone once images are in scope.
    expect(text).not.toContain("Photos and images are counted. They are never opened");
  });

  it("still promises attachments are untouched when they are not in scope", () => {
    const document = buildConsentDocument({
      participantName: "Alex",
      requestedByLabel: "Sam",
      conversationTitle: "Alex and Sam",
      messageCount: 1_200,
      dateRange: { start: "2024-01-01", end: "2024-06-01" },
      expiresAt: "2024-07-01T00:00:00.000Z",
      dataTypes: ["TEXT"],
      purpose: "Communication analysis.",
      aiProvider: "Anthropic (Claude)",
    });
    const text = document.sections
      .find((s) => s.heading.includes("Processing scope"))!
      .body.join(" ");

    expect(text).toContain("never opened or sent");
    expect(text).not.toContain("transcribed");
  });

  it("never claims video is analysed, even when a request lists it", () => {
    const document = buildConsentDocument({
      participantName: "Alex",
      requestedByLabel: "Sam",
      conversationTitle: "Alex and Sam",
      messageCount: 1_200,
      dateRange: { start: "2024-01-01", end: "2024-06-01" },
      expiresAt: "2024-07-01T00:00:00.000Z",
      dataTypes: ["TEXT", "IMAGES", "AUDIO", "VIDEO"],
      purpose: "Communication analysis.",
      aiProvider: "Anthropic (Claude)",
    });
    const text = document.sections
      .find((s) => s.heading.includes("Processing scope"))!
      .body.join(" ");

    expect(text).toContain("Videos are counted. They are never opened or sent.");
  });

  it("says attachments are deleted once the report exists", () => {
    const document = buildConsentDocument({
      participantName: "Alex",
      requestedByLabel: "Sam",
      conversationTitle: "Alex and Sam",
      messageCount: 1_200,
      dateRange: { start: "2024-01-01", end: "2024-06-01" },
      expiresAt: "2024-07-01T00:00:00.000Z",
      dataTypes: ["TEXT", "IMAGES"],
      purpose: "Communication analysis.",
      aiProvider: "Anthropic (Claude)",
    });
    const text = document.sections
      .find((s) => s.heading.includes("Processing scope"))!
      .body.join(" ");
    expect(text).toContain("deleted once the report has been produced");
  });

  it("does not let an older consent authorise media it was never told about", () => {
    // 1.0 said attachments were never opened. Someone who agreed to that
    // agreed to a text analysis, whatever the stored data types say.
    expect(versionDisclosesImages("1.0")).toBe(false);
    expect(versionDisclosesAudio("1.0")).toBe(false);
  });

  it("gates images and audio on the version that actually disclosed each", () => {
    // 1.1 described image handling and named the processor, but said only that
    // voice messages go to "a speech-to-text service" - not which one. This
    // application names its text processor explicitly, so it cannot treat the
    // audio one as immaterial.
    expect(versionDisclosesImages("1.1")).toBe(true);
    expect(versionDisclosesAudio("1.1")).toBe(false);

    expect(versionDisclosesImages("1.2")).toBe(true);
    expect(versionDisclosesAudio("1.2")).toBe(true);
  });

  it("covers both at the current version", () => {
    expect(versionDisclosesImages(CONSENT_DOCUMENT_VERSION)).toBe(true);
    expect(versionDisclosesAudio(CONSENT_DOCUMENT_VERSION)).toBe(true);
  });

  it("compares versions numerically, not as strings", () => {
    // "1.10" is later than "1.9"; a string comparison would say otherwise.
    expect(versionDisclosesAudio("1.10")).toBe(true);
    expect(versionDisclosesAudio("0.9")).toBe(false);
    expect(versionDisclosesAudio("2.0")).toBe(true);
  });
});

describe("the transcription processor is named, not implied", () => {
  const base = {
    participantName: "Alex",
    requestedByLabel: "Sam",
    conversationTitle: "Alex and Sam",
    messageCount: 1_200,
    dateRange: { start: "2024-01-01", end: "2024-06-01" },
    expiresAt: "2024-07-01T00:00:00.000Z",
    purpose: "Communication analysis.",
    aiProvider: "Anthropic (Claude)",
  };

  function processing(dataTypes: ConsentDataType[], transcriptionProvider?: string) {
    const document = buildConsentDocument({
      ...base,
      dataTypes,
      ...(transcriptionProvider ? { transcriptionProvider } : {}),
    });
    return document.sections
      .find((section) => section.heading.includes("AI processing"))!
      .body.join(" ");
  }

  it("names the speech-to-text company when audio is in scope", () => {
    const text = processing(["TEXT", "AUDIO"], "AssemblyAI");
    expect(text).toContain("AssemblyAI");
    expect(text).toContain("receives the audio itself");
  });

  it("says the transcript may then reach the text processor and the report", () => {
    const text = processing(["TEXT", "AUDIO"], "AssemblyAI");
    expect(text).toContain("Anthropic (Claude)");
    expect(text).toContain("quoted in the report");
  });

  it("names nobody when no audio is being sent", () => {
    const text = processing(["TEXT", "IMAGES"], "AssemblyAI");
    expect(text).not.toContain("AssemblyAI");
    expect(text).not.toContain("speech-to-text");
  });

  it("degrades to a generic description rather than naming the wrong company", () => {
    // An older consent record has no stored transcription provider. Filling it
    // in from current configuration would claim a disclosure that was never
    // made to that participant.
    const text = processing(["TEXT", "AUDIO"]);
    expect(text).toContain("a speech-to-text provider");
    expect(text).not.toContain("AssemblyAI");
  });
});
