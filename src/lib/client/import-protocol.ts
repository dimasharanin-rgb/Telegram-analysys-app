/** Message types exchanged with the import worker. */

import type { ConversationSegment } from "@/lib/analysis/segmentation";
import type { UserFacingError } from "@/lib/errors";
import type { Conversation } from "@/lib/model/message";
import type { ConversationStatistics } from "@/lib/stats";

export interface ImportRequest {
  text: string;
  chatId?: string;
  conversationGapMinutes: number;
}

export interface ImportOutcome {
  conversation: Conversation;
  statistics: ConversationStatistics;
  segments: ConversationSegment[];
}

export type ImportWorkerMessage =
  | { type: "progress"; stage: "parsing" | "statistics"; message: string }
  | ({ type: "result" } & ImportOutcome)
  | { type: "error"; error: UserFacingError };
