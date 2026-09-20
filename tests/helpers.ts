import fs from "node:fs";
import path from "node:path";

import type { NormalizedMessage } from "@/lib/model/message";
import { MessageType } from "@/lib/model/message";
import { parseTelegramExport } from "@/lib/telegram/parser";

const FIXTURE = path.join(process.cwd(), "fixtures", "telegram-sample.json");

let cached: unknown;

/** The synthetic export, parsed once per test run. */
export function loadFixtureJson(): unknown {
  cached ??= JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  return cached;
}

export function loadFixtureConversation() {
  return parseTelegramExport(loadFixtureJson());
}

/** Builds a tiny raw export from `[sender, minutesFromStart, text]` tuples. */
export function rawExport(
  rows: [sender: "a" | "b", minutes: number, text: string][],
  options: { withUnixtime?: boolean; offsetMinutes?: number } = {},
) {
  const offsetMinutes = options.offsetMinutes ?? 0;
  const base = Date.UTC(2024, 2, 1, 9, 0, 0);

  return {
    name: "Test chat",
    type: "personal_chat",
    id: 42,
    messages: rows.map(([sender, minutes, text], index) => {
      const epoch = base + minutes * 60_000;
      const wall = new Date(epoch + offsetMinutes * 60_000).toISOString().slice(0, 19);
      return {
        id: index + 1,
        type: "message",
        date: wall,
        ...(options.withUnixtime === false
          ? {}
          : { date_unixtime: String(Math.floor(epoch / 1000)) }),
        from: sender === "a" ? "Ana" : "Ben",
        from_id: sender === "a" ? "user1" : "user2",
        text,
        text_entities: [{ type: "plain", text }],
      };
    }),
  };
}

export function textMessage(
  id: string,
  senderId: string,
  epochMs: number,
  text: string,
): NormalizedMessage {
  return {
    id,
    timestamp: new Date(epochMs).toISOString(),
    epochMs,
    localIso: new Date(epochMs).toISOString().slice(0, 19),
    senderId,
    senderName: senderId === "user1" ? "Ana" : "Ben",
    text,
    replyTo: null,
    type: MessageType.TEXT,
    hasMedia: false,
    media: [],
    reactions: [],
    edited: false,
    forwarded: false,
  };
}
