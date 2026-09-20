/// <reference lib="webworker" />

/**
 * Import worker.
 *
 * Parsing a large export and computing every statistic over it is real work.
 * Doing it off the main thread keeps the progress UI honest - it can actually
 * repaint - and keeps a 50 MB export from freezing the tab.
 */

import { asAppError } from "@/lib/errors";
import { computeStatistics } from "@/lib/stats";
import { parseTelegramExportText } from "@/lib/telegram/parser";
import type { ImportRequest, ImportWorkerMessage } from "@/lib/client/import-protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(message: ImportWorkerMessage): void {
  ctx.postMessage(message);
}

ctx.addEventListener("message", (event: MessageEvent<ImportRequest>) => {
  const request = event.data;
  try {
    post({ type: "progress", stage: "parsing", message: "Reading the export…" });
    const conversation = parseTelegramExportText(request.text, {
      ...(request.chatId ? { chatId: request.chatId } : {}),
    });

    post({
      type: "progress",
      stage: "statistics",
      message: "Calculating conversation statistics…",
    });
    const { statistics, segments } = computeStatistics(conversation, {
      conversationGapMinutes: request.conversationGapMinutes,
    });

    post({ type: "result", conversation, statistics, segments });
  } catch (error) {
    post({ type: "error", error: asAppError(error).toUserFacing() });
  }
});
