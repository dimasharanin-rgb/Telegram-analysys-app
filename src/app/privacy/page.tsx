import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

const SECTIONS: { heading: string; paragraphs: string[] }[] = [
  {
    heading: "What this application does with your file",
    paragraphs: [
      "When you choose a Telegram export, the file is read inside your browser. Parsing, the participant list, the date range and every statistic in the Stats tab are computed on your device. The export file itself is never uploaded.",
      "Results are held in the memory of the browser tab. Closing or reloading the tab discards them. There is no account, no database and no server-side storage of your conversation.",
    ],
  },
  {
    heading: "What is sent for AI analysis",
    paragraphs: [
      "The AI part of the product cannot run on your device. When you confirm the consent screen, the application sends: a compact digest of the computed statistics, and a selection of conversation excerpts — message text drawn from a subset of conversations, capped by a character budget.",
      "That request goes to this application's server, which forwards it to its AI provider, Anthropic, using a server-side API key. Anthropic processes the text in order to return the analysis. The application does not send your file, your media, your Telegram account details, or the messages that were not selected as excerpts.",
      "Participant display names are replaced with neutral labels (\"Participant A\", \"Participant B\") before anything leaves your browser. Message text is sent as written, so any names or details written inside messages are included in what is processed.",
      "Anthropic's handling of that data is governed by their terms, not by this notice. This application does not train models on your conversation and does not retain it after the response is returned.",
    ],
  },
  {
    heading: "Media",
    paragraphs: [
      "Photos, voice notes, videos and stickers are detected and counted, and are shown as unanalysed. Their contents are never opened and never sent anywhere.",
    ],
  },
  {
    heading: "Other people in the conversation",
    paragraphs: [
      "A conversation belongs to everyone in it. The other participants have not agreed to this analysis, and depending on where you live they may have rights over their messages — including under data protection law.",
      "Only upload conversations you are authorised to process. The consent step in this application records your own confirmation. It is not consent from the other participants, and it does not by itself make this use lawful in your jurisdiction.",
    ],
  },
  {
    heading: "Logging",
    paragraphs: [
      "The server logs the shape of a run — how many messages, how many requests, whether it succeeded — and never message content or API keys.",
    ],
  },
  {
    heading: "What the analysis is, and is not",
    paragraphs: [
      "The statistics are exact arithmetic over your export. Where a statistic depends on a judgement call — what counts as a separate conversation, what counts as a reply — the rule used is stated next to the number.",
      "The AI section is interpretation. It describes patterns in messages; it does not assess, diagnose or characterise the people who wrote them, and it should not be read as if it did.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="app-container flex h-16 items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight">
            Conversation Analyzer
          </Link>
          <Link
            href="/analyze"
            className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Analyze a conversation
          </Link>
        </div>
      </header>

      <main id="main" className="app-container max-w-3xl py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy notice</h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-muted">
          Written for the text-only MVP. It describes what this build actually does,
          without claiming more than it can deliver.
        </p>

        <div className="mt-10 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-line pt-6 text-sm text-faint">
          This notice describes the application&rsquo;s behaviour. It is not legal
          advice and does not establish that any particular use is lawful where you
          are.
        </p>
      </main>
    </div>
  );
}
