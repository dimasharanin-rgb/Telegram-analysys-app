import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { openDatabase, setDatabaseForTests, type Db } from "@/server/db/client";
import { ensureOwner } from "@/server/repositories/owners";
import {
  createConversation,
  getConversation,
  listParticipants,
} from "@/server/repositories/conversations";

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  setDatabaseForTests(db);
});

afterEach(() => {
  setDatabaseForTests(null);
  db.close();
});

describe("persistence smoke", () => {
  it("creates a conversation with participants and scopes reads by owner", () => {
    ensureOwner("owner-1");
    ensureOwner("owner-2");

    const conversation = createConversation({
      ownerId: "owner-1",
      title: "Sam",
      source: "telegram-desktop-json",
      chatType: "personal_chat",
      messageCount: 100,
      startDate: "2024-01-01",
      endDate: "2024-06-01",
      spanDays: 150,
      timezoneOffsetMinutes: 120,
      statistics: { totalMessages: 100 },
      participants: [
        { pseudonym: "A", displayName: "Sam", isSelf: true, messageCount: 60 },
        { pseudonym: "B", displayName: "Alex", isSelf: false, messageCount: 40 },
      ],
    });

    expect(getConversation(conversation.id, "owner-1")?.title).toBe("Sam");
    expect(getConversation(conversation.id, "owner-2")).toBeNull();
    expect(listParticipants(conversation.id).map((p) => p.pseudonym)).toEqual(["A", "B"]);
  });
});
