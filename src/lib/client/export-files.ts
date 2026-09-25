/**
 * Reading a Telegram export folder in the browser.
 *
 * A Telegram Desktop export is a directory: `result.json` beside `photos/`,
 * `voice_messages/`, `files/` and others. The JSON refers to its siblings by
 * relative path, which is the only link between a message and its attachment.
 *
 * Nothing here uploads anything. It indexes what the user picked so that, once
 * the server says which files the analysis wants, exactly those can be sent and
 * the rest stay on the machine.
 */

import { MessageType, type Conversation } from "@/lib/model/message";

/** Media kinds V3 can do something with. Video is absent deliberately. */
const UPLOADABLE: ReadonlySet<MessageType> = new Set([
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.FILE,
]);

export interface IndexedExport {
  /** The export's result.json, when the selection contained one. */
  json: File | null;
  /** Every other file, keyed by its path relative to the export root. */
  media: Map<string, File>;
}

/**
 * Finds the export root and indexes everything under it.
 *
 * A directory pick gives each file a `webkitRelativePath` like
 * `ChatExport_2024-01-01/photos/photo_1.jpg`, while the JSON refers to
 * `photos/photo_1.jpg`. The leading segment is the folder the user chose, so it
 * is stripped - but only when every file shares it, because a user who selected
 * the inside of the export folder has paths that are already relative.
 */
export function indexExportFiles(files: readonly File[]): IndexedExport {
  const paths = files.map((file) => relativePathOf(file));
  const prefix = commonFirstSegment(paths);

  const media = new Map<string, File>();
  let json: File | null = null;

  files.forEach((file, index) => {
    const full = paths[index]!;
    const relative = prefix === null ? full : full.slice(prefix.length + 1);

    if (relative === "result.json") {
      json = file;
      return;
    }
    // Ignore the HTML export's own assets, and anything at the root that is not
    // referenced by the JSON anyway.
    if (relative.length === 0 || !relative.includes("/")) return;
    media.set(relative, file);
  });

  return { json, media };
}

function relativePathOf(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  const path = withPath.webkitRelativePath;
  return path !== undefined && path.length > 0 ? path : file.name;
}

/** The single top-level folder every path shares, or null when they differ. */
function commonFirstSegment(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const first = paths[0]!.split("/")[0]!;
  if (paths[0]!.indexOf("/") === -1) return null;
  return paths.every((path) => path.startsWith(`${first}/`)) ? first : null;
}

/* -------------------------------------------------------------------------
 * Declaring what exists
 * ---------------------------------------------------------------------- */

export interface DeclaredMedia {
  messageId: string;
  reference: string;
  kind: "IMAGE" | "AUDIO" | "VIDEO" | "FILE" | "STICKER";
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

/**
 * The metadata the server needs to decide what it wants.
 *
 * Only attachments whose file is actually present are declared: asking for a
 * file the user did not include would fail later for no reason. Video is
 * excluded here as well as server-side - there is no point declaring something
 * that can never be planned.
 */
export function declareMedia(
  conversation: Conversation,
  available: ReadonlyMap<string, File>,
): DeclaredMedia[] {
  const declared: DeclaredMedia[] = [];

  for (const message of conversation.messages) {
    for (const attachment of message.media) {
      const reference = attachment.reference;
      if (reference === undefined) continue;
      if (!UPLOADABLE.has(attachment.kind)) continue;

      const file = available.get(reference);
      if (file === undefined) continue;

      declared.push({
        messageId: message.id,
        reference,
        kind: attachment.kind as DeclaredMedia["kind"],
        // The browser's type beats the export's, because it read the file.
        ...(file.type ? { mimeType: file.type } : attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        sizeBytes: file.size,
        ...(attachment.durationSeconds !== undefined
          ? { durationSeconds: attachment.durationSeconds }
          : {}),
      });
    }
  }

  return declared;
}

/**
 * How many attachments exist, by kind, for the summary shown before analysis.
 *
 * Counts everything in the export, including video and the files the user did
 * not include, because the honest figure is "what is in this conversation" -
 * not "what we are going to read", which is a different number and is reported
 * separately.
 */
export function countAttachments(conversation: Conversation): {
  images: number;
  voice: number;
  documents: number;
  video: number;
} {
  const counts = { images: 0, voice: 0, documents: 0, video: 0 };

  for (const message of conversation.messages) {
    for (const attachment of message.media) {
      switch (attachment.kind) {
        case MessageType.IMAGE:
          counts.images += 1;
          break;
        case MessageType.AUDIO:
          counts.voice += 1;
          break;
        case MessageType.FILE:
          counts.documents += 1;
          break;
        case MessageType.VIDEO:
          counts.video += 1;
          break;
        default:
          break;
      }
    }
  }

  return counts;
}
