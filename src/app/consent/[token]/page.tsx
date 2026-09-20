import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buildConsentDocument } from "@/lib/consent/document";
import { CONSENT_STATUS_LABELS } from "@/lib/consent/state";
import { ConsentDecision } from "@/components/consent/ConsentDecision";
import { consentProvider } from "@/server/consent/provider";
import {
  getConversationUnscoped,
  getParticipant,
} from "@/server/repositories/conversations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conversation analysis consent",
  robots: { index: false, follow: false },
};

/**
 * The page the other participant sees.
 *
 * It is reached with a link token, not an account, because the person being
 * asked has no reason to sign up for anything. It shows what is being
 * requested, of whom, by whom, and the full document — and it shows no message
 * content: consent is asked for before anything is read, not after.
 */
export default async function ConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const provider = consentProvider();

  const request = provider.resolveToken(token);
  if (!request) notFound();

  // Opening the link is itself a recorded event, once.
  let current = request;
  try {
    current = provider.markViewed(token);
  } catch {
    // Expired or already decided; the stored record is what we show.
  }

  const conversation = getConversationUnscoped(current.conversationId);
  const participant = getParticipant(current.participantId);
  if (!conversation || !participant) notFound();

  const document = buildConsentDocument({
    participantName: participant.displayName,
    requestedByLabel: current.requestedByLabel,
    conversationTitle: conversation.title,
    messageCount: conversation.messageCount,
    dateRange: { start: conversation.startDate, end: conversation.endDate },
    dataTypes: current.dataTypes,
    purpose: current.purpose,
    aiProvider: current.aiProvider,
    expiresAt: current.expiresAt,
  });

  return (
    <div className="min-h-dvh bg-canvas-soft">
      <header className="border-b border-line bg-white">
        <div className="app-container flex h-16 items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white"
          >
            C
          </span>
          <span className="font-semibold tracking-tight">Conversation Analyzer</span>
        </div>
      </header>

      <main id="main" className="app-container max-w-3xl py-10 sm:py-14">
        <div className="rounded-2xl border border-line bg-white px-6 py-7 sm:px-9 sm:py-9">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-brand-700">
            Consent request
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {document.title}
          </h1>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
            {current.requestedByLabel} would like to run an analysis of a Telegram
            conversation the two of you had, and is asking whether you agree.
          </p>

          <dl className="mt-7 grid gap-x-8 gap-y-4 border-y border-line py-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Participant</dt>
              <dd className="mt-0.5 font-medium text-ink">{participant.displayName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Requested by</dt>
              <dd className="mt-0.5 font-medium text-ink">{current.requestedByLabel}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">AI provider</dt>
              <dd className="mt-0.5 font-medium text-ink">{current.aiProvider}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Status</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {CONSENT_STATUS_LABELS[current.status]}
              </dd>
            </div>
          </dl>

          <div className="mt-8">
            <ConsentDecision
              token={token}
              status={current.status}
              participantName={participant.displayName}
            />
          </div>
        </div>

        {/* The full document, as shown and as recorded. */}
        <section className="mt-8 rounded-2xl border border-line bg-white px-6 py-7 sm:px-9">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">The full terms</h2>
            <a
              href={`/api/consent/${token}/document`}
              className="text-sm font-medium text-brand-700 underline underline-offset-4"
            >
              Download as PDF
            </a>
          </div>

          <div className="mt-6 space-y-7">
            {document.sections.map((section) => (
              <section key={section.heading}>
                <h3 className="text-[0.95rem] font-semibold tracking-tight text-ink">
                  {section.heading}
                </h3>
                {section.body.map((paragraph) => (
                  <p
                    key={paragraph.slice(0, 40)}
                    className="mt-2 text-sm leading-relaxed text-ink-soft"
                  >
                    {paragraph}
                  </p>
                ))}
                {section.items ? (
                  <ul className="mt-3 space-y-1.5">
                    {section.items.map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center gap-2.5 text-sm"
                      >
                        <span
                          aria-hidden="true"
                          className={
                            item.included
                              ? "grid h-4 w-4 place-items-center rounded border border-brand-600 bg-brand-600 text-[0.6rem] text-white"
                              : "h-4 w-4 rounded border border-line bg-white"
                          }
                        >
                          {item.included ? "✓" : ""}
                        </span>
                        <span className={item.included ? "text-ink" : "text-muted"}>
                          {item.label} — {item.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <p className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-faint">
            Consent document version {document.version}. This page records a consent
            decision kept by this application. It is not a qualified electronic
            signature, and this application does not claim that it meets any particular
            legal standard for one.
          </p>
        </section>
      </main>
    </div>
  );
}
