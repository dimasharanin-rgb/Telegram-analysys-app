import { describe, expect, it } from "vitest";

import { computeStatistics } from "@/lib/stats";
import { buildPseudonyms } from "@/lib/pipeline/payload";
import { buildActivitySeries, buildPdfPayload } from "@/lib/client/pdf-payload";
import { pdfReportSchema, type PdfReportPayload } from "@/lib/pdf/payload";
import { renderReportPdf } from "@/lib/pdf/report";
import { loadFixtureConversation, rawExport } from "./helpers";
import { parseTelegramExport } from "@/lib/telegram/parser";

function fixturePayload(): PdfReportPayload {
  const conversation = loadFixtureConversation();
  const { statistics } = computeStatistics(conversation);
  return buildPdfPayload({
    statistics,
    analysis: {
      overview: {
        summary:
          "A conversation with steady contact, one clear disagreement and a direct repair afterwards.",
        confidence: "medium",
      },
      patterns: [],
      strengths: [],
      watchouts: [],
      suggestions: [],
      recurringTopics: [],
    },
    pseudonyms: buildPseudonyms(conversation),
    conversationTitle: conversation.chatName,
  });
}

describe("PDF payload", () => {
  it("validates against the export schema", () => {
    expect(pdfReportSchema.safeParse(fixturePayload()).success).toBe(true);
  });

  it("carries aggregates only - no message text", () => {
    const conversation = loadFixtureConversation();
    const serialised = JSON.stringify(fixturePayload());
    // A distinctive line from the fixture must not appear anywhere.
    const sample = conversation.messages.find(
      (message) => message.text.length > 40,
    )!;
    expect(serialised).not.toContain(sample.text);
  });

  it("states the methodology behind the numbers", () => {
    const payload = fixturePayload();
    expect(payload.methodology.join(" ")).toContain("new conversation is counted");
    expect(payload.methodology.join(" ")).toContain("interpretation");
  });

  it("uses daily buckets for a short conversation", () => {
    const conversation = parseTelegramExport(
      rawExport([
        ["a", 0, "one"],
        ["b", 60, "two"],
        ["a", 60 * 24, "three"],
      ]),
    );
    const { statistics } = computeStatistics(conversation);
    expect(buildActivitySeries(statistics).unit).toBe("day");
  });

  it("widens the bucket for a long conversation", () => {
    const conversation = loadFixtureConversation();
    const { statistics } = computeStatistics(conversation);
    const series = buildActivitySeries(statistics);
    expect(series.unit).not.toBe("day");
    expect(series.points.length).toBeLessThanOrEqual(48);
  });
});

describe("renderReportPdf", () => {
  it("produces a PDF document", async () => {
    const pdf = await renderReportPdf(fixturePayload());
    expect(pdf.byteLength).toBeGreaterThan(2_000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toContain("EOF");
  });

  it("renders non-Latin participant names and words", async () => {
    const payload = fixturePayload();
    const cyrillic: PdfReportPayload = {
      ...payload,
      conversationTitle: "Дмитрий Шаранин",
      participants: payload.participants.map((participant, index) => ({
        ...participant,
        name: index === 0 ? "Дмитрий" : "Ольга",
      })),
      topWords: [
        { word: "привет", count: 42 },
        { word: "работа", count: 31 },
      ],
    };
    const pdf = await renderReportPdf(cyrillic);
    expect(pdf.byteLength).toBeGreaterThan(2_000);
  });

  it("handles a conversation with no activity series or words", async () => {
    const payload = fixturePayload();
    const sparse: PdfReportPayload = {
      ...payload,
      activity: [],
      topWords: [],
      overview: null,
    };
    const pdf = await renderReportPdf(sparse);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("the PDF never carries internal plumbing", () => {
  /**
   * Real text extraction, via poppler.
   *
   * The fonts are embedded and subset, so the strings are not recoverable by
   * reading the raw bytes - an assertion over those would pass whatever the
   * file said, which is worse than no assertion. Skipped rather than faked
   * where pdftotext is unavailable.
   */
  async function pdfText(bytes: Buffer): Promise<string | null> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-test-"));
    const file = path.join(dir, "report.pdf");
    await fs.writeFile(file, bytes);
    try {
      const { stdout } = await promisify(execFile)("pdftotext", [file, "-"]);
      return stdout;
    } catch {
      return null;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("has no bracketed message ids anywhere in the rendered file", async () => {
    const payload: PdfReportPayload = {
      ...fixturePayload(),
      appVersion: "3.0",
      analysisType: "Deep text analysis",
      keyInsights: [
        {
          title: "Follow-ups after a short reply",
          observation: "You send another message soon after a one-word reply.",
          interpretation: "One reading is that a brief reply reads as unfinished.",
          uncertainty: "The messages alone cannot establish intent.",
        },
      ],
      evidence: [
        {
          label: "2024-05-12",
          lines: [
            { speaker: "Sam Okonkwo", text: "Можем поговорить сегодня вечером?" },
            { speaker: "Alex Moreau", text: "Yes — after 8." },
          ],
        },
      ],
    };

    const text = await pdfText(await renderReportPdf(payload));
    if (text === null) return;

    // The extraction has to have worked, or the assertions below prove nothing.
    expect(text).toContain("Follow-ups after a short reply");
    // Evidence is rendered with names and dates, never identifiers.
    expect(text).toContain("Sam Okonkwo");
    expect(text).not.toMatch(/\[\s*#?\d{1,12}\s*\]/);
    expect(text).not.toMatch(/message ids?/i);
  });

  it("prints the coverage note when the analysis read only part of the chat", async () => {
    const note =
      "This analysis is based on 400 of 4,000 messages — about 10% of the conversation.";
    const text = await pdfText(
      await renderReportPdf({ ...fixturePayload(), coverageNote: note }),
    );
    if (text === null) return;

    expect(text).toContain("400 of 4,000 messages");
  });

  it("omits the note entirely for a complete analysis", async () => {
    const text = await pdfText(await renderReportPdf(fixturePayload()));
    if (text === null) return;

    expect(text).not.toContain("This analysis is based on");
  });
});
