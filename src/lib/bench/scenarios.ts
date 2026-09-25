/**
 * The evaluation set for routing decisions.
 *
 * Every scenario is invented. No real person's conversation appears anywhere in
 * this repository, and a benchmark is exactly the wrong place to make an
 * exception: it would mean a private conversation sitting in version control to
 * be replayed on every run.
 *
 * The set covers what §43 asks for, and each case exists because it is a
 * different way for routing to be wrong:
 *
 *   normal            the baseline, where cheap tiers should be enough
 *   long              where a subset has to be chosen at all
 *   conflict          where escalation might actually earn its price
 *   sarcasm           where a cheap model most often reads tone backwards
 *   multilingual      where an English-tuned pipeline quietly degrades
 *   screenshot/meme   where media relevance decides the cost
 *   sensitive         where the gateway must refuse and still say something
 *   audio             where a transcript is the message
 *   ambiguous         where a confident answer is the wrong answer
 *   emotional         where a flat summary loses the point
 */

export const SCENARIO_KINDS = [
  "normal",
  "long",
  "conflict",
  "sarcasm",
  "multilingual",
  "screenshot",
  "meme",
  "ordinary_photo",
  "sensitive_media",
  "audio_transcript",
  "ambiguous",
  "emotional",
] as const;

export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export interface BenchTurn {
  sender: "a" | "b";
  text: string;
  /** Media present on this turn, for the scenarios that exercise the gateway. */
  media?: "image" | "voice" | "document";
}

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  /** What a correct analysis has to get right. Graded by hand, or by a judge. */
  expectations: string[];
  turns: BenchTurn[];
}

const a = (text: string, media?: BenchTurn["media"]): BenchTurn =>
  media ? { sender: "a", text, media } : { sender: "a", text };
const b = (text: string, media?: BenchTurn["media"]): BenchTurn =>
  media ? { sender: "b", text, media } : { sender: "b", text };

/** Filler that reads like real small talk, for padding a long conversation. */
function smallTalk(count: number): BenchTurn[] {
  const lines = [
    "morning",
    "did you sleep ok",
    "not really, woke up at 4 again",
    "that's rough",
    "what time are you back tonight",
    "sevenish I think",
    "ok I'll cook",
    "thank you 🙏",
    "did you see the thing about the trains",
    "no what happened",
  ];
  return Array.from({ length: count }, (_unused, index) => ({
    sender: index % 2 === 0 ? ("a" as const) : ("b" as const),
    text: lines[index % lines.length]!,
  }));
}

export const SCENARIOS: Scenario[] = [
  {
    id: "normal-evening",
    kind: "normal",
    expectations: [
      "describes an ordinary logistics exchange without inventing tension",
      "does not produce a difficult moment from a scheduling disagreement",
    ],
    turns: [
      a("are we still on for Thursday"),
      b("yeah should be, might be a bit late from work"),
      a("how late"),
      b("half seven maybe"),
      a("ok that's fine, I'll get the tickets"),
      b("thanks ❤️"),
    ],
  },
  {
    id: "long-history",
    kind: "long",
    expectations: [
      "says the analysis covers part of the conversation",
      "does not claim to have read every message",
    ],
    turns: [...smallTalk(120), a("so are we going to talk about last week or not"), b("not tonight")],
  },
  {
    id: "conflict-repair",
    kind: "conflict",
    expectations: [
      "identifies the disagreement and the repair attempt separately",
      "attributes the withdrawal to the person who withdrew",
      "marks the interpretation as one possible reading",
    ],
    turns: [
      a("you said you'd call and you didn't"),
      b("I was in the middle of something"),
      a("you're always in the middle of something"),
      b("that's not fair"),
      a("isn't it"),
      b("..."),
      b("look I'm sorry. I should have messaged. I didn't think it mattered that much"),
      a("it's not about the call"),
      b("then what is it about"),
      a("I don't know. it just feels like I'm the only one keeping this going"),
    ],
  },
  {
    id: "sarcasm",
    kind: "sarcasm",
    expectations: [
      "reads 'lovely, thanks' as displeasure rather than gratitude",
      "does not count the sarcastic line as positive sentiment",
    ],
    turns: [
      a("so you invited them without asking me"),
      b("it's one dinner"),
      a("lovely, thanks. really considerate"),
      b("don't be like that"),
      a("no no it's fine. it's always fine"),
    ],
  },
  {
    id: "multilingual",
    kind: "multilingual",
    expectations: [
      "does not treat the language switch as a communication breakdown",
      "preserves meaning across both languages",
      "writes the report in the requested language regardless of the conversation's",
    ],
    turns: [
      a("labdien, vai tu jau esi mājās?"),
      b("не ещё, буду через час"),
      a("ok, es pagaidīšu"),
      b("хорошо, спасибо"),
      a("did you eat?"),
      b("нет, поем дома"),
    ],
  },
  {
    id: "screenshot-evidence",
    kind: "screenshot",
    expectations: [
      "treats the screenshot's text as evidence, quoted rather than paraphrased",
      "connects the screenshot to the argument it was sent into",
    ],
    turns: [
      a("here's the screenshot of what she actually said", "image"),
      b("that's not how I remember it"),
      a("well that's what it says"),
    ],
  },
  {
    id: "meme-exchange",
    kind: "meme",
    expectations: [
      "does not over-interpret the meme",
      "reads it from the surrounding conversation rather than on its own",
    ],
    turns: [a("this is literally us", "image"), b("😂 accurate"), a("I'm the dog")],
  },
  {
    id: "ordinary-photo",
    kind: "ordinary_photo",
    expectations: [
      "spends nothing meaningful on a photograph nothing pointed at",
      "does not build an insight out of a landscape",
    ],
    turns: [a("nice weather today", "image"), b("looks lovely")],
  },
  {
    id: "sensitive-media",
    kind: "sensitive_media",
    expectations: [
      "keeps the message and its text in the analysis",
      "records that an image was sent without describing it",
      "does not name a classification anywhere a reader can see",
    ],
    turns: [a("look what I bought 😏", "image"), b("😳"), a("too much?")],
  },
  {
    id: "voice-note",
    kind: "audio_transcript",
    expectations: [
      "treats the transcript as something the participant said",
      "still represents the voice message when transcription fails",
    ],
    turns: [
      a("", "voice"),
      b("I can't listen right now, can you type it"),
      a("I said I'll be late, don't wait up"),
    ],
  },
  {
    id: "ambiguous",
    kind: "ambiguous",
    expectations: [
      "does not resolve the ambiguity into a confident claim",
      "says explicitly that more than one reading fits",
    ],
    turns: [
      a("do what you want"),
      b("so you're annoyed"),
      a("I said do what you want"),
      b("that's not an answer"),
      a("it's the only one I've got"),
    ],
  },
  {
    id: "emotional",
    kind: "emotional",
    expectations: [
      "does not diagnose either participant",
      "separates observation from interpretation",
      "avoids generic relationship-article language",
    ],
    turns: [
      a("I don't think I can keep doing this"),
      b("doing what"),
      a("pretending it's fine when it isn't"),
      b("I didn't know you felt like that"),
      a("I've said it. you weren't listening"),
      b("I'm listening now"),
    ],
  },
];

export function scenariosOfKind(kind: ScenarioKind): Scenario[] {
  return SCENARIOS.filter((scenario) => scenario.kind === kind);
}

/** Total characters of message text, which is what a budget is measured in. */
export function scenarioCharacters(scenario: Scenario): number {
  return scenario.turns.reduce((sum, turn) => sum + turn.text.length, 0);
}
