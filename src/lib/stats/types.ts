/**
 * Shape of the locally computed statistics.
 *
 * Everything here is deterministic and computed in the browser from the full
 * message set. Claude is never asked to calculate any of it - it only ever
 * receives the finished numbers, so the figures shown to the user cannot be
 * hallucinated.
 */

export interface ResponseStats {
  count: number;
  averageSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
  fastestSeconds: number;
  slowestSeconds: number;
}

export interface ResponseBucket {
  id: string;
  label: string;
  /** Inclusive lower bound in seconds. */
  fromSeconds: number;
  /** Exclusive upper bound in seconds, or null for the final open bucket. */
  toSeconds: number | null;
  count: number;
}

export interface LengthStats {
  averageCharacters: number;
  medianCharacters: number;
  averageWords: number;
  longestCharacters: number;
}

export interface ParticipantCharacteristics {
  messages: number;
  questions: number;
  questionRate: number;
  exclamations: number;
  exclamationRate: number;
  messagesWithEmoji: number;
  emojiRate: number;
  totalEmoji: number;
  links: number;
  repeatedMessages: number;
  maxConsecutiveMessages: number;
  averageConsecutiveMessages: number;
}

export interface WordCount {
  word: string;
  count: number;
  share: number;
}

export interface PhraseCount {
  phrase: string;
  count: number;
}

export interface DailyPoint {
  date: string;
  count: number;
}

export interface MonthlyPoint {
  month: string;
  count: number;
  perParticipant: Record<string, number>;
}

export interface ConversationStatistics {
  meta: {
    computedAt: string;
    /** Messages actually included in the statistics. */
    messagesAnalysed: number;
    mediaMessages: number;
    /** Wall-clock offset of the export, when it could be derived. */
    timezoneOffsetMinutes: number | null;
    conversationGapMinutes: number;
  };
  participants: { id: string; name: string }[];
  general: {
    totalMessages: number;
    perParticipant: Record<string, number>;
    sharePerParticipant: Record<string, number>;
    dateRange: { start: string; end: string; spanDays: number };
    activeDays: number;
    averageMessagesPerDay: number;
    averageMessagesPerActiveDay: number;
    length: LengthStats;
    lengthPerParticipant: Record<string, LengthStats>;
  };
  initiation: {
    /** Plain-language description of how these numbers were derived. */
    algorithm: string;
    totalConversations: number;
    perParticipant: Record<string, number>;
    sharePerParticipant: Record<string, number>;
    averageMessagesPerConversation: number;
  };
  response: {
    algorithm: string;
    overall: ResponseStats;
    perParticipant: Record<string, ResponseStats>;
    distribution: ResponseBucket[];
    longestResponse: {
      seconds: number;
      responderId: string;
      atIso: string;
    } | null;
    longestSilence: {
      seconds: number;
      fromIso: string;
      toIso: string;
      brokenById: string;
    } | null;
  };
  characteristics: {
    perParticipant: Record<string, ParticipantCharacteristics>;
    totalQuestions: number;
    totalLinks: number;
    totalEmoji: number;
  };
  time: {
    byHour: number[];
    byHourPerParticipant: Record<string, number[]>;
    /** Index 0 is Monday. */
    byWeekday: number[];
    daily: DailyPoint[];
    monthly: MonthlyPoint[];
    busiestHour: number | null;
    busiestWeekday: number | null;
  };
  words: {
    totalWords: number;
    uniqueWords: number;
    top: WordCount[];
    topPerParticipant: Record<string, WordCount[]>;
    phrases: PhraseCount[];
  };
}
