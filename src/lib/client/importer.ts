/**
 * Browser-side import: file → parsed conversation → local statistics.
 *
 * Runs in a worker when the browser has one, and falls back to the main thread
 * otherwise, so the flow never depends on worker support being present.
 */

import { asAppError, AppError, type UserFacingError } from "@/lib/errors";
import { publicLimits } from "@/lib/config";
import { computeStatistics } from "@/lib/stats";
import { parseTelegramExportText } from "@/lib/telegram/parser";
import type {
  ImportOutcome,
  ImportRequest,
  ImportWorkerMessage,
} from "./import-protocol";

export type ImportProgress = { stage: string; message: string };

export interface ImportOptions {
  chatId?: string;
  conversationGapMinutes: number;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

export class ImportError extends Error {
  readonly userFacing: UserFacingError;
  constructor(userFacing: UserFacingError) {
    super(userFacing.message);
    this.name = "ImportError";
    this.userFacing = userFacing;
  }
}

function validateFile(file: File): void {
  if (file.size === 0) {
    throw new AppError("INVALID_JSON", {
      message: "That file is empty.",
      hint: "Pick the result.json file produced by Telegram Desktop.",
    });
  }
  if (file.size > publicLimits.maxUploadBytes) {
    throw new AppError("TOO_LARGE", {
      message: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB, over the ${Math.round(publicLimits.maxUploadBytes / 1024 / 1024)} MB limit.`,
    });
  }
  const name = file.name.toLowerCase();
  const looksJson =
    name.endsWith(".json") || file.type === "application/json" || file.type === "";
  if (!looksJson) {
    throw new AppError("UNSUPPORTED_EXPORT", {
      message: "This app reads the JSON export, not that file type.",
      hint: "In Telegram Desktop choose Export chat history → Format: Machine-readable JSON.",
    });
  }
}

async function readText(file: File): Promise<string> {
  try {
    return await file.text();
  } catch (error) {
    throw new AppError("FILE_READ_FAILED", { cause: error });
  }
}

function runInline(request: ImportRequest): ImportOutcome {
  const conversation = parseTelegramExportText(request.text, {
    ...(request.chatId ? { chatId: request.chatId } : {}),
  });
  const { statistics, segments } = computeStatistics(conversation, {
    conversationGapMinutes: request.conversationGapMinutes,
  });
  return { conversation, statistics, segments };
}

function runInWorker(
  request: ImportRequest,
  options: ImportOptions,
): Promise<ImportOutcome> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../workers/import.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      reject(error);
      return;
    }

    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new AppError("UNKNOWN", { detail: "import cancelled" }));
    };
    options.signal?.addEventListener("abort", onAbort);

    worker.addEventListener("message", (event: MessageEvent<ImportWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        options.onProgress?.({ stage: message.stage, message: message.message });
        return;
      }
      if (message.type === "error") {
        cleanup();
        reject(new ImportError(message.error));
        return;
      }
      cleanup();
      resolve({
        conversation: message.conversation,
        statistics: message.statistics,
        segments: message.segments,
      });
    });

    worker.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(event.message || "import worker failed"));
    });

    worker.postMessage(request);
  });
}

export async function importTelegramFile(
  file: File,
  options: ImportOptions,
): Promise<ImportOutcome> {
  try {
    validateFile(file);
    options.onProgress?.({ stage: "reading", message: "Opening the file…" });
    const text = await readText(file);

    const request: ImportRequest = {
      text,
      ...(options.chatId ? { chatId: options.chatId } : {}),
      conversationGapMinutes: options.conversationGapMinutes,
    };

    if (typeof Worker !== "undefined") {
      try {
        return await runInWorker(request, options);
      } catch (error) {
        if (error instanceof ImportError) throw error;
        // Worker construction or execution failed for an environment reason;
        // the work itself is still perfectly doable here.
        options.onProgress?.({
          stage: "parsing",
          message: "Reading the export…",
        });
        return runInline(request);
      }
    }

    options.onProgress?.({ stage: "parsing", message: "Reading the export…" });
    return runInline(request);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(asAppError(error).toUserFacing());
  }
}
