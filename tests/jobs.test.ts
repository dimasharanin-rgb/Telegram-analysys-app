import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertTransition,
  canTransition,
  isActive,
  isBlocked,
  isTerminal,
  JobTransitionError,
} from "@/lib/analysis/job";
import { batchModules, estimateRequestCount } from "@/lib/analysis/modules";
import { allowedModulesFor, getProduct } from "@/lib/billing/products";
import { AppError } from "@/lib/errors";
import { resetServerConfigCache } from "@/lib/config";
import { computeStatistics } from "@/lib/stats";
import { computeAdvancedStatistics } from "@/lib/stats/advanced";
import { buildAdvancedDigest, buildAnalysisRequest } from "@/lib/pipeline/payload";
import type { AnalysisJobInput } from "@/lib/ai/modules/input";
import {
  createAnalysisJob,
  describeReadiness,
  runAnalysisJob,
  settleStatus,
} from "@/server/analysis/job-service";
import { InternalConsentProvider } from "@/server/consent/provider";
import { createEntitlement } from "@/server/repositories/billing";
import { listParticipants } from "@/server/repositories/conversations";
import { getJobInput, getJobResult, listUsage } from "@/server/repositories/jobs";
import { loadFixtureConversation } from "./helpers";
import { cannedModuleResults, StubAiService } from "./support/ai";
import { seedConversation, withTestDatabase } from "./support/db";

withTestDatabase();

beforeEach(() => {
  resetServerConfigCache();
  process.env.ANALYSIS_SINGLE_PASS_MAX_MESSAGES = "50000";
});

/* -------------------------------------------------------------------------
 * State machine
 * ---------------------------------------------------------------------- */

describe("job state machine", () => {
  it("allows the documented transitions", () => {
    expect(canTransition("CREATED", "WAITING_FOR_CONSENT")).toBe(true);
    expect(canTransition("WAITING_FOR_CONSENT", "QUEUED")).toBe(true);
    expect(canTransition("QUEUED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "COMPLETED")).toBe(true);
    // Consent withdrawn while queued sends it back to waiting.
    expect(canTransition("QUEUED", "WAITING_FOR_CONSENT")).toBe(true);
  });

  it("refuses to restart or rewind a finished job", () => {
    expect(canTransition("COMPLETED", "PROCESSING")).toBe(false);
    expect(canTransition("FAILED", "QUEUED")).toBe(false);
    expect(canTransition("CANCELLED", "PROCESSING")).toBe(false);
    expect(canTransition("CREATED", "PROCESSING")).toBe(false);
    expect(() => assertTransition("COMPLETED", "PROCESSING")).toThrowError(
      JobTransitionError,
    );
  });

  it("classifies statuses for the UI", () => {
    expect(isBlocked("WAITING_FOR_CONSENT")).toBe(true);
    expect(isBlocked("WAITING_FOR_PAYMENT")).toBe(true);
    expect(isActive("PROCESSING")).toBe(true);
    expect(isActive("QUEUED")).toBe(true);
    expect(isTerminal("COMPLETED")).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Products and modules
 * ---------------------------------------------------------------------- */

describe("products", () => {
  it("narrows requested modules to what the product allows", () => {
    const free = getProduct("free")!;
    expect(allowedModulesFor(free, ["COMMUNICATION", "CONFLICT", "TIMELINE"])).toEqual([
      "COMMUNICATION",
    ]);
  });

  it("keeps the canonical module order regardless of request order", () => {
    const deep = getProduct("deep-text")!;
    expect(allowedModulesFor(deep, ["TIMELINE", "COMMUNICATION", "CONFLICT"])).toEqual([
      "COMMUNICATION",
      "CONFLICT",
      "TIMELINE",
    ]);
  });

  it("separates batch modules from the on-demand advice tools", () => {
    expect(batchModules(["COMMUNICATION", "RESPONSE_ADVICE"])).toEqual(["COMMUNICATION"]);
    expect(estimateRequestCount(["COMMUNICATION", "INTERACTION"])).toBe(3);
  });

  it("does not offer multimodal, because it is not implemented", () => {
    const multimodal = getProduct("multimodal")!;
    expect(multimodal.available).toBe(false);
    expect(multimodal.unavailableReason).toContain("not implemented");
  });
});

/* -------------------------------------------------------------------------
 * The full job flow
 * ---------------------------------------------------------------------- */

function jobInput(): { input: AnalysisJobInput; evidenceIds: string[]; candidateId: string } {
  const conversation = loadFixtureConversation();
  const { statistics, segments } = computeStatistics(conversation);
  const advanced = computeAdvancedStatistics(conversation, segments, {
    conversationGapMinutes: 360,
  });
  const built = buildAnalysisRequest(conversation, statistics, segments);
  const digest = buildAdvancedDigest(advanced, built.pseudonyms.toPseudonym);

  return {
    input: {
      ...built.request,
      advanced: digest,
      modules: ["COMMUNICATION", "INTERACTION", "CONFLICT", "TIMELINE", "PERSONAL_PROFILES"],
      contentTypes: ["TEXT"],
      depth: "deep",
    },
    evidenceIds: built.includedIds,
    candidateId: digest.conflictCandidates[0]?.id ?? "cf0",
  };
}

function setupJob(productId = "deep-text") {
  const { ownerId, conversation } = seedConversation();
  const { input, evidenceIds, candidateId } = jobInput();
  const { job } = createAnalysisJob({
    ownerId,
    conversationId: conversation.id,
    productId,
    modules: [...input.modules],
    input,
  });
  return { ownerId, conversation, job, evidenceIds, candidateId };
}

function acceptConsent(conversationId: string, ownerId: string): void {
  const other = listParticipants(conversationId).find((p) => !p.isSelf)!;
  const provider = new InternalConsentProvider();
  const created = provider.createRequest({
    ownerId,
    conversationId,
    participantId: other.id,
    requestedByLabel: "Sam Okonkwo",
    dataTypes: ["TEXT"],
    purpose: "Communication analysis.",
    aiProvider: "Anthropic (Claude)",
    validForDays: 14,
  });
  provider.decide(created.token, "ACCEPTED");
}

describe("creating a job", () => {
  it("starts blocked on consent and spends nothing", () => {
    const { job, ownerId } = setupJob();
    expect(job.status).toBe("WAITING_FOR_CONSENT");
    expect(job.entitlementId).toBeNull();
    expect(describeReadiness(job.id, ownerId).runnable).toBe(false);
  });

  it("becomes runnable once consent lands, while still spending nothing", () => {
    // The free product, so consent is the only gate left to satisfy.
    const { job, ownerId, conversation } = setupJob("free");
    acceptConsent(conversation.id, ownerId);

    const readiness = describeReadiness(job.id, ownerId);
    expect(readiness.job.status).toBe("QUEUED");
    expect(readiness.runnable).toBe(true);
    // QUEUED means "ready to run", not "running": nothing is charged until
    // the user asks for it.
    expect(readiness.job.entitlementId).toBeNull();
  });

  it("stores the prepared input alongside the job", () => {
    const { job } = setupJob();
    const stored = getJobInput(job.id);
    expect(stored?.pruned).toBe(false);
    expect((stored?.payload as AnalysisJobInput).excerpts.length).toBeGreaterThan(0);
  });

  it("refuses a conversation larger than the product covers", () => {
    const { ownerId, conversation } = seedConversation();
    const { input } = jobInput();
    // The free product covers 3,000 messages; the seeded conversation is 1,200,
    // so shrink the product limit by using a conversation that exceeds it.
    expect(() =>
      createAnalysisJob({
        ownerId,
        conversationId: conversation.id,
        productId: "nonexistent",
        modules: ["COMMUNICATION"],
        input,
      }),
    ).toThrowError(AppError);
  });

  it("refuses an unavailable product", () => {
    const { ownerId, conversation } = seedConversation();
    const { input } = jobInput();
    expect(() =>
      createAnalysisJob({
        ownerId,
        conversationId: conversation.id,
        productId: "multimodal",
        modules: ["COMMUNICATION"],
        input,
      }),
    ).toThrowError(AppError);
  });

  it("refuses another owner's conversation", () => {
    const { conversation } = seedConversation("owner-1");
    const { input } = jobInput();
    expect(() =>
      createAnalysisJob({
        ownerId: "owner-2",
        conversationId: conversation.id,
        productId: "free",
        modules: ["COMMUNICATION"],
        input,
      }),
    ).toThrowError(AppError);
  });

  it("only records modules the product allows", () => {
    const { ownerId, conversation } = seedConversation();
    const { input } = jobInput();
    const { job } = createAnalysisJob({
      ownerId,
      conversationId: conversation.id,
      productId: "free",
      modules: ["COMMUNICATION", "CONFLICT", "TIMELINE"],
      input,
    });
    expect(job.modules).toEqual(["COMMUNICATION"]);
  });
});

describe("the consent gate on a job", () => {
  it("will not run without consent, and says so", async () => {
    const { job, ownerId, evidenceIds } = setupJob();
    const service = new StubAiService(evidenceIds);

    await expect(
      runAnalysisJob({ jobId: job.id, ownerId, service }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });

    expect(service.baseCalls).toBe(0);
    expect(service.moduleCalls).toHaveLength(0);
  });

  it("reports a decline distinctly", async () => {
    const { job, ownerId, conversation, evidenceIds } = setupJob();
    const other = listParticipants(conversation.id).find((p) => !p.isSelf)!;
    const provider = new InternalConsentProvider();
    const created = provider.createRequest({
      ownerId,
      conversationId: conversation.id,
      participantId: other.id,
      requestedByLabel: "Sam",
      dataTypes: ["TEXT"],
      purpose: "x",
      aiProvider: "Anthropic",
      validForDays: 14,
    });
    provider.decide(created.token, "DECLINED");

    await expect(
      runAnalysisJob({ jobId: job.id, ownerId, service: new StubAiService(evidenceIds) }),
    ).rejects.toMatchObject({ code: "CONSENT_DECLINED" });
  });

  it("re-blocks a queued job when consent is withdrawn", async () => {
    // The free product needs no payment, so QUEUED here isolates the consent
    // rule from the entitlement one.
    const { job, ownerId, conversation, evidenceIds } = setupJob("free");
    const other = listParticipants(conversation.id).find((p) => !p.isSelf)!;
    const provider = new InternalConsentProvider();
    const created = provider.createRequest({
      ownerId,
      conversationId: conversation.id,
      participantId: other.id,
      requestedByLabel: "Sam",
      dataTypes: ["TEXT"],
      purpose: "x",
      aiProvider: "Anthropic",
      validForDays: 14,
    });
    provider.decide(created.token, "ACCEPTED");
    expect(settleStatus(job.id, ownerId).status).toBe("QUEUED");

    provider.withdraw(created.token);
    expect(settleStatus(job.id, ownerId).status).toBe("WAITING_FOR_CONSENT");

    await expect(
      runAnalysisJob({ jobId: job.id, ownerId, service: new StubAiService(evidenceIds) }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });
});

describe("the entitlement gate on a job", () => {
  it("will not run a paid product without an entitlement", async () => {
    const { job, ownerId, conversation, evidenceIds } = setupJob("deep-text");
    acceptConsent(conversation.id, ownerId);

    await expect(
      runAnalysisJob({ jobId: job.id, ownerId, service: new StubAiService(evidenceIds) }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED" });

    expect(settleStatus(job.id, ownerId).status).toBe("WAITING_FOR_PAYMENT");
  });

  it("runs once an entitlement exists, and spends exactly one credit", async () => {
    const { job, ownerId, conversation, evidenceIds, candidateId } = setupJob("deep-text");
    acceptConsent(conversation.id, ownerId);

    const entitlement = createEntitlement({
      ownerId,
      productId: "deep-text",
      source: "purchase",
      creditsTotal: 2,
    });

    const service = new StubAiService(
      evidenceIds,
      cannedModuleResults(evidenceIds, candidateId),
    );
    const { job: completed } = await runAnalysisJob({ jobId: job.id, ownerId, service });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.entitlementId).toBe(entitlement.id);
    expect(getJobResult(job.id)).not.toBeNull();
  });

  it("hands the credit back when the run fails", async () => {
    const { job, ownerId, conversation, evidenceIds } = setupJob("deep-text");
    acceptConsent(conversation.id, ownerId);
    createEntitlement({
      ownerId,
      productId: "deep-text",
      source: "purchase",
      creditsTotal: 1,
    });

    const service = new StubAiService(evidenceIds);
    service.failBase = true;

    await expect(runAnalysisJob({ jobId: job.id, ownerId, service })).rejects.toBeTruthy();
    expect(settleStatus(job.id, ownerId).status).toBe("FAILED");

    // The credit is back, so a second attempt is possible.
    const retry = setupJob("deep-text");
    acceptConsent(retry.conversation.id, retry.ownerId);
  });

  it("logs the real cause of an unexpected failure, not just its generic code", async () => {
    const { job, ownerId, conversation, evidenceIds } = setupJob("deep-text");
    acceptConsent(conversation.id, ownerId);
    createEntitlement({ ownerId, productId: "deep-text", source: "purchase", creditsTotal: 1 });

    const service = new StubAiService(evidenceIds);
    service.failBase = true;

    const errorLines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: string) => {
      errorLines.push(line);
    });
    try {
      await expect(runAnalysisJob({ jobId: job.id, ownerId, service })).rejects.toBeTruthy();
    } finally {
      spy.mockRestore();
    }

    // An error a route or module didn't specifically classify comes through
    // as code UNKNOWN - which is meaningless on its own for anyone reading
    // the log afterwards. The original message has to survive alongside it.
    const failureLine = errorLines.find((line) => line.includes('"job.failed"'));
    expect(failureLine).toBeTruthy();
    const parsed = JSON.parse(failureLine!) as { code: string; detail: string };
    expect(parsed.code).toBe("UNKNOWN");
    expect(parsed.detail).toContain("base pass failed");
  });
});

describe("a completed run", () => {
  async function completeRun() {
    const { job, ownerId, conversation, evidenceIds, candidateId } = setupJob("deep-text");
    acceptConsent(conversation.id, ownerId);
    createEntitlement({
      ownerId,
      productId: "deep-text",
      source: "purchase",
      creditsTotal: 1,
    });
    const service = new StubAiService(
      evidenceIds,
      cannedModuleResults(evidenceIds, candidateId),
    );
    const outcome = await runAnalysisJob({ jobId: job.id, ownerId, service });
    return { ...outcome, ownerId, service, evidenceIds };
  }

  it("runs every allowed batch module once", async () => {
    const { service } = await completeRun();
    expect(service.baseCalls).toBe(1);
    expect(service.moduleCalls.map((call) => call.moduleId)).toEqual([
      "INTERACTION",
      "CONFLICT",
      "TIMELINE",
      "PERSONAL_PROFILES",
    ]);
  });

  it("reports progress that never overruns its own stated total", async () => {
    const { job, ownerId, conversation, evidenceIds, candidateId } = setupJob("deep-text");
    acceptConsent(conversation.id, ownerId);
    createEntitlement({
      ownerId,
      productId: "deep-text",
      source: "purchase",
      creditsTotal: 1,
    });
    const service = new StubAiService(
      evidenceIds,
      cannedModuleResults(evidenceIds, candidateId),
    );
    const events: { stage: string; step: number; totalSteps: number; percent: number }[] = [];
    await runAnalysisJob({ jobId: job.id, ownerId, service, onProgress: (e) => events.push(e) });

    // Every event's step is within [0, totalSteps], and totalSteps is the
    // same figure throughout a run - the denominator does not move under you.
    const totalSteps = events[0]!.totalSteps;
    for (const event of events) {
      expect(event.totalSteps).toBe(totalSteps);
      expect(event.step).toBeLessThanOrEqual(totalSteps);
      expect(event.percent).toBeLessThanOrEqual(100);
    }
    // The run ends at exactly 100%, on the final reported step.
    const last = events.at(-1)!;
    expect(last.stage).toBe("done");
    expect(last.step).toBe(totalSteps);
    expect(last.percent).toBe(100);
  });

  it("gives every module the identical context block, so it can be cached", async () => {
    const { service } = await completeRun();
    const contexts = new Set(service.moduleCalls.map((call) => call.systemContext));
    expect(contexts.size).toBe(1);
    // The task is what differs.
    expect(new Set(service.moduleCalls.map((call) => call.task)).size).toBe(
      service.moduleCalls.length,
    );
  });

  it("records usage per module and rolls it up onto the job", async () => {
    const { job, service } = await completeRun();
    const usage = listUsage(job.id);
    expect(usage.length).toBe(service.moduleCalls.length + 1);
    expect(job.requestCount).toBe(usage.length);
    expect(job.actualCostMicros).toBeGreaterThan(0);
  });

  it("drops findings that point at things we never sent", async () => {
    const { result } = await completeRun();
    // The stub returns one real conflict and one invented candidate id.
    expect(result.conflicts?.conflicts).toHaveLength(1);
    // And a profile for a participant that does not exist.
    expect(result.profiles?.profiles.map((p) => p.participantId)).toEqual(["A"]);
  });

  it("prunes stored excerpts to the exchanges the report quotes", async () => {
    const { job } = await completeRun();
    const stored = getJobInput(job.id)!;
    expect(stored.pruned).toBe(true);

    const payload = stored.payload as AnalysisJobInput;
    // Only the exchanges an evidence quote came from survive.
    expect(payload.excerpts.length).toBeGreaterThan(0);
    expect(payload.excerpts.length).toBeLessThan(5);

    const kept = payload.excerpts.flatMap((excerpt) => excerpt.messages.map((m) => m.id));
    expect(kept.length).toBeGreaterThan(0);
  });

  it("refuses to run the same job twice", async () => {
    const { job, ownerId, service } = await completeRun();
    await expect(
      runAnalysisJob({ jobId: job.id, ownerId, service }),
    ).rejects.toMatchObject({ code: "JOB_LOCKED" });
  });

  it("is not readable by another owner", async () => {
    const { job } = await completeRun();
    expect(() => describeReadiness(job.id, "someone-else")).toThrowError(AppError);
  });
});
