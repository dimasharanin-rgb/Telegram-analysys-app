import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { MessageType } from "@/lib/model/message";
import {
  deriveTimezoneOffsetMinutes,
  flattenText,
  formatOffset,
  parseTelegramExport,
  parseTelegramExportText,
} from "@/lib/telegram/parser";
import { loadFixtureConversation, rawExport } from "./helpers";

describe("flattenText", () => {
  it("prefers text_entities", () => {
    expect(
      flattenText({
        text: "ignored",
        text_entities: [
          { type: "plain", text: "hello " },
          { type: "link", text: "https://example.com" },
        ],
      }),
    ).toBe("hello https://example.com");
  });

  it("handles a plain string", () => {
    expect(flattenText({ text: "  hi there  " })).toBe("hi there");
  });

  it("handles the mixed array form", () => {
    expect(
      flattenText({ text: ["look: ", { type: "link", text: "https://x.test" }, " ok"] }),
    ).toBe("look: https://x.test ok");
  });

  it("returns an empty string when there is no text at all", () => {
    expect(flattenText({})).toBe("");
    expect(flattenText({ text: [] })).toBe("");
    expect(flattenText({ text: null })).toBe("");
  });
});

describe("timezone handling", () => {
  it("derives the export offset from date vs date_unixtime", () => {
    const data = rawExport(
      [
        ["a", 0, "one"],
        ["b", 5, "two"],
      ],
      { offsetMinutes: 180 },
    );
    expect(deriveTimezoneOffsetMinutes(data.messages)).toBe(180);
  });

  it("returns null when the export has no unixtime", () => {
    const data = rawExport([["a", 0, "one"]], { withUnixtime: false });
    expect(deriveTimezoneOffsetMinutes(data.messages)).toBeNull();
  });

  it("formats offsets", () => {
    expect(formatOffset(180)).toBe("+03:00");
    expect(formatOffset(-330)).toBe("-05:30");
    expect(formatOffset(0)).toBe("+00:00");
  });

  it("keeps wall-clock time separate from the absolute instant", () => {
    const conversation = parseTelegramExport(
      rawExport(
        [
          ["a", 0, "one"],
          ["b", 1, "two"],
        ],
        { offsetMinutes: 120 },
      ),
    );
    const first = conversation.messages[0]!;
    expect(conversation.timezoneOffsetMinutes).toBe(120);
    // 09:00 UTC is 11:00 in the export's own clock.
    expect(first.localIso).toBe("2024-03-01T11:00:00");
    expect(first.timestamp).toBe("2024-03-01T11:00:00+02:00");
    expect(first.epochMs).toBe(Date.UTC(2024, 2, 1, 9, 0, 0));
  });

  it("warns when the export carries no timezone", () => {
    const conversation = parseTelegramExport(
      rawExport(
        [
          ["a", 0, "one"],
          ["b", 1, "two"],
        ],
        { withUnixtime: false },
      ),
    );
    expect(conversation.timezoneOffsetMinutes).toBeNull();
    expect(conversation.warnings.map((warning) => warning.code)).toContain(
      "MISSING_TIMEZONE",
    );
  });
});

describe("message classification", () => {
  const base = {
    name: "chat",
    type: "personal_chat",
    id: 1,
    messages: [
      {
        id: 1,
        type: "message",
        date: "2024-03-01T10:00:00",
        date_unixtime: "1709287200",
        from: "Ana",
        from_id: "user1",
        photo: "photos/photo_1.jpg",
        text: "look at this",
        text_entities: [{ type: "plain", text: "look at this" }],
      },
      {
        id: 2,
        type: "message",
        date: "2024-03-01T10:01:00",
        date_unixtime: "1709287260",
        from: "Ben",
        from_id: "user2",
        file: "voice_messages/a.ogg",
        media_type: "voice_message",
        duration_seconds: 9,
        text: "",
        text_entities: [],
      },
      {
        id: 3,
        type: "service",
        date: "2024-03-01T10:02:00",
        date_unixtime: "1709287320",
        actor: "Ana",
        actor_id: "user1",
        action: "pin_message",
        text: "",
        text_entities: [],
      },
      {
        id: 4,
        type: "message",
        date: "2024-03-01T10:03:00",
        date_unixtime: "1709287380",
        from: "Ben",
        from_id: "user2",
        reply_to_message_id: 1,
        edited: "2024-03-01T10:04:00",
        text: "nice",
        text_entities: [{ type: "plain", text: "nice" }],
      },
      // A message with no usable content at all is skipped.
      {
        id: 5,
        type: "message",
        date: "2024-03-01T10:05:00",
        date_unixtime: "1709287500",
        from: "Ben",
        from_id: "user2",
        text: "",
        text_entities: [],
      },
    ],
  };

  it("classifies media, keeps captions and preserves reply/edit metadata", () => {
    const conversation = parseTelegramExport(base);
    const [photo, voice, reply] = conversation.messages;

    expect(photo?.type).toBe(MessageType.IMAGE);
    expect(photo?.hasMedia).toBe(true);
    expect(photo?.text).toBe("look at this");

    expect(voice?.type).toBe(MessageType.AUDIO);
    expect(voice?.media[0]?.durationSeconds).toBe(9);
    // The parser records what the export said and nothing more; everything
    // learned later lives on the conversation event, not the attachment.
    expect(voice?.media[0]?.kind).toBe(MessageType.AUDIO);

    expect(reply?.replyTo).toBe("1");
    expect(reply?.edited).toBe(true);
  });

  it("excludes service messages and empty entries from the conversation", () => {
    const conversation = parseTelegramExport(base);
    expect(conversation.messages).toHaveLength(3);
    expect(conversation.counts.total).toBe(5);
    expect(conversation.counts.system).toBe(2);
    expect(conversation.counts.withMedia).toBe(2);
  });
});

describe("error handling", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseTelegramExportText("{not json")).toThrowError(AppError);
    try {
      parseTelegramExportText("{not json");
    } catch (error) {
      expect((error as AppError).code).toBe("INVALID_JSON");
    }
  });

  it("rejects a file that is not a Telegram export", () => {
    try {
      parseTelegramExport({ hello: "world" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("UNSUPPORTED_EXPORT");
    }
  });

  it("rejects an export with no messages", () => {
    try {
      parseTelegramExport({ name: "x", type: "personal_chat", id: 1, messages: [] });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("EMPTY_CONVERSATION");
    }
  });

  it("rejects a conversation with only one participant", () => {
    try {
      parseTelegramExport(
        rawExport([
          ["a", 0, "one"],
          ["a", 1, "two"],
        ]),
      );
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("SINGLE_PARTICIPANT");
    }
  });

  it("rejects an export whose messages are all media-free service events", () => {
    try {
      parseTelegramExport({
        name: "x",
        type: "personal_chat",
        id: 1,
        messages: [
          {
            id: 1,
            type: "service",
            date: "2024-03-01T10:00:00",
            actor: "Ana",
            actor_id: "user1",
            action: "joined",
          },
        ],
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("EMPTY_CONVERSATION");
    }
  });
});

describe("full account exports", () => {
  const account = {
    chats: {
      list: [
        rawExport([
          ["a", 0, "small one"],
          ["b", 1, "small two"],
        ]),
        {
          ...rawExport([
            ["a", 0, "big one"],
            ["b", 1, "big two"],
            ["a", 2, "big three"],
          ]),
          id: 99,
          name: "Biggest chat",
        },
      ],
    },
  };

  it("picks the largest chat by default and lists the others", () => {
    const conversation = parseTelegramExport(account);
    expect(conversation.chatName).toBe("Biggest chat");
    expect(conversation.availableChats).toHaveLength(2);
    expect(conversation.warnings.map((warning) => warning.code)).toContain(
      "MULTIPLE_CHATS",
    );
  });

  it("honours an explicit chat selection", () => {
    const conversation = parseTelegramExport(account, { chatId: "42" });
    expect(conversation.chatId).toBe("42");
    expect(conversation.messages).toHaveLength(2);
  });
});

describe("the synthetic fixture", () => {
  it("parses into two participants across several months", () => {
    const conversation = loadFixtureConversation();
    expect(conversation.participants).toHaveLength(2);
    expect(conversation.messages.length).toBeGreaterThan(900);
    expect(conversation.timezoneOffsetMinutes).toBe(120);
    expect(conversation.counts.unparseable).toBe(0);

    const first = conversation.messages[0]!;
    const last = conversation.messages[conversation.messages.length - 1]!;
    expect(first.epochMs).toBeLessThan(last.epochMs);
    expect(last.localIso.slice(0, 4)).toBe("2024");
  });

  it("keeps messages in chronological order", () => {
    const conversation = loadFixtureConversation();
    for (let i = 1; i < conversation.messages.length; i += 1) {
      expect(conversation.messages[i]!.epochMs).toBeGreaterThanOrEqual(
        conversation.messages[i - 1]!.epochMs,
      );
    }
  });

  it("flattens link entities back into the message text", () => {
    const conversation = loadFixtureConversation();
    const withLink = conversation.messages.find((message) =>
      message.text.includes("https://example.com/listing"),
    );
    expect(withLink).toBeDefined();
  });
});
