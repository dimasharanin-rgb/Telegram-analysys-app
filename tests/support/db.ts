import { afterEach, beforeEach } from "vitest";

import { openDatabase, setDatabaseForTests, type Db } from "@/server/db/client";
import { ensureOwner } from "@/server/repositories/owners";
import {
  createConversation,
  type ConversationRecord,
} from "@/server/repositories/conversations";

let db: Db | null = null;

/** Gives each test file a throwaway in-memory database. */
export function withTestDatabase(): void {
  beforeEach(() => {
    db = openDatabase(":memory:");
    setDatabaseForTests(db);
  });

  afterEach(() => {
    setDatabaseForTests(null);
    db?.close();
    db = null;
  });
}

export interface Seeded {
  ownerId: string;
  conversation: ConversationRecord;
}

/** A two-person conversation owned by `ownerId`, with Sam marked as self. */
export function seedConversation(ownerId = "owner-1"): Seeded {
  ensureOwner(ownerId);
  const conversation = createConversation({
    ownerId,
    title: "Alex Moreau",
    source: "telegram-desktop-json",
    chatType: "personal_chat",
    messageCount: 1_200,
    startDate: "2024-01-09",
    endDate: "2024-08-08",
    spanDays: 213,
    timezoneOffsetMinutes: 120,
    statistics: { totalMessages: 1_200 },
    participants: [
      { pseudonym: "A", displayName: "Sam Okonkwo", isSelf: true, messageCount: 700 },
      { pseudonym: "B", displayName: "Alex Moreau", isSelf: false, messageCount: 500 },
    ],
  });
  return { ownerId, conversation };
}
