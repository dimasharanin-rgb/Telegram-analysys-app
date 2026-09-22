"use client";

import * as React from "react";

import type { AvoidanceFindings, ResponseAdvice } from "@/lib/ai/modules/schemas";
import { api, ApiError, type EvidenceMessage } from "@/lib/client/api";
import type { AdviceAllowance } from "@/lib/advice/limits";
import { AdviceLibrary } from "./AdviceLibrary";
import type { UserFacingError } from "@/lib/errors";
import Link from "next/link";

import { cx, formatDateTime } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { ErrorState } from "@/components/ErrorState";
import { EmptyModule } from "./FindingCard";

export interface AdviceTabProps {
  jobId: string;
  evidence: EvidenceMessage[];
  participants: { pseudonym: string; displayName: string; isSelf: boolean }[];
  available: boolean;
  /** What this analysis includes, and what is left of it. */
  allowance: AdviceAllowance;
}

const STYLE_LABELS: Record<string, string> = {
  direct: "Direct",
  warm: "Warm",
  short: "Short",
  "boundary-setting": "Boundary-setting",
  "de-escalating": "De-escalating",
};

const GROUP_GAP_MS = 6 * 60 * 60 * 1000;

interface Exchange {
  id: string;
  messages: EvidenceMessage[];
  startIso: string;
}

/** Splits the stored evidence back into the exchanges it came from. */
function groupIntoExchanges(evidence: EvidenceMessage[]): Exchange[] {
  const sorted = [...evidence].sort((a, b) => a.iso.localeCompare(b.iso));
  const exchanges: Exchange[] = [];
  let current: EvidenceMessage[] = [];

  const flush = () => {
    const first = current[0];
    if (first) {
      exchanges.push({ id: first.id, messages: current, startIso: first.iso });
    }
    current = [];
  };

  for (const message of sorted) {
    const previous = current[current.length - 1];
    if (previous) {
      const gap = Date.parse(`${message.iso}Z`) - Date.parse(`${previous.iso}Z`);
      if (!Number.isFinite(gap) || gap > GROUP_GAP_MS) flush();
    }
    current.push(message);
  }
  flush();

  return exchanges.filter((exchange) => exchange.messages.length >= 2);
}

/**
 * The two on-demand tools.
 *
 * They run against one exchange the user picks, rather than being precomputed,
 * because "what should I say" is a question about a moment. The conversation
 * text they use is what the server still holds - the exchanges the analysis
 * quoted - so nothing extra is stored to make this work.
 */
export function AdviceTab({
  jobId,
  evidence,
  participants,
  available,
  allowance,
}: AdviceTabProps) {
  const exchanges = React.useMemo(() => groupIntoExchanges(evidence), [evidence]);
  const self = participants.find((participant) => participant.isSelf);

  const [selected, setSelected] = React.useState<string | null>(
    exchanges[exchanges.length - 1]?.id ?? null,
  );
  const [intent, setIntent] = React.useState("");
  const [busy, setBusy] = React.useState<"respond" | "avoid" | null>(null);
  const [error, setError] = React.useState<UserFacingError | null>(null);
  const [advice, setAdvice] = React.useState<ResponseAdvice | null>(null);
  const [avoidance, setAvoidance] = React.useState<AvoidanceFindings | null>(null);
  const [copied, setCopied] = React.useState<number | null>(null);
  // The server is authoritative; this mirrors it so the count moves as soon
  // as a request is spent, and is corrected by whatever the server returns.
  const [spent, setSpent] = React.useState<AdviceAllowance>(allowance);

  if (!available) {
    return (
      <EmptyModule
        title="The response tools aren't included in this analysis"
        reason="They come with the deep text analysis, where you pick a moment and ask about it."
      />
    );
  }

  if (exchanges.length === 0 || !self) {
    return (
      <EmptyModule
        title="No exchange to ask about"
        reason="These tools work on the exchanges the analysis quoted as evidence. This analysis did not quote a long enough exchange."
      />
    );
  }

  const exchange = exchanges.find((entry) => entry.id === selected) ?? exchanges[0]!;

  const payload = () => ({
    jobId,
    speakerId: self.pseudonym,
    participants: participants.map((participant) => ({
      id: participant.pseudonym,
      label: participant.displayName,
    })),
    messages: exchange.messages.map((message) => ({
      id: message.id,
      p: message.participantId,
      t: message.text,
    })),
  });

  const ask = async (kind: "respond" | "avoid", extra?: string) => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "respond") {
        const wanted = [extra, intent.trim()].filter(Boolean).join(" ");
        const response = await api.responseAdvice({
          ...payload(),
          ...(wanted ? { intent: wanted } : {}),
        });
        setAdvice(response.advice);
        setSpent(response.allowance);
      } else {
        const response = await api.avoidanceAdvice(payload());
        setAvoidance(response.findings);
        setSpent(response.allowance);
      }
    } catch (thrown) {
      setError(
        thrown instanceof ApiError
          ? thrown.userFacing
          : { code: "UNKNOWN", message: "That didn't work.", retryable: true },
      );
    } finally {
      setBusy(null);
    }
  };

  const copy = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied(null), 2400);
    } catch {
      setCopied(null);
    }
  };

  const colorIndex = (pseudonym: string) =>
    Math.max(0, participants.findIndex((p) => p.pseudonym === pseudonym));

  const exhausted = spent.remaining <= 0;

  return (
    <div className="space-y-8">
      {/* What this costs, stated before anything is clicked. */}
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4",
          exhausted
            ? "border-amber-200 bg-amber-50/70"
            : "border-line bg-canvas-soft",
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {exhausted
              ? "You've used all the advice requests included with this analysis."
              : `${spent.remaining} of ${spent.total} advice ${
                  spent.total === 1 ? "request" : "requests"
                } remaining`}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {exhausted
              ? "The written guidance below is still available and costs nothing."
              : "Each suggestion below uses one. The written guidance is free."}
          </p>
        </div>
        {exhausted ? (
          <Link href="/pricing" className="shrink-0">
            <Button size="sm" variant="secondary">
              See options
            </Button>
          </Link>
        ) : null}
      </div>

      <section>
        <SectionTitle hint="From the exchanges this analysis quoted">
          Pick a moment
        </SectionTitle>
        <label className="sr-only" htmlFor="exchange-select">
          Choose an exchange
        </label>
        <select
          id="exchange-select"
          value={exchange.id}
          onChange={(event) => {
            setSelected(event.target.value);
            setAdvice(null);
            setAvoidance(null);
          }}
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink"
        >
          {exchanges.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {formatDateTime(entry.startIso)} — {entry.messages.length} messages
            </option>
          ))}
        </select>

        <ul className="mt-4 space-y-2.5 rounded-xl border border-line bg-canvas-soft px-4 py-4">
          {exchange.messages.map((message) => (
            <li key={message.id} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: seriesColor(colorIndex(message.participantId)) }}
              />
              <div className="min-w-0">
                <p className="text-xs text-muted">
                  {participants.find((p) => p.pseudonym === message.participantId)
                    ?.displayName ?? message.participantId}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                  {message.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error ? <ErrorState error={error} /> : null}

      <section>
        <SectionTitle>What could I say?</SectionTitle>
        <label
          htmlFor="advice-intent"
          className="block text-sm leading-relaxed text-muted"
        >
          What would you like to get across? Optional — leave it blank and the
          suggestions will work from the exchange alone.
        </label>
        <textarea
          id="advice-intent"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          rows={2}
          maxLength={500}
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink"
          placeholder="e.g. that I'm not upset, but I do need an answer this week"
        />
        <Button
          className="mt-3"
          onClick={() => void ask("respond")}
          disabled={busy !== null || exhausted}
        >
          {busy === "respond" ? "Thinking…" : "Suggest replies"}
        </Button>

        {advice ? (
          <div className="mt-5 space-y-3">
            <p className="rounded-lg border border-line bg-canvas-soft px-4 py-3 text-sm leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">How this was read: </span>
              {advice.reading}
            </p>

            {advice.suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.style}-${index}`}
                className="rounded-xl border border-line bg-white px-5 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-700">
                    {STYLE_LABELS[suggestion.style] ?? suggestion.style}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void copy(index, suggestion.text)}
                  >
                    {copied === index ? "Copied ✓" : "Copy"}
                  </Button>
                </div>
                <p className="mt-2.5 whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
                  {suggestion.text}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted">{suggestion.why}</p>
              </div>
            ))}

            {advice.caution ? (
              <p className="text-xs leading-relaxed text-faint">{advice.caution}</p>
            ) : null}
            <p className="text-xs leading-relaxed text-faint">
              These are options, not correct answers. Nothing is sent anywhere — copying
              is the only thing that leaves this page.
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <SectionTitle>What might land badly?</SectionTitle>
        <p className="text-sm leading-relaxed text-muted">
          Looks at wording in your own messages in this exchange that tends to make
          things harder, and suggests another way to say the same thing.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => void ask("avoid")}
          disabled={busy !== null || exhausted}
        >
          {busy === "avoid" ? "Reading…" : "Check this exchange"}
        </Button>

        {avoidance ? (
          <div className="mt-5 space-y-3">
            <p className="text-[0.95rem] leading-relaxed text-ink-soft">
              {avoidance.summary}
            </p>
            {avoidance.patterns.length === 0 ? (
              <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm leading-relaxed text-ink">
                Nothing in this exchange stood out as likely to escalate.
              </p>
            ) : (
              avoidance.patterns.map((pattern) => (
                <div
                  key={pattern.title}
                  className={cx("rounded-xl border border-line bg-white px-5 py-4")}
                >
                  <h4 className="text-sm font-semibold text-ink">{pattern.title}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {pattern.pattern}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{pattern.why}</p>
                  <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-positive">
                      Another way to put it
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">
                      {pattern.alternative}
                    </p>
                  </div>
                </div>
              ))
            )}
            {avoidance.note ? (
              <p className="text-xs leading-relaxed text-faint">{avoidance.note}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <AdviceLibrary
        canPersonalise={!exhausted}
        busy={busy !== null}
        onPersonalise={(topic) =>
          void ask("respond", `Apply this guidance to the exchange: ${topic.title}.`)
        }
      />
    </div>
  );
}
