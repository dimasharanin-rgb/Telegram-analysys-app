/**
 * POST /api/export/pdf
 *
 * Takes the compact report payload built from local statistics and returns a
 * designed PDF. Nothing is written to disk and nothing is retained: the
 * document is rendered into memory and streamed straight back.
 */

import { serverConfig } from "@/lib/config";
import { AppError, asAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { pdfReportSchema } from "@/lib/pdf/payload";
import { renderReportPdf } from "@/lib/pdf/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_REQUEST_BYTES = 512 * 1024;

export async function POST(request: Request): Promise<Response> {
  const config = serverConfig();

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_PDF_REQUEST_BYTES) {
      return jsonError(new AppError("TOO_LARGE"));
    }
    body = JSON.parse(text);
  } catch {
    return jsonError(badReportRequest());
  }

  const parsed = pdfReportSchema.safeParse(body);
  if (!parsed.success) {
    log.warn("pdf.invalid_request", {
      issue: parsed.error.issues[0]?.path.join(".") ?? "unknown",
    });
    return jsonError(badReportRequest());
  }

  try {
    const pdf = await renderReportPdf(parsed.data);
    log.info("pdf.rendered", { bytes: pdf.byteLength, debug: config.debug });

    const filename = `conversation-analysis-${parsed.data.dateRange.start}-to-${parsed.data.dateRange.end}.pdf`;
    // Uint8Array keeps this a plain BodyInit for the Response constructor.
    const bytes = new Uint8Array(pdf);

    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const appError = asAppError(error);
    log.error("pdf.failed", { detail: appError.message });
    return jsonError(new AppError("PDF_FAILED"));
  }
}

function badReportRequest(): AppError {
  return new AppError("INVALID_REQUEST", {
    message: "The report data was malformed and was rejected.",
    hint: "Reload the page and run the import again, or use the print fallback.",
  });
}

function jsonError(error: AppError): Response {
  return new Response(JSON.stringify({ error: error.toUserFacing() }), {
    status: error.status,
    headers: { "content-type": "application/json" },
  });
}
