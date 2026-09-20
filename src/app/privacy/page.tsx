import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

const SECTIONS: { heading: string; paragraphs: string[] }[] = [
  {
    heading: "What this application does with your file",
    paragraphs: [
      "When you choose a Telegram export, the file is read inside your browser. Parsing, the participant list, the date range and every statistic in the Stats tab are computed on your device. The export file itself is never uploaded.",
      "To prepare an analysis, the application sends the server a compact digest of those computed statistics and a selection of conversation excerpts — message text drawn from a subset of conversations, capped by a character budget. It does not send the file, the media, your Telegram account details, or the messages that were not selected.",
    ],
  },
  {
    heading: "What is stored on the server, and for how long",
    paragraphs: [
      "An analysis is prepared before it runs, because the other participants have to be asked first and that takes as long as it takes. So the digest and the selected excerpts are stored while the analysis waits.",
      "Once an analysis has run, the excerpts are pruned: only the exchanges the finished report actually quotes as evidence are kept. Every other excerpt is deleted at that point.",
      "What remains is the conversation's metadata (participant names, message counts, dates), the computed statistics, the finished report, the quoted exchanges, and the consent records. That is kept so you can reopen the report, until you delete the analysis — which removes all of it.",
      "This application does not set a fixed retention period and does not claim one. Stored data is kept until you delete the analysis it belongs to.",
    ],
  },
  {
    heading: "How you are identified",
    paragraphs: [
      "There is no account, no email address and no password. Your analyses are linked to a signed cookie set in this browser. Clearing your cookies loses access to them; it does not by itself delete them, so delete anything you want removed before you clear.",
    ],
  },
  {
    heading: "What is sent for AI analysis",
    paragraphs: [
      "The AI part of the product cannot run on your device. When an analysis runs, the server sends the statistics digest and the selected excerpts to its AI provider, Anthropic, using a server-side API key. Anthropic processes the text in order to return the analysis.",
      "Participant display names are replaced with neutral labels (\"Participant A\", \"Participant B\") before anything leaves your browser. Message text is sent as written, so any names or details written inside messages are included in what is processed.",
      "Message text is handled strictly as content to be analysed. Anything inside a message that reads like an instruction to the AI system is treated as part of the conversation, not as something to act on.",
      "Anthropic's handling of that data is governed by their terms, not by this notice. This application does not train models on your conversation.",
    ],
  },
  {
    heading: "Other people in the conversation",
    paragraphs: [
      "A conversation belongs to everyone in it. Before an analysis runs, this application asks each other participant for their agreement, using a link you pass on to them. They see what will be processed, by whom and why, and they can decline or withdraw at any time using the same link.",
      "An analysis does not run while any required participant has declined, withdrawn or not yet answered. If someone withdraws after agreeing, no further analysis of that conversation starts and anything still waiting to run is stopped.",
      "This consent flow records a decision: what was asked, which version of the consent document the person was shown, and what they chose. It is a record kept by this application. It is not a qualified electronic signature, and it does not by itself make any particular use lawful where you live — only upload conversations you are authorised to process.",
    ],
  },
  {
    heading: "Media",
    paragraphs: [
      "Photos, voice notes, videos and stickers are detected and counted, and are shown as unanalysed. Their contents are never opened and never sent anywhere in this version.",
    ],
  },
  {
    heading: "Payment",
    paragraphs: [
      "Paid analyses are unlocked by a credit held against your browser's identity. Credits are created by this application's server only from an event its payment provider signed — never because a browser reported that a checkout succeeded.",
      "Card details are handled by the payment provider on their own pages. This application never sees or stores them.",
    ],
  },
  {
    heading: "Logging",
    paragraphs: [
      "The server logs the shape of a run — how many messages, how many requests, whether it succeeded — and never message content or API keys. Errors returned to the browser are mapped to plain descriptions; internal details and stack traces stay on the server.",
    ],
  },
  {
    heading: "What the analysis is, and is not",
    paragraphs: [
      "The statistics are exact arithmetic over your export. Where a statistic depends on a judgement call — what counts as a separate conversation, what counts as a reply — the rule used is stated next to the number.",
      "The written sections are interpretation. They describe patterns in messages; they do not assess, diagnose or characterise the people who wrote them, and they should not be read as if they did.",
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
          Written for the text-only build. It describes what this application actually
          does, without claiming more than it can deliver.
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
