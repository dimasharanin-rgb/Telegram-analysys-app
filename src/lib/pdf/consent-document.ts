/**
 * The consent document as a PDF.
 *
 * Both sides can download it: the participant as a copy of what they agreed
 * to, the requester as part of their record. It prints the document version,
 * the decision and the timestamp, and it says plainly what kind of record this
 * is — a consent record kept by the application, not a qualified electronic
 * signature.
 */

import PDFDocument from "pdfkit";

import {
  buildConsentDocument,
  type ConsentDocument,
  type ConsentDocumentInput,
} from "@/lib/consent/document";
import { CONSENT_STATUS_LABELS, type ConsentStatus } from "@/lib/consent/state";
import {
  CONTENT_WIDTH,
  MARGIN,
  PAGE,
  PALETTE,
  registerFonts,
  type Fonts,
} from "./fonts";

export interface ConsentPdfInput extends ConsentDocumentInput {
  consentId: string;
  status: ConsentStatus;
  createdAt: string;
  decidedAt: string | null;
  withdrawnAt: string | null;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(parsed))} UTC`;
}

export function renderConsentPdf(input: ConsentPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `Conversation Analysis Consent — ${input.participantName}`,
        Author: "Conversation Analyzer",
        Subject: "Consent record",
        Creator: "Conversation Analyzer",
      },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const fonts = registerFonts(doc);
      draw(doc, fonts, input, buildConsentDocument(input));
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Consent PDF failed"));
    }
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE.height - MARGIN - 34) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

function draw(
  doc: PDFKit.PDFDocument,
  fonts: Fonts,
  input: ConsentPdfInput,
  document: ConsentDocument,
): void {
  /* --- header ---------------------------------------------------------- */
  doc.rect(0, 0, PAGE.width, 128).fill(PALETTE.primary);
  doc
    .font(fonts.bold)
    .fontSize(9.5)
    .fillColor("#BFDBFE")
    .text("CONVERSATION ANALYZER", MARGIN, 40, { characterSpacing: 1.4 });
  doc
    .font(fonts.bold)
    .fontSize(22)
    .fillColor("#FFFFFF")
    .text(document.title, MARGIN, 60, { width: CONTENT_WIDTH });
  doc
    .font(fonts.regular)
    .fontSize(9.5)
    .fillColor("#DBEAFE")
    .text(
      `Consent record ${input.consentId} · document version ${document.version}`,
      MARGIN,
      94,
      { width: CONTENT_WIDTH },
    );

  doc.y = 156;

  /* --- decision panel -------------------------------------------------- */
  const panelTop = doc.y;
  const rows: [string, string][] = [
    ["Participant", input.participantName],
    ["Requested by", input.requestedByLabel],
    ["Decision", CONSENT_STATUS_LABELS[input.status]],
    ["Requested", formatDateTime(input.createdAt)],
    ["Decided", formatDateTime(input.decidedAt)],
  ];
  if (input.withdrawnAt) rows.push(["Withdrawn", formatDateTime(input.withdrawnAt)]);

  const panelHeight = 22 + rows.length * 18;
  doc
    .roundedRect(MARGIN, panelTop, CONTENT_WIDTH, panelHeight, 8)
    .fillAndStroke(PALETTE.surface, PALETTE.border);

  let rowY = panelTop + 14;
  for (const [label, value] of rows) {
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(PALETTE.muted)
      .text(label, MARGIN + 16, rowY, { width: 140 });
    doc
      .font(fonts.bold)
      .fontSize(9.5)
      .fillColor(PALETTE.text)
      .text(value, MARGIN + 160, rowY, { width: CONTENT_WIDTH - 176 });
    rowY += 18;
  }

  doc.y = panelTop + panelHeight + 20;

  /* --- sections -------------------------------------------------------- */
  for (const section of document.sections) {
    ensureSpace(doc, 60);
    doc
      .font(fonts.bold)
      .fontSize(11)
      .fillColor(PALETTE.text)
      .text(section.heading, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.y += 4;

    for (const paragraph of section.body) {
      doc.font(fonts.regular).fontSize(9.5).fillColor(PALETTE.text);
      const height = doc.heightOfString(paragraph, {
        width: CONTENT_WIDTH,
        lineGap: 2.5,
      });
      ensureSpace(doc, height + 8);
      doc.text(paragraph, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2.5 });
      doc.y += 6;
    }

    if (section.items) {
      for (const item of section.items) {
        ensureSpace(doc, 20);
        const y = doc.y;
        // A filled box for included, an outline for excluded: readable in
        // black and white, and unambiguous either way.
        doc
          .rect(MARGIN + 2, y + 1.5, 9, 9)
          .lineWidth(1)
          .fillAndStroke(item.included ? PALETTE.primary : "#FFFFFF", PALETTE.border);
        if (item.included) {
          doc
            .font(fonts.bold)
            .fontSize(7)
            .fillColor("#FFFFFF")
            .text("✓", MARGIN + 3.6, y + 3, { lineBreak: false });
        }
        doc
          .font(fonts.regular)
          .fontSize(9.5)
          .fillColor(item.included ? PALETTE.text : PALETTE.muted)
          .text(`${item.label} — ${item.value}`, MARGIN + 18, y, {
            width: CONTENT_WIDTH - 18,
          });
        doc.y = y + 16;
      }
      doc.y += 4;
    }

    doc.y += 8;
  }

  /* --- footers --------------------------------------------------------- */
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
        `Consent record ${input.consentId} · version ${document.version} · this is a consent record, not a qualified electronic signature`,
        MARGIN,
        y,
        { width: CONTENT_WIDTH * 0.85, lineBreak: false },
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
