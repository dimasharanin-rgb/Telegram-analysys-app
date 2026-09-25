import { describe, expect, it } from "vitest";

import {
  PLANNABLE_KINDS,
  planMediaFor,
  readMessageIdsFrom,
  scopeFromContentTypes,
} from "@/server/media/plan";
import { sniffMimeType } from "@/server/media/sniff";
import { storageKeyFor } from "@/server/media/storage";
import { indexExportFiles, countAttachments, declareMedia } from "@/lib/client/export-files";
import { mediaLimits } from "@/lib/media/policy";
import { MessageType, type Conversation, type NormalizedMessage } from "@/lib/model/message";
import type { DeclaredAttachment } from "@/lib/api/schemas";

/* -------------------------------------------------------------------------
 * The plan
 * ---------------------------------------------------------------------- */

function declared(over: Partial<DeclaredAttachment> = {}): DeclaredAttachment {
  return {
    messageId: "1",
    reference: "photos/photo_1.jpg",
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    ...over,
  };
}

const FULL_SCOPE = { images: true, audio: true, documents: true };
const READ = new Set(["1", "2", "3"]);

describe("the server decides what gets uploaded", () => {
  it("asks for an image that is in scope and in the read window", () => {
    const plan = planMediaFor({
      declared: [declared()],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(1);
    expect(plan.wanted[0]!.category).toBe("image");
  });

  it("asks for nothing when the product includes no media", () => {
    const plan = planMediaFor({
      declared: [declared(), declared({ reference: "voice_messages/a.ogg", kind: "AUDIO", mimeType: "audio/ogg" })],
      readMessageIds: READ,
      productId: "free",
      scope: scopeFromContentTypes(["TEXT"]),
    });
    expect(plan.wanted).toHaveLength(0);
    expect(plan.skipped.outOfScope).toBe(2);
  });

  it("skips an attachment on a message the analysis will not read", () => {
    // The decisive economy: an image on a message outside the budgeted subset
    // cannot influence the result, so uploading it would be opening someone's
    // photograph to look at it in a context nothing reads.
    const plan = planMediaFor({
      declared: [declared({ messageId: "9999" })],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(0);
    expect(plan.skipped.outsideReadWindow).toBe(1);
  });

  it("never asks for video, whatever the scope says", () => {
    const plan = planMediaFor({
      declared: [declared({ reference: "video_files/v.mp4", kind: "VIDEO", mimeType: "video/mp4" })],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(0);
    expect(PLANNABLE_KINDS).not.toContain(MessageType.VIDEO);
  });

  it("never asks for stickers", () => {
    const plan = planMediaFor({
      declared: [declared({ reference: "stickers/s.webp", kind: "STICKER", mimeType: "image/webp" })],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(0);
  });

  it("stops at the image allowance", () => {
    const many = Array.from({ length: 10 }, (_unused, index) =>
      declared({ reference: `photos/photo_${index}.jpg`, messageId: "1" }),
    );
    const plan = planMediaFor({
      declared: many,
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
      limits: { ...mediaLimits(), maxImages: 3 },
    });
    expect(plan.wanted).toHaveLength(3);
    expect(plan.skipped.overLimit).toBe(7);
  });

  it("stops at the audio budget, counted in seconds", () => {
    const voices = Array.from({ length: 5 }, (_unused, index) =>
      declared({
        reference: `voice_messages/v_${index}.ogg`,
        kind: "AUDIO",
        mimeType: "audio/ogg",
        durationSeconds: 60,
      }),
    );
    const plan = planMediaFor({
      declared: voices,
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
      limits: { ...mediaLimits(), maxAudioSeconds: 150 },
    });
    expect(plan.wanted).toHaveLength(2);
  });

  it("asks for a file listed twice only once", () => {
    const plan = planMediaFor({
      declared: [declared({ messageId: "1" }), declared({ messageId: "2" })],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(1);
  });

  it("refuses an oversized file without asking for it", () => {
    const plan = planMediaFor({
      declared: [declared({ sizeBytes: 900 * 1024 * 1024 })],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(0);
    expect(plan.skipped.invalid).toBe(1);
  });

  it("derives the read window from the excerpts", () => {
    const ids = readMessageIdsFrom([
      { messages: [{ id: "a" }, { id: "b" }] },
      { messages: [{ id: "b" }, { id: "c" }] },
    ]);
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });

  it("maps a product's content types onto a media scope", () => {
    expect(scopeFromContentTypes(["TEXT"])).toEqual({
      images: false,
      audio: false,
      documents: false,
    });
    expect(scopeFromContentTypes(["TEXT", "IMAGES", "AUDIO"])).toEqual({
      images: true,
      audio: true,
      documents: true,
    });
  });
});

/* -------------------------------------------------------------------------
 * Storage keys
 * ---------------------------------------------------------------------- */

describe("a client cannot name the file it writes", () => {
  it("produces a flat hashed key, never the reference", () => {
    const key = storageKeyFor("own_1", "job_1", "photos/photo_1.jpg");
    expect(key).toMatch(/^own_1\/job_1\/[0-9a-f]{32}$/);
    expect(key).not.toContain("photo_1.jpg");
  });

  it("turns a traversal attempt into an ordinary hash", () => {
    const key = storageKeyFor("own_1", "job_1", "../../../../etc/passwd");
    expect(key).toMatch(/^own_1\/job_1\/[0-9a-f]{32}$/);
    expect(key).not.toContain("..");
    expect(key).not.toContain("passwd");
  });

  it("scopes by owner and job, so a key cannot resolve into another analysis", () => {
    const a = storageKeyFor("own_1", "job_1", "photos/p.jpg");
    const b = storageKeyFor("own_2", "job_1", "photos/p.jpg");
    const c = storageKeyFor("own_1", "job_2", "photos/p.jpg");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("is stable for the same inputs, so a retry overwrites rather than duplicates", () => {
    expect(storageKeyFor("own_1", "job_1", "photos/p.jpg")).toBe(
      storageKeyFor("own_1", "job_1", "photos/p.jpg"),
    );
  });

  it("strips anything odd out of an owner or job segment", () => {
    const key = storageKeyFor("../own", "job/../..", "photos/p.jpg");
    expect(key.split("/")).toHaveLength(3);
    expect(key).not.toContain("..");
  });
});

/* -------------------------------------------------------------------------
 * Sniffing
 * ---------------------------------------------------------------------- */

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array([...values, ...new Array(32).fill(0)]);
}

function asciiBytes(text: string, pad = 32): Uint8Array {
  const out = new Uint8Array(text.length + pad);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
}

describe("what a file claims is not what it is", () => {
  it("recognises the formats V3 accepts", () => {
    expect(sniffMimeType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMimeType(bytes(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
    expect(sniffMimeType(asciiBytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMimeType(asciiBytes("OggS"))).toBe("audio/ogg");
    expect(sniffMimeType(asciiBytes("ID3"))).toBe("audio/mpeg");
    expect(sniffMimeType(asciiBytes("fLaC"))).toBe("audio/flac");
  });

  it("reads the RIFF sub-type rather than guessing", () => {
    const webp = asciiBytes("RIFF____WEBP");
    const wav = asciiBytes("RIFF____WAVE");
    expect(sniffMimeType(webp)).toBe("image/webp");
    expect(sniffMimeType(wav)).toBe("audio/wav");
  });

  it("sees an mp4 wearing a jpeg's name", () => {
    // The case this exists for: a video renamed so it would reach a vision
    // provider as an image.
    const mp4 = asciiBytes("____ftypmp42");
    expect(sniffMimeType(mp4)).not.toMatch(/^image\//);
  });

  it("returns null for anything it does not recognise", () => {
    expect(sniffMimeType(asciiBytes("not a real file"))).toBeNull();
    expect(sniffMimeType(new Uint8Array())).toBeNull();
    expect(sniffMimeType(new Uint8Array([0x00, 0x01]))).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Reading the export folder
 * ---------------------------------------------------------------------- */

function fileAt(path: string, type = "image/jpeg"): File {
  const file = new File([new Uint8Array([1, 2, 3])], path.split("/").pop()!, { type });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("indexing a picked export folder", () => {
  it("finds result.json and keys media by its export-relative path", () => {
    const indexed = indexExportFiles([
      fileAt("ChatExport_2024-01-01/result.json", "application/json"),
      fileAt("ChatExport_2024-01-01/photos/photo_1.jpg"),
      fileAt("ChatExport_2024-01-01/voice_messages/audio_1.ogg", "audio/ogg"),
    ]);

    expect(indexed.json).not.toBeNull();
    expect([...indexed.media.keys()].sort()).toEqual([
      "photos/photo_1.jpg",
      "voice_messages/audio_1.ogg",
    ]);
  });

  it("copes with a selection that is already relative", () => {
    const indexed = indexExportFiles([
      fileAt("result.json", "application/json"),
      fileAt("photos/photo_1.jpg"),
    ]);
    expect(indexed.json).not.toBeNull();
    expect(indexed.media.has("photos/photo_1.jpg")).toBe(true);
  });

  it("reports no json when the folder has none", () => {
    const indexed = indexExportFiles([fileAt("ChatExport/photos/photo_1.jpg")]);
    expect(indexed.json).toBeNull();
  });
});

describe("declaring what exists", () => {
  function conversation(messages: NormalizedMessage[]): Conversation {
    return {
      source: "telegram-desktop-json",
      chatId: "c",
      chatName: "chat",
      chatType: "personal_chat",
      participants: [],
      messages,
      timezoneOffsetMinutes: 0,
      counts: { total: messages.length, conversational: messages.length, system: 0, withMedia: 1, unparseable: 0 },
      warnings: [],
      availableChats: [],
    };
  }

  function message(over: Partial<NormalizedMessage>): NormalizedMessage {
    return {
      id: "1",
      timestamp: "2024-03-01T12:00:00+00:00",
      epochMs: 0,
      localIso: "2024-03-01T12:00:00",
      senderId: "a",
      senderName: "Alex",
      text: "",
      replyTo: null,
      type: MessageType.TEXT,
      hasMedia: false,
      media: [],
      reactions: [],
      edited: false,
      forwarded: false,
      ...over,
    };
  }

  it("declares only attachments whose file the user actually included", () => {
    const chat = conversation([
      message({
        id: "1",
        type: MessageType.IMAGE,
        hasMedia: true,
        media: [{ kind: MessageType.IMAGE, reference: "photos/here.jpg" }],
      }),
      message({
        id: "2",
        type: MessageType.IMAGE,
        hasMedia: true,
        media: [{ kind: MessageType.IMAGE, reference: "photos/missing.jpg" }],
      }),
    ]);

    const declaredList = declareMedia(
      chat,
      new Map([["photos/here.jpg", fileAt("photos/here.jpg")]]),
    );

    expect(declaredList).toHaveLength(1);
    expect(declaredList[0]!.reference).toBe("photos/here.jpg");
  });

  it("does not declare video", () => {
    const chat = conversation([
      message({
        id: "1",
        type: MessageType.VIDEO,
        hasMedia: true,
        media: [{ kind: MessageType.VIDEO, reference: "video_files/v.mp4" }],
      }),
    ]);
    const declaredList = declareMedia(
      chat,
      new Map([["video_files/v.mp4", fileAt("video_files/v.mp4", "video/mp4")]]),
    );
    expect(declaredList).toHaveLength(0);
  });

  it("counts every attachment in the export, including what it will not read", () => {
    const chat = conversation([
      message({ id: "1", hasMedia: true, media: [{ kind: MessageType.IMAGE }] }),
      message({ id: "2", hasMedia: true, media: [{ kind: MessageType.VIDEO }] }),
      message({ id: "3", hasMedia: true, media: [{ kind: MessageType.AUDIO }] }),
      message({ id: "4", hasMedia: true, media: [{ kind: MessageType.FILE }] }),
    ]);
    expect(countAttachments(chat)).toEqual({
      images: 1,
      voice: 1,
      documents: 1,
      video: 1,
    });
  });
});

describe("documents are read, and cost is estimated before anything runs", () => {
  it("asks for a PDF when documents are in scope", () => {
    const plan = planMediaFor({
      declared: [
        declared({
          reference: "files/agreement.pdf",
          kind: "FILE",
          mimeType: "application/pdf",
        }),
      ],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(1);
    expect(plan.wanted[0]!.category).toBe("document");
  });

  it("refuses a document that is not a PDF", () => {
    const plan = planMediaFor({
      declared: [
        declared({
          reference: "files/notes.docx",
          kind: "FILE",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.wanted).toHaveLength(0);
    expect(plan.skipped.invalid).toBe(1);
  });

  it("counts a document against the image allowance, since both are files read", () => {
    const plan = planMediaFor({
      declared: [
        declared({ reference: "photos/a.jpg" }),
        declared({ reference: "files/b.pdf", kind: "FILE", mimeType: "application/pdf" }),
        declared({ reference: "photos/c.jpg" }),
      ],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
      limits: { ...mediaLimits(), maxImages: 2 },
    });
    expect(plan.wanted).toHaveLength(2);
    expect(plan.skipped.overLimit).toBe(1);
  });

  it("estimates nothing when it wants nothing", () => {
    const plan = planMediaFor({
      declared: [],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.usage.estimatedCostMicros).toBe(0);
    expect(plan.usage.imagesProcessed).toBe(0);
  });

  it("estimates a cost for what it does want", () => {
    const plan = planMediaFor({
      declared: [declared(), declared({ reference: "photos/b.jpg" })],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.usage.imagesProcessed).toBe(2);
    expect(plan.usage.estimatedCostMicros).toBeGreaterThan(0);
  });

  it("prices audio by its duration rather than per file", () => {
    const short = planMediaFor({
      declared: [
        declared({ reference: "v/a.ogg", kind: "AUDIO", mimeType: "audio/ogg", durationSeconds: 10 }),
      ],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    const long = planMediaFor({
      declared: [
        declared({ reference: "v/a.ogg", kind: "AUDIO", mimeType: "audio/ogg", durationSeconds: 600 }),
      ],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });

    expect(long.usage.audioSeconds).toBe(600);
    expect(long.usage.estimatedCostMicros).toBeGreaterThan(
      short.usage.estimatedCostMicros,
    );
  });

  it("never estimates a video cost, because none is ever planned", () => {
    const plan = planMediaFor({
      declared: [
        declared({ reference: "v/v.mp4", kind: "VIDEO", mimeType: "video/mp4", durationSeconds: 300 }),
      ],
      readMessageIds: READ,
      productId: "multimodal",
      scope: FULL_SCOPE,
    });
    expect(plan.usage.videoSeconds).toBe(0);
    expect(plan.usage.estimatedCostMicros).toBe(0);
  });
});
