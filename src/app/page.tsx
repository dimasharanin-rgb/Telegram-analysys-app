import Link from "next/link";
import { Button } from "@/components/ui/Button";

const STEPS = [
  {
    title: "Import",
    body: "Upload the JSON file Telegram Desktop produces when you export a chat. No login, no password, no access to your account.",
  },
  {
    title: "Measure",
    body: "Message counts, response times, who starts conversations and when you both talk are calculated on your device, exactly, from every message.",
  },
  {
    title: "Understand",
    body: "Selected excerpts are analysed for recurring patterns, each one shown with the messages it came from.",
  },
];

const EXAMPLES = [
  { label: "Messages", value: "4,812" },
  { label: "Conversations", value: "318" },
  { label: "Median reply", value: "7 min" },
  { label: "Starts most", value: "62%" },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="app-container flex h-16 items-center justify-between">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white"
            >
              C
            </span>
            Conversation Analyzer
          </span>
          <Link
            href="/privacy"
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Privacy
          </Link>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="border-b border-line bg-gradient-to-b from-brand-50/70 to-white">
          <div className="app-container py-16 sm:py-24">
            <div className="max-w-2xl">
              <p className="mb-4 text-sm font-medium text-brand-700">
                Telegram conversation analysis
              </p>
              <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
                Understand your conversations.
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-ink-soft">
                Turn your Telegram conversation history into clear communication
                patterns, statistics, and practical insights.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/analyze">
                  <Button size="lg" className="w-full sm:w-auto">
                    Analyze a conversation
                  </Button>
                </Link>
                <p className="text-sm text-muted sm:ml-2">
                  Free · no account needed
                </p>
              </div>
              <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted">
                Your conversation is analyzed privately. The MVP supports text-only
                Telegram exports.
              </p>
            </div>

            {/* A restrained preview of the kind of numbers the app produces. */}
            <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              {EXAMPLES.map((example) => (
                <div
                  key={example.label}
                  className="rounded-xl border border-line bg-white px-4 py-4"
                >
                  <p className="text-2xl font-semibold tracking-tight text-brand-600">
                    {example.value}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                    {example.label}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-faint">
              Illustrative figures. Your report is built entirely from your own export.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="app-container py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-t border-line pt-5">
                <span className="text-sm font-semibold text-brand-600">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-lg font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Privacy notice */}
        <section className="border-y border-line bg-canvas-soft">
          <div className="app-container py-14">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold tracking-tight">
                What happens to your conversation
              </h2>
              <ul className="mt-5 space-y-3 text-[0.95rem] leading-relaxed text-ink-soft">
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span>
                    The file is read in your browser. Parsing and every statistic are
                    computed there, not uploaded.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span>
                    For the AI part, selected excerpts of your conversation are sent to
                    this application&rsquo;s server and from there to its AI provider,
                    Anthropic, which processes the text to produce the analysis.
                    Participant names are replaced with labels before sending.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span>
                    Nothing is stored on the server: there is no database and no
                    account. Results live in your browser tab until you close it.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span>
                    A conversation involves other people. Only upload conversations you
                    are authorised to process.
                  </span>
                </li>
              </ul>
              <Link
                href="/privacy"
                className="mt-6 inline-block text-sm font-medium text-brand-700 underline underline-offset-4"
              >
                Read the full privacy notice
              </Link>
            </div>
          </div>
        </section>

        <section className="app-container py-16">
          <div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-line bg-white px-6 py-8 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Ready when you are
              </h2>
              <p className="mt-1 text-[0.95rem] text-muted">
                Export a chat from Telegram Desktop as JSON, then bring it here.
              </p>
            </div>
            <Link href="/analyze">
              <Button size="lg">Analyze a conversation</Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="app-container flex flex-col gap-2 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Conversation Analyzer · text-only MVP</p>
          <p className="text-xs text-faint">
            Analysis is interpretation, not a psychological assessment.
          </p>
        </div>
      </footer>
    </div>
  );
}
