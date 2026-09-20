/**
 * Shared pdfkit setup: the embedded font and the document palette.
 *
 * DejaVu Sans is embedded because the PDF standard-14 fonts cannot render
 * Cyrillic, and both the analysis report and the consent document may contain
 * names and message excerpts that are not Latin-only.
 */

import fs from "node:fs";
import path from "node:path";

export const PALETTE = {
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  primarySoft: "#DBEAFE",
  surface: "#F8FAFC",
  border: "#E2E8F0",
  text: "#0F172A",
  muted: "#64748B",
  accent: "#0EA5E9",
} as const;

export interface Fonts {
  regular: string;
  bold: string;
}

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

/**
 * Registers the embedded font, falling back to the built-in Helvetica when the
 * files are missing from a deployment. Latin text still renders in that case;
 * a missing font never fails a document.
 */
export function registerFonts(doc: PDFKit.PDFDocument): Fonts {
  try {
    const regular = path.join(FONT_DIR, "DejaVuSans.ttf");
    const bold = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
    if (fs.existsSync(regular) && fs.existsSync(bold)) {
      doc.registerFont("body", regular);
      doc.registerFont("bodyBold", bold);
      return { regular: "body", bold: "bodyBold" };
    }
  } catch {
    // fall through to the standard fonts
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold" };
}

export const PAGE = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 48;
export const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
