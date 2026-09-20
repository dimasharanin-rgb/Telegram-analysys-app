/**
 * Generates the synthetic Telegram export used for development and tests.
 *
 * It is entirely invented - no real person's conversation is used anywhere in
 * this repository. The generator is seeded, so the same fixture comes out
 * every time and tests can assert on exact numbers.
 *
 * The conversation is shaped to exercise the whole pipeline: two participants
 * with different message frequencies and reply speeds, questions, jokes, short
 * closing responses, a disagreement with repair attempts afterwards, recurring
 * topics, media messages, edits, replies, a service message, and eight months
 * of timestamps.
 *
 *   npm run fixture
 */

import fs from "node:fs";
import path from "node:path";

/* -------------------------------------------------------------------------
 * Deterministic RNG
 * ---------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20240417);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function chance(probability: number): boolean {
  return random() < probability;
}

function between(min: number, max: number): number {
  return min + random() * (max - min);
}

/** Log-normal-ish draw, so most replies are quick and a few are very slow. */
function replyDelaySeconds(medianSeconds: number, spread: number): number {
  const normal =
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return Math.max(8, Math.round(medianSeconds * Math.exp(normal * spread)));
}

/* -------------------------------------------------------------------------
 * Cast and content
 * ---------------------------------------------------------------------- */

const ALEX = { name: "Alex Moreau", id: "user411223344" };
const SAM = { name: "Sam Okonkwo", id: "user755889900" };

/** The export's wall clock sits at UTC+02:00. */
const OFFSET_MINUTES = 120;
const START = Date.UTC(2024, 0, 8, 9, 12, 0) - OFFSET_MINUTES * 60_000;

interface Line {
  who: "alex" | "sam";
  text: string;
  /** Marks a message that should carry an attachment. */
  media?: "photo" | "voice" | "sticker" | "video";
  /** Marks a message that replies to the previous one explicitly. */
  reply?: boolean;
  edited?: boolean;
}

type Scene = { topic: string; lines: Line[] };

const OPENERS_ALEX = [
  "morning! how did you sleep?",
  "hey, quick question",
  "are you around later?",
  "ok so I just had a thought",
  "you up?",
  "hey hey",
  "did you see the thing I sent yesterday?",
  "how's the day going so far",
];

const OPENERS_SAM = [
  "hey",
  "sorry, only just seeing this",
  "quick one before my meeting",
  "you free tonight?",
  "guess what happened at work",
];

const SHORT_SAM = ["ok", "yeah", "sure", "mm", "sounds good", "cool", "👍", "haha", "np"];

const JOKES = [
  "I have now made coffee three times and drunk none of it. this is my entire personality",
  "Biscuit just tried to eat a sock. an actual sock. we are raising a goat",
  "I told my manager I'd 'circle back' and then hid in the stairwell for ten minutes",
  "the neighbour's wifi is called 'TELL MY WIFE I SAID HELLO' and honestly, respect",
  "I'm not saying the printer is haunted but it printed 40 blank pages at 2am",
];

const TOPIC_SCENES: Scene[] = [
  {
    topic: "weekend",
    lines: [
      { who: "alex", text: "what are we doing this weekend? I'd quite like to actually leave the flat" },
      { who: "sam", text: "same. there's that market near the station on saturday?" },
      { who: "alex", text: "oh yes. we said that last month and then didn't go" },
      { who: "sam", text: "we did do that didn't we" },
      { who: "alex", text: "let's actually commit. saturday, 11am, market, coffee after?" },
      { who: "sam", text: "deal" },
      { who: "alex", text: "putting it in the calendar so it's real" },
      { who: "sam", text: "the calendar makes it legally binding", media: "sticker" },
    ],
  },
  {
    topic: "work",
    lines: [
      { who: "sam", text: "the deadline moved again. third time." },
      { who: "alex", text: "oh no. what's the new date?" },
      { who: "sam", text: "friday. which is in two days." },
      { who: "alex", text: "that's not a deadline that's a threat" },
      { who: "sam", text: "ha. accurate" },
      { who: "alex", text: "do you need me to do dinner this week? take one thing off your plate" },
      { who: "sam", text: "honestly that would help a lot" },
      { who: "alex", text: "consider it done. don't think about food until saturday" },
      { who: "sam", text: "thank you 🙏" },
    ],
  },
  {
    topic: "biscuit",
    lines: [
      { who: "alex", text: "Biscuit has discovered the sofa cushions can be removed", media: "photo" },
      { who: "sam", text: "no" },
      { who: "alex", text: "yes" },
      { who: "sam", text: "how bad" },
      { who: "alex", text: "there is stuffing in three rooms. THREE." },
      { who: "sam", text: "😭" },
      { who: "alex", text: "I'm not even angry. look at this face" },
      { who: "sam", text: "ok that face does cancel out a lot of crimes" },
    ],
  },
  {
    topic: "flat",
    lines: [
      { who: "alex", text: "I looked at the listing again and I think it's actually good?" },
      { who: "alex", text: "the second bedroom is small but the light is unreal" },
      { who: "alex", text: "and it's 20 mins from yours" },
      { who: "sam", text: "mm" },
      { who: "alex", text: "is that a 'mm' yes or a 'mm' no" },
      { who: "sam", text: "it's a 'I need to think' mm" },
      { who: "alex", text: "ok. that's fair. no rush" },
      { who: "sam", text: "thanks. I will think about it properly, I'm not fobbing you off" },
    ],
  },
  {
    topic: "coffee",
    lines: [
      { who: "alex", text: "the new place on Hart Street does an oat flat white that is genuinely excellent" },
      { who: "sam", text: "high praise from you" },
      { who: "alex", text: "I know. I've been thinking about it since tuesday" },
      { who: "sam", text: "take me on saturday?" },
      { who: "alex", text: "obviously" },
    ],
  },
  {
    topic: "logistics",
    lines: [
      { who: "alex", text: "are you getting the 18:40 or the 19:10?" },
      { who: "sam", text: "19:10, meeting overran" },
      { who: "alex", text: "ok I'll wait and we can walk back together" },
      { who: "sam", text: "you don't have to do that" },
      { who: "alex", text: "I know. I want to." },
      { who: "sam", text: "🙂" },
    ],
  },
  {
    topic: "checkin",
    lines: [
      { who: "alex", text: "how are you actually doing? not the short version" },
      { who: "sam", text: "tired. not in a dramatic way, just consistently" },
      { who: "alex", text: "that's worth taking seriously though" },
      { who: "sam", text: "I know. I keep saying I'll sort my sleep out and then don't" },
      { who: "alex", text: "want to try the thing where we both put phones away at 11?" },
      { who: "sam", text: "yeah ok. let's try it" },
      { who: "alex", text: "starting tonight. I'll be insufferable about it" },
      { who: "sam", text: "you will, and I'll be grateful, and I'll complain" },
    ],
  },
];

/** The disagreement and what follows it. */
const CONFLICT_SCENE: Scene = {
  topic: "flat",
  lines: [
    { who: "alex", text: "the agent called. they need an answer by thursday" },
    { who: "alex", text: "I know that's fast" },
    { who: "sam", text: "thursday is not enough time" },
    { who: "alex", text: "I didn't set the date" },
    { who: "sam", text: "no but you've been pushing this for weeks and now there's a deadline attached to it" },
    { who: "alex", text: "that's not fair. I've asked what you think about four separate times and got 'mm'" },
    { who: "sam", text: "because I don't KNOW yet. that's not me stonewalling you" },
    { who: "alex", text: "it feels like it from here" },
    { who: "sam", text: "ok" },
    { who: "sam", text: "I'm going to stop replying for a bit because I'll say something stupid" },
  ],
};

const REPAIR_SCENE: Scene = {
  topic: "flat",
  lines: [
    { who: "alex", text: "I'm sorry. 'it feels like stonewalling' was a rubbish thing to say" },
    { who: "alex", text: "you were being honest that you didn't know and I made that into a problem" },
    { who: "sam", text: "thank you. that means a lot actually" },
    { who: "sam", text: "and I'm sorry for going quiet. that's the thing I said I'd stop doing" },
    { who: "alex", text: "we both did our classic move within about nine minutes of each other" },
    { who: "sam", text: "impressive efficiency really" },
    { who: "alex", text: "can we talk about the flat properly on sunday? no deadline in the room" },
    { who: "sam", text: "yes. I'd like that" },
    { who: "alex", text: "ok. I'll tell the agent no for now." },
    { who: "sam", text: "you'd do that?" },
    { who: "alex", text: "the flat matters less than you not feeling railroaded" },
    { who: "sam", text: "❤️" },
  ],
};

const LINK_LINES: Line[] = [
  { who: "alex", text: "this is the one I meant https://example.com/listing/4821 — look at the kitchen" },
  { who: "sam", text: "sending you this because it made me think of you https://example.com/article/slow-mornings" },
];

/* -------------------------------------------------------------------------
 * Export assembly
 * ---------------------------------------------------------------------- */

interface TelegramMessage {
  id: number;
  type: "message" | "service";
  date: string;
  date_unixtime: string;
  from?: string;
  from_id?: string;
  actor?: string;
  actor_id?: string;
  action?: string;
  duration_seconds?: number;
  reply_to_message_id?: number;
  edited?: string;
  edited_unixtime?: string;
  text: string | unknown[];
  text_entities: { type: string; text: string }[];
  photo?: string;
  file?: string;
  media_type?: string;
  mime_type?: string;
  sticker_emoji?: string;
  width?: number;
  height?: number;
}

function wallClock(epochMs: number): string {
  return new Date(epochMs + OFFSET_MINUTES * 60_000).toISOString().slice(0, 19);
}

const messages: TelegramMessage[] = [];
let nextId = 1;
let cursor = START;
let lastMessageId: number | null = null;

function push(line: Line, epochMs: number): void {
  const person = line.who === "alex" ? ALEX : SAM;
  const id = nextId++;

  const message: TelegramMessage = {
    id,
    type: "message",
    date: wallClock(epochMs),
    date_unixtime: String(Math.floor(epochMs / 1000)),
    from: person.name,
    from_id: person.id,
    text: line.text,
    text_entities: line.text
      ? [{ type: "plain", text: line.text }]
      : [],
  };

  // Telegram splits links into their own entity; mirror that so the parser is
  // exercised against the real shape.
  const linkMatch = /https?:\/\/\S+/.exec(line.text);
  if (linkMatch) {
    const before = line.text.slice(0, linkMatch.index);
    const after = line.text.slice(linkMatch.index + linkMatch[0].length);
    message.text = [before, { type: "link", text: linkMatch[0] }, after].filter(
      (part) => part !== "",
    );
    message.text_entities = [
      ...(before ? [{ type: "plain", text: before }] : []),
      { type: "link", text: linkMatch[0] },
      ...(after ? [{ type: "plain", text: after }] : []),
    ];
  }

  if (line.reply && lastMessageId !== null) {
    message.reply_to_message_id = lastMessageId;
  }

  if (line.edited) {
    const editedAt = epochMs + Math.round(between(30, 400)) * 1000;
    message.edited = wallClock(editedAt);
    message.edited_unixtime = String(Math.floor(editedAt / 1000));
  }

  if (line.media === "photo") {
    message.photo = `photos/photo_${id}@${wallClock(epochMs).slice(0, 10)}.jpg`;
    message.width = 1280;
    message.height = 960;
  } else if (line.media === "voice") {
    message.file = `voice_messages/audio_${id}.ogg`;
    message.media_type = "voice_message";
    message.mime_type = "audio/ogg";
    message.duration_seconds = Math.round(between(3, 48));
  } else if (line.media === "sticker") {
    message.file = `stickers/sticker_${id}.webp`;
    message.media_type = "sticker";
    message.mime_type = "image/webp";
    message.sticker_emoji = pick(["😂", "🙃", "🥲", "😴"]);
  } else if (line.media === "video") {
    message.file = `video_files/video_${id}.mp4`;
    message.media_type = "video_file";
    message.mime_type = "video/mp4";
    message.duration_seconds = Math.round(between(5, 90));
  }

  messages.push(message);
  lastMessageId = id;
}

/** Alex replies a bit slower; Sam answers fast and short. */
function delayFor(who: "alex" | "sam"): number {
  return who === "alex"
    ? replyDelaySeconds(540, 1.15)
    : replyDelaySeconds(190, 1.0);
}

function runScene(scene: Scene, startEpoch: number): number {
  let epoch = startEpoch;
  let previous: Line | null = null;

  for (const line of scene.lines) {
    if (previous) {
      epoch +=
        (previous.who === line.who
          ? Math.round(between(20, 110))
          : delayFor(line.who)) * 1000;
    }
    push(line, epoch);
    previous = line;

    // Occasional extra short acknowledgement from Sam.
    if (line.who === "alex" && chance(0.18)) {
      epoch += delayFor("sam") * 1000;
      push({ who: "sam", text: pick(SHORT_SAM) }, epoch);
      previous = { who: "sam", text: "" };
    }
  }

  return epoch;
}

/** Moves the cursor to the start of the next conversation. */
function nextSessionStart(from: number): number {
  // Most conversations start the same or next day, in the evening or morning.
  const dayJump = chance(0.72) ? 1 : chance(0.6) ? 2 : 3;
  const base = from + dayJump * 86_400_000;
  const day = new Date(base + OFFSET_MINUTES * 60_000);
  const hour = chance(0.55) ? Math.round(between(18, 22)) : Math.round(between(8, 12));
  day.setUTCHours(hour, Math.round(between(0, 59)), Math.round(between(0, 59)), 0);
  return day.getTime() - OFFSET_MINUTES * 60_000;
}

// A service message at the top, as real exports often have.
messages.push({
  id: nextId++,
  type: "service",
  date: wallClock(START - 3_600_000),
  date_unixtime: String(Math.floor((START - 3_600_000) / 1000)),
  actor: ALEX.name,
  actor_id: ALEX.id,
  action: "phone_call",
  duration_seconds: 412,
  text: "",
  text_entities: [],
});

const SESSION_COUNT = 148;
const CONFLICT_AT = 96;

for (let session = 0; session < SESSION_COUNT; session += 1) {
  cursor = nextSessionStart(cursor);

  if (session === CONFLICT_AT) {
    cursor = runScene(CONFLICT_SCENE, cursor);
    // The repair happens the next morning, after a long silence.
    cursor = runScene(REPAIR_SCENE, cursor + Math.round(between(13, 17)) * 3_600_000);
    continue;
  }

  const scene = pick(TOPIC_SCENES);
  // Alex opens most conversations; Sam opens some.
  const opener: Line = chance(0.68)
    ? { who: "alex", text: pick(OPENERS_ALEX) }
    : { who: "sam", text: pick(OPENERS_SAM) };

  const lines: Line[] = [opener];

  // Occasionally Alex sends two or three messages before any reply.
  if (opener.who === "alex" && chance(0.35)) {
    lines.push({ who: "alex", text: pick(["also", "sorry, one more thing", "and another thing"]) });
    if (chance(0.3)) lines.push({ who: "alex", text: "ok that's everything I promise" });
  }

  lines.push(...scene.lines.map((line) => ({ ...line })));

  if (chance(0.22)) lines.push({ who: chance(0.7) ? "alex" : "sam", text: pick(JOKES) });
  if (chance(0.12)) lines.push({ ...pick(LINK_LINES) });
  if (chance(0.1)) lines.push({ who: "alex", text: "I'll send a voice note, easier", media: "voice" });
  if (chance(0.08)) lines.push({ who: "sam", text: "", media: "video" });
  if (chance(0.09)) {
    const last = lines[lines.length - 1];
    if (last) last.edited = true;
  }
  if (chance(0.25)) lines.push({ who: "sam", text: pick(SHORT_SAM), reply: true });

  cursor = runScene({ topic: scene.topic, lines }, cursor);
}

const exportData = {
  name: "Sam Okonkwo",
  type: "personal_chat",
  id: 755889900,
  messages,
};

const target = path.join(process.cwd(), "fixtures", "telegram-sample.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(exportData, null, 1)}\n`, "utf8");

const first = messages[1]!;
const last = messages[messages.length - 1]!;
console.log(
  `Wrote ${messages.length} messages to ${path.relative(process.cwd(), target)}`,
);
console.log(`Range: ${first.date} → ${last.date}`);
