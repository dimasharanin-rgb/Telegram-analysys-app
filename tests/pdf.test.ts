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
