/**
 * The consent document.
 *
 * Versioned, because a consent record is only meaningful if you can say which
 * text the person actually saw. `CONSENT_DOCUMENT_VERSION` is stored on every
 * request and printed on the PDF copy.
 *
 * Everything here describes what this build genuinely does. The retention
 * section in particular is written from the implementation, not from what
 * would sound reassuring.
 */

import type { ConsentDataType } from "./state";

export const CONSENT_DOCUMENT_VERSION = "1.0";

export interface ConsentDocumentInput {
  /** Display name of the person being asked. */
  participantName: string;
  /** How the requester is identified to them. */
  requestedByLabel: string;
  conversationTitle: string;
  messageCount: number;
  dateRange: { start: string; end: string };
  dataTypes: ConsentDataType[];
  purpose: string;
  aiProvider: string;
  expiresAt: string;
}

export interface ConsentSection {
  heading: string;
  /** Paragraphs of body text. */
  body: string[];
  /** Optional itemised list rendered under the body. */
  items?: { label: string; value: string; included: boolean }[];
}

export interface ConsentDocument {
  version: string;
  title: string;
  sections: ConsentSection[];
}

const DATA_TYPE_LABELS: Record<ConsentDataType, string> = {
  TEXT: "Text messages",
  IMAGES: "Photos and images",
  AUDIO: "Voice messages and audio",
  VIDEO: "Videos and video messages",
};

const ALL_DATA_TYPES: ConsentDataType[] = ["TEXT", "IMAGES", "AUDIO", "VIDEO"];

export function buildConsentDocument(input: ConsentDocumentInput): ConsentDocument {
  const included = new Set(input.dataTypes);

  return {
    version: CONSENT_DOCUMENT_VERSION,
    title: "Conversation Analysis Consent",
    sections: [
      {
        heading: "1. Participants",
        body: [
          `This request concerns a Telegram conversation between ${input.requestedByLabel} and ${input.participantName}.`,
          `The conversation covers ${input.messageCount.toLocaleString("en-US")} messages between ${input.dateRange.start} and ${input.dateRange.end}.`,
          `${input.requestedByLabel} is asking for your agreement to have this conversation analysed. You are ${input.participantName}.`,
        ],
      },
      {
        heading: "2. Data being processed",
        body: [
          "Only the categories ticked below are covered by this request. Anything unticked is not authorised and is not sent for analysis.",
        ],
        items: ALL_DATA_TYPES.map((type) => ({
          label: DATA_TYPE_LABELS[type],
          value: included.has(type) ? "Included" : "Not included",
          included: included.has(type),
        })),
      },
      {
        heading: "3. Purpose",
        body: [
          input.purpose,
          "The result is a descriptive report: counts and timings computed from the messages, plus written commentary on communication patterns. It is not an assessment of you as a person, and it is not a psychological, medical or professional opinion.",
        ],
      },
      {
        heading: "4. AI processing",
        body: [
          `Selected parts of the conversation are processed by an AI system operated by ${input.aiProvider} in order to produce the written commentary.`,
          `${input.aiProvider} receives the message text of the selected excerpts. It does not receive your Telegram account details. Participant names are replaced with neutral labels before anything is sent, although names written inside the messages themselves are included as written.`,
          `${input.aiProvider}'s own terms govern what they do with the data they receive. This application does not train any model on your conversation.`,
        ],
      },
      {
        heading: "5. Processing scope",
        body: [
          "The whole conversation is read on the requester's own device to compute statistics. Only a selection of excerpts — a bounded subset of messages, chosen to cover the conversation — is sent for AI analysis.",
          "Photos, voice messages and videos are counted but never opened or sent, in this version of the application.",
        ],
      },
      {
        heading: "6. Retention",
        body: [
          "The original export file is never uploaded. It is read in the requester's browser.",
          "Until the analysis has run, the selected excerpts are stored on the application's server, because this consent decision is made separately from the upload. Once the analysis completes, only the exchanges the report actually quotes as evidence are kept; every other excerpt is deleted.",
          "Conversation metadata (participant names, message counts, dates) and the finished report are kept so the requester can reopen the result, until they delete it.",
          "This consent record — what was asked, which version of this document was shown, and what you decided — is kept as the record of that decision.",
        ],
      },
      {
        heading: "7. Withdrawal",
        body: [
          "You can withdraw this consent at any time, using the same link that brought you here.",
          "There is no deadline on withdrawal and you do not have to give a reason.",
        ],
      },
      {
        heading: "8. Consequences",
        body: [
          "If you do not agree, the analysis does not run. The conversation is not sent for AI processing.",
          "If you withdraw after agreeing, no further analysis of this conversation will start, and any analysis still waiting to run is stopped. A report that has already been produced will already exist; withdrawal does not retroactively unmake it, and the requester can delete it.",
        ],
      },
      {
        heading: "9. Validity",
        body: [
          `This request expires on ${input.expiresAt.slice(0, 10)}. After that it can no longer be accepted, and a new request would have to be sent.`,
          `Consent document version ${CONSENT_DOCUMENT_VERSION}.`,
        ],
      },
      {
        heading: "10. What this record is",
        body: [
          "Choosing “I agree” records your decision, the time you made it, the version of this document you were shown and the categories of data it covered.",
          "This is a consent record kept by the application. It is not a qualified electronic signature, and this application does not claim that it satisfies any particular legal standard for one.",
        ],
      },
    ],
  };
}

/** Short summary line used in listings and the request header. */
export function consentSummaryLine(input: {
  dataTypes: ConsentDataType[];
  aiProvider: string;
}): string {
  const types = input.dataTypes.map((type) => DATA_TYPE_LABELS[type].toLowerCase());
  return `${types.join(", ")} processed by ${input.aiProvider}`;
}

export { DATA_TYPE_LABELS };
