/**
 * Emotional-language indicators.
 *
 * These are word lists, not sentiment analysis. A hit means a word from a list
 * appeared — nothing more. The UI and the prompts both say so, because "12
 * messages contain an absolute like 'always' or 'never'" is a fact, while "this
 * conversation is 62% negative" would be a number pretending to be one.
 *
 * English and Russian, matching the stopword lists.
 */

export const INDICATOR_CATEGORIES = [
  "warmth",
  "tension",
  "apology",
  "reassurance",
  "absolutes",
  "hedging",
  "gratitude",
] as const;

export type IndicatorCategory = (typeof INDICATOR_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  warmth: "Warmth and affection",
  tension: "Tension and frustration",
  apology: "Apology and repair",
  reassurance: "Reassurance",
  absolutes: "Absolute wording",
  hedging: "Hedging and uncertainty",
  gratitude: "Thanks and appreciation",
};

export const CATEGORY_DESCRIPTIONS: Record<IndicatorCategory, string> = {
  warmth: "Words of affection, closeness or enjoyment.",
  tension: "Words associated with frustration, disagreement or irritation.",
  apology: "Apologies, admissions and attempts to put something right.",
  reassurance: "Attempts to settle, soothe or acknowledge the other person.",
  absolutes: "All-or-nothing wording such as “always”, “never”, “every time”.",
  hedging: "Softening or uncertainty such as “maybe”, “I guess”, “sort of”.",
  gratitude: "Thanks and appreciation.",
};

/**
 * Multi-word entries are matched as phrases; single words are matched on token
 * boundaries so "never" does not fire inside "nevertheless".
 */
const LEXICON: Record<IndicatorCategory, string[]> = {
  warmth: [
    "love", "loved", "lovely", "miss you", "missed you", "adore", "sweet",
    "happy", "glad", "excited", "proud of you", "care about you", "hug",
    "cuddle", "beautiful", "gorgeous", "favourite", "favorite", "cute",
    "люблю", "любимая", "любимый", "скучаю", "обнимаю", "родной", "родная",
    "милый", "милая", "счастлив", "счастлива", "рад", "рада",
  ],
  tension: [
    "annoyed", "annoying", "angry", "upset", "frustrated", "frustrating",
    "unfair", "ridiculous", "whatever", "seriously", "again", "tired of",
    "sick of", "fed up", "not ok", "not okay", "not fine", "you always",
    "you never", "don't care", "dont care", "forget it", "stop",
    "злюсь", "бесит", "раздражает", "надоело", "достало", "неправда",
    "нечестно", "хватит", "перестань", "обидно", "обиделась", "обиделся",
  ],
  apology: [
    "sorry", "apologise", "apologize", "apology", "my fault", "my bad",
    "i was wrong", "i shouldn't have", "i shouldnt have", "didn't mean",
    "didnt mean", "forgive", "that was unfair of me",
    "извини", "извините", "прости", "простите", "виноват", "виновата",
    "моя вина", "не хотел", "не хотела",
  ],
  reassurance: [
    "it's ok", "its ok", "it's okay", "its okay", "no worries", "don't worry",
    "dont worry", "i understand", "i hear you", "that makes sense",
    "you're right", "youre right", "fair enough", "take your time",
    "i'm here", "im here", "no rush",
    "не переживай", "всё хорошо", "все хорошо", "понимаю", "ты прав",
    "ты права", "не спеши", "я рядом",
  ],
  absolutes: [
    "always", "never", "every time", "everyone", "nobody", "nothing",
    "all the time", "constantly", "completely", "totally", "absolutely",
    "всегда", "никогда", "каждый раз", "все время", "всё время", "никто",
    "ничего", "постоянно", "совершенно",
  ],
  hedging: [
    "maybe", "perhaps", "i guess", "i suppose", "sort of", "kind of",
    "kinda", "sorta", "i think maybe", "not sure", "possibly", "might be",
    "i dunno", "dunno",
    "наверное", "возможно", "кажется", "вроде", "не уверен", "не уверена",
    "может быть",
  ],
  gratitude: [
    "thank you", "thanks", "thankful", "grateful", "appreciate",
    "appreciated", "means a lot", "you're the best", "youre the best",
    "спасибо", "благодарю", "ценю", "признателен", "признательна",
  ],
};

interface CompiledCategory {
  category: IndicatorCategory;
  phrases: string[];
  words: Set<string>;
}

const COMPILED: CompiledCategory[] = INDICATOR_CATEGORIES.map((category) => {
  const entries = LEXICON[category];
  return {
    category,
    phrases: entries.filter((entry) => entry.includes(" ")),
    words: new Set(entries.filter((entry) => !entry.includes(" "))),
  };
});

export type IndicatorCounts = Record<IndicatorCategory, number>;

export function emptyIndicatorCounts(): IndicatorCounts {
  return {
    warmth: 0,
    tension: 0,
    apology: 0,
    reassurance: 0,
    absolutes: 0,
    hedging: 0,
    gratitude: 0,
  };
}

/**
 * Counts each category at most once per message: the question is "did this
 * message contain an apology", not "how many apology words did it pack in".
 */
export function scoreMessage(
  text: string,
  tokens: readonly string[],
): IndicatorCounts {
  const counts = emptyIndicatorCounts();
  if (text.length === 0) return counts;

  const lower = text.toLowerCase();
  const tokenSet = new Set(tokens);

  for (const compiled of COMPILED) {
    let hit = false;
    for (const token of tokenSet) {
      if (compiled.words.has(token)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const phrase of compiled.phrases) {
        if (lower.includes(phrase)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) counts[compiled.category] = 1;
  }

  return counts;
}

export function addCounts(target: IndicatorCounts, source: IndicatorCounts): void {
  for (const category of INDICATOR_CATEGORIES) {
    target[category] += source[category];
  }
}
