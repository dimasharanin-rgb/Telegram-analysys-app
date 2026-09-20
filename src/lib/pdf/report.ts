/**
 * Server-side PDF report.
 *
 * Drawn with pdfkit rather than printed from the browser, so the output is a
 * designed document: a typeset cover block, stat tiles, participant
 * comparisons drawn as bars, an activity chart and a word list.
 *
 * DejaVu Sans is embedded because the PDF standard-14 fonts cannot render
 * Cyrillic, and Telegram exports frequently are not Latin-only.
 */

import PDFDocument from "pdfkit";

import {
  CONTENT_WIDTH,
  MARGIN,
  PAGE,
  PALETTE,
  registerFonts,
  type Fonts,
} from "./fonts";
import type { PdfReportPayload } from "./payload";

/** Participant colours, in the same order the UI uses. */
const SERIES = ["#2563EB", "#0EA5E9", "#7C3AED", "#D97706"] as const;

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = seconds / 3600;
  return hours < 10 ? `${hours.toFixed(1)} hr` : `${Math.round(hours)} hr`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatDate(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

export function renderReportPdf(payload: PdfReportPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `Conversation analysis — ${payload.conversationTitle}`,
        Author: "Conversation Analyzer",
        Subject: "Telegram conversation statistics",
        Creator: "Conversation Analyzer",
      },
      autoFirstPage: true,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const fonts = registerFonts(doc);
      draw(doc, fonts, payload);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("PDF rendering failed"));
    }
  });
}

/* -------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------- */

function draw(doc: PDFKit.PDFDocument, fonts: Fonts, payload: PdfReportPayload): void {
  drawCover(doc, fonts, payload);
  drawSummaryTiles(doc, fonts, payload);
  drawParticipants(doc, fonts, payload);
  drawResponseSection(doc, fonts, payload);
  drawActivity(doc, fonts, payload);
  drawWords(doc, fonts, payload);
  drawOverview(doc, fonts, payload);
  drawMethodology(doc, fonts, payload);
  drawFooters(doc, fonts);
}

function sectionHeading(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  title: string,
  /** Height the section's content needs, so the heading travels with it. */
  contentHeight = 40,
): void {
  ensureSpace(doc, 34 + contentHeight);
  const y = doc.y;
  doc
    .font(fonts.bold)
    .fontSize(12)
    .fillColor(PALETTE.text)
    .text(title.toUpperCase(), MARGIN, y, { characterSpacing: 0.8 });
  doc
    .moveTo(MARGIN, doc.y + 6)
    .lineTo(MARGIN + CONTENT_WIDTH, doc.y + 6)
    .lineWidth(1)
    .strokeColor(PALETTE.border)
    .stroke();
  doc.y += 18;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE.height - MARGIN - 28) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

function drawCover(doc: PDFKit.PDFDocument, fonts: Fonts, payload: PdfReportPayload): void {
  doc.rect(0, 0, PAGE.width, 156).fill(PALETTE.primary);

  doc
    .font(fonts.bold)
    .fontSize(10)
    .fillColor("#BFDBFE")
    .text("CONVERSATION ANALYZER", MARGIN, 44, { characterSpacing: 1.4 });

  doc
    .font(fonts.bold)
    .fontSize(26)
    .fillColor("#FFFFFF")
    .text("Conversation analysis", MARGIN, 66, { width: CONTENT_WIDTH });

  doc
    .font(fonts.regular)
    .fontSize(11)
    .fillColor("#DBEAFE")
    .text(
      `${payload.conversationTitle}  ·  ${formatDate(payload.dateRange.start)} – ${formatDate(payload.dateRange.end)}`,
      MARGIN,
      102,
      { width: CONTENT_WIDTH },
    );

  const generated = Date.parse(payload.generatedAt);
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor("#BFDBFE")
    .text(
      `Report generated ${Number.isFinite(generated) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(generated)) : payload.generatedAt} UTC`,
      MARGIN,
      122,
      { width: CONTENT_WIDTH },
    );

  doc.y = 190;
}

function drawSummaryTiles(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  const tiles = [
    { label: "Total messages", value: formatNumber(payload.totals.messages) },
    { label: "Active days", value: formatNumber(payload.totals.activeDays) },
    { label: "Days covered", value: formatNumber(payload.dateRange.spanDays) },
    { label: "Conversations", value: formatNumber(payload.totals.conversations) },
  ];

  const gap = 12;
  const tileWidth = (CONTENT_WIDTH - gap * (tiles.length - 1)) / tiles.length;
  const top = doc.y;
  const height = 66;

  tiles.forEach((tile, index) => {
    const x = MARGIN + index * (tileWidth + gap);
    doc
      .roundedRect(x, top, tileWidth, height, 6)
      .fillAndStroke(PALETTE.surface, PALETTE.border);
    doc
      .font(fonts.bold)
      .fontSize(19)
      .fillColor(PALETTE.primary)
      .text(tile.value, x + 12, top + 14, { width: tileWidth - 24 });
    doc
      .font(fonts.regular)
      .fontSize(8.5)
      .fillColor(PALETTE.muted)
      .text(tile.label.toUpperCase(), x + 12, top + 42, {
        width: tileWidth - 24,
        characterSpacing: 0.5,
      });
  });

  doc.y = top + height + 10;
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(PALETTE.muted)
    .text(
      `${payload.totals.averagePerActiveDay} messages on an average active day · ${payload.totals.averageMessagesPerConversation} messages per conversation${payload.totals.mediaMessages > 0 ? ` · ${formatNumber(payload.totals.mediaMessages)} messages contain media, counted but not analysed` : ""}`,
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH },
    );
  doc.y += 22;
}

/** Two-tone proportion bar used for "who talks more" and "who starts". */
function drawShareBar(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  y: number,
  entries: { name: string; percent: number; color: string; detail: string }[],
): number {
  const barHeight = 16;
  let x = MARGIN;
  const total = entries.reduce((sum, entry) => sum + entry.percent, 0) || 100;

  entries.forEach((entry, index) => {
    const isLast = index === entries.length - 1;
    // The last slice absorbs rounding so the bar always fills its width.
    const width = isLast
      ? Math.max(2, MARGIN + CONTENT_WIDTH - x)
      : Math.max(2, (entry.percent / total) * CONTENT_WIDTH);
    doc.rect(x, y, width, barHeight).fill(entry.color);
    x += width;
  });

  doc
    .rect(MARGIN, y, CONTENT_WIDTH, barHeight)
    .lineWidth(0.5)
    .strokeColor(PALETTE.border)
    .stroke();

  let legendY = y + barHeight + 10;
  const columnWidth = CONTENT_WIDTH / Math.min(entries.length, 3);
  entries.slice(0, 6).forEach((entry, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const cx = MARGIN + column * columnWidth;
    const cy = legendY + row * 18;
    doc.circle(cx + 4, cy + 5, 4).fill(entry.color);
    doc
      .font(fonts.bold)
      .fontSize(9)
      .fillColor(PALETTE.text)
      .text(`${entry.name} ${entry.percent}%`, cx + 14, cy, {
        width: columnWidth - 20,
        continued: false,
      });
    doc
      .font(fonts.regular)
      .fontSize(8)
      .fillColor(PALETTE.muted)
      .text(entry.detail, cx + 14, cy + 10, { width: columnWidth - 20 });
  });

  legendY += Math.ceil(Math.min(entries.length, 6) / 3) * 22;
  return legendY;
}

function drawParticipants(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  sectionHeading(doc, fonts, "Who talks more", 110);

  const messageEntries = payload.participants.map((participant, index) => ({
    name: participant.name,
    percent: Math.round(participant.sharePercent * 10) / 10,
    color: SERIES[index % SERIES.length]!,
    detail: `${formatNumber(participant.messages)} messages`,
  }));
  doc.y = drawShareBar(doc, fonts, doc.y, messageEntries) + 12;

  sectionHeading(doc, fonts, "Who starts conversations", 110);

  const initiationEntries = payload.participants.map((participant, index) => ({
    name: participant.name,
    percent: Math.round(participant.initiationSharePercent * 10) / 10,
    color: SERIES[index % SERIES.length]!,
    detail: `${formatNumber(participant.initiations)} of ${formatNumber(payload.totals.conversations)} conversations`,
  }));
  doc.y = drawShareBar(doc, fonts, doc.y, initiationEntries) + 12;
}

function drawResponseSection(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  sectionHeading(doc, fonts, "Response time and message length", 40 + payload.participants.length * 26);

  const columns = [
    { label: "Participant", width: CONTENT_WIDTH * 0.34 },
    { label: "Median reply", width: CONTENT_WIDTH * 0.22 },
    { label: "Average reply", width: CONTENT_WIDTH * 0.22 },
    { label: "Avg. length", width: CONTENT_WIDTH * 0.22 },
  ];

  let x = MARGIN;
  const headerY = doc.y;
  columns.forEach((column) => {
    doc
      .font(fonts.bold)
      .fontSize(8.5)
      .fillColor(PALETTE.muted)
      .text(column.label.toUpperCase(), x, headerY, {
        width: column.width,
        characterSpacing: 0.4,
      });
    x += column.width;
  });

  let rowY = headerY + 16;
  doc
    .moveTo(MARGIN, rowY - 4)
    .lineTo(MARGIN + CONTENT_WIDTH, rowY - 4)
    .lineWidth(0.5)
    .strokeColor(PALETTE.border)
    .stroke();

  payload.participants.forEach((participant, index) => {
    const color = SERIES[index % SERIES.length]!;
    doc.circle(MARGIN + 4, rowY + 6, 4).fill(color);
    doc
      .font(fonts.bold)
      .fontSize(10)
      .fillColor(PALETTE.text)
      .text(participant.name, MARGIN + 14, rowY, { width: columns[0]!.width - 14 });

    let cx = MARGIN + columns[0]!.width;
    const values = [
      formatSeconds(participant.medianResponseSeconds),
      formatSeconds(participant.averageResponseSeconds),
      `${Math.round(participant.averageMessageCharacters)} chars`,
    ];
    values.forEach((value, valueIndex) => {
      const width = columns[valueIndex + 1]!.width;
      doc
        .font(fonts.regular)
        .fontSize(10)
        .fillColor(PALETTE.text)
        .text(value, cx, rowY, { width });
      cx += width;
    });

    rowY += 24;
  });

  doc.y = rowY + 6;
}

function drawActivity(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  if (payload.activity.length === 0) return;

  const chartHeight = 130;
  sectionHeading(doc, fonts, "Activity over time", chartHeight + 46);

  const top = doc.y;
  const max = Math.max(...payload.activity.map((point) => point.count), 1);
  const count = payload.activity.length;
  const slot = CONTENT_WIDTH / count;
  const barWidth = Math.max(1.5, Math.min(slot * 0.72, 22));

  // Baseline and a single mid gridline keep the chart readable without clutter.
  doc
    .moveTo(MARGIN, top + chartHeight / 2)
    .lineTo(MARGIN + CONTENT_WIDTH, top + chartHeight / 2)
    .lineWidth(0.5)
    .strokeColor(PALETTE.border)
    .stroke();

  payload.activity.forEach((point, index) => {
    const height = Math.max(1, (point.count / max) * chartHeight);
    const x = MARGIN + index * slot + (slot - barWidth) / 2;
    const y = top + chartHeight - height;
    doc.rect(x, y, barWidth, height).fill(PALETTE.primary);
  });

  doc
    .moveTo(MARGIN, top + chartHeight)
    .lineTo(MARGIN + CONTENT_WIDTH, top + chartHeight)
    .lineWidth(1)
    .strokeColor(PALETTE.border)
    .stroke();

  // Label a handful of positions rather than every bar.
  const labelStep = Math.max(1, Math.ceil(count / 6));
  doc.font(fonts.regular).fontSize(7.5).fillColor(PALETTE.muted);
  for (let index = 0; index < count; index += labelStep) {
    const point = payload.activity[index]!;
    const x = MARGIN + index * slot;
    doc.text(point.label, x, top + chartHeight + 6, {
      width: Math.max(slot * labelStep, 40),
      lineBreak: false,
    });
  }

  doc.y = top + chartHeight + 22;
  doc
    .font(fonts.regular)
    .fontSize(8.5)
    .fillColor(PALETTE.muted)
    .text(
      `Messages per ${payload.activityUnit}. Peak: ${formatNumber(max)}.`,
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH },
    );
  doc.y += 18;
}

function drawWords(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  if (payload.topWords.length === 0) return;

  sectionHeading(doc, fonts, "Most used words", 90);

  const maxCount = Math.max(...payload.topWords.map((entry) => entry.count), 1);
  let x = MARGIN;
  let y = doc.y;
  const height = 22;

  for (const entry of payload.topWords) {
    const label = `${entry.word}  ${entry.count}`;
    doc.font(fonts.regular).fontSize(9.5);
    const width = doc.widthOfString(label) + 22;

    if (x + width > MARGIN + CONTENT_WIDTH) {
      x = MARGIN;
      y += height + 8;
      ensureSpace(doc, height + 8);
    }

    // Weight the chip's fill by how common the word is.
    const intensity = entry.count / maxCount;
    doc
      .roundedRect(x, y, width, height, 11)
      .fillAndStroke(intensity > 0.55 ? PALETTE.primarySoft : PALETTE.surface, PALETTE.border);
    doc
      .font(fonts.regular)
      .fontSize(9.5)
      .fillColor(intensity > 0.55 ? PALETTE.primaryDark : PALETTE.text)
      .text(label, x + 11, y + 6.5, { lineBreak: false });

    x += width + 8;
  }

  doc.y = y + height + 18;
}

function drawOverview(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  if (!payload.overview) return;

  sectionHeading(doc, fonts, "AI overview", 120);

  const top = doc.y;
  doc.font(fonts.regular).fontSize(10).fillColor(PALETTE.text);
  const textHeight = doc.heightOfString(payload.overview.summary, {
    width: CONTENT_WIDTH - 32,
    lineGap: 3,
  });

  doc
    .roundedRect(MARGIN, top, CONTENT_WIDTH, textHeight + 54, 8)
    .fillAndStroke("#F0F7FF", PALETTE.border);

  doc
    .font(fonts.bold)
    .fontSize(8.5)
    .fillColor(PALETTE.primary)
    .text(`CONFIDENCE: ${payload.overview.confidence.toUpperCase()}`, MARGIN + 16, top + 14, {
      characterSpacing: 0.6,
    });

  doc
    .font(fonts.regular)
    .fontSize(10)
    .fillColor(PALETTE.text)
    .text(payload.overview.summary, MARGIN + 16, top + 32, {
      width: CONTENT_WIDTH - 32,
      lineGap: 3,
    });

  doc.y = top + textHeight + 54 + 16;
}

function drawMethodology(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  payload: PdfReportPayload,
): void {
  if (payload.methodology.length === 0) return;

  sectionHeading(doc, fonts, "How these numbers were calculated", 70);

  for (const note of payload.methodology) {
    doc.font(fonts.regular).fontSize(8.5).fillColor(PALETTE.muted);
    const height = doc.heightOfString(note, { width: CONTENT_WIDTH - 14, lineGap: 2 });
    ensureSpace(doc, height + 10);
    doc.circle(MARGIN + 2, doc.y + 5, 1.8).fill(PALETTE.muted);
    doc
      .font(fonts.regular)
      .fontSize(8.5)
      .fillColor(PALETTE.muted)
      .text(note, MARGIN + 14, doc.y, { width: CONTENT_WIDTH - 14, lineGap: 2 });
    doc.y += 8;
  }
}

function drawFooters(doc: PDFKit.PDFDocument, fonts: Fonts): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = PAGE.height - MARGIN - 14;
    doc
      .moveTo(MARGIN, y - 9)
      .lineTo(MARGIN + CONTENT_WIDTH, y - 9)
      .lineWidth(0.5)
      .strokeColor(PALETTE.border)
      .stroke();
    doc
      .font(fonts.regular)
      .fontSize(7.5)
      .fillColor(PALETTE.muted)
      .text(
        "Conversation Analyzer · statistics computed locally · AI commentary is interpretation, not fact",
        MARGIN,
        y,
        { width: CONTENT_WIDTH * 0.8, lineBreak: false },
      );
    doc
      .font(fonts.regular)
      .fontSize(7.5)
      .fillColor(PALETTE.muted)
      .text(`${index - range.start + 1} / ${range.count}`, MARGIN + CONTENT_WIDTH - 60, y, {
        width: 60,
        align: "right",
        lineBreak: false,
      });
  }
}
