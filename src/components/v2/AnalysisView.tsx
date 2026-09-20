"use client";

import * as React from "react";
import Link from "next/link";

import { JOB_STATUS_LABELS } from "@/lib/analysis/job";
import { formatPrice, getProduct } from "@/lib/billing/products";
import {
  api,
  runJob,
  type ConsentGate,
  type JobDetail,
  type JobResult,
  type RunProgress,
} from "@/lib/client/api";
import { formatDate, formatNumber } from "@/lib/client/format";
import { toUserFacing, useRemote } from "@/lib/client/use-remote";

import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, SectionTitle } from "@/components/ui/Card";
import { ConsentPanel } from "@/components/v2/ConsentPanel";
import { SiteHeader } from "@/components/v2/SiteHeader";
import { ResultView } from "@/components/v2/ResultView";

/** How often to re-check while something outside this tab has to happen. */
const POLL_MS = 8_000;

/** What the page needs in one shot: the job, plus its result once there is one. */
interface JobView {
  detail: JobDetail;
  result: JobResult | null;
}

export function AnalysisView({ jobId }: { jobId: string }) {
  const fetcher = React.useCallback(async (): Promise<JobView> => {
    const detail = await api.getJob(jobId);
    return {
      detail,
      result: detail.job.status === "COMPLETED" ? await api.getResult(jobId) : null,
    };
  }, [jobId]);

  const { data, error, reload, set, fail } = useRemote(
    fetcher,
    "Couldn't load this analysis.",
  );

  const [progress, setProgress] = React.useState<RunProgress | null>(null);
  const [running, setRunning] = React.useState(false);
  const [checkingOut, setCheckingOut] = React.useState(false);

  const detail = data?.detail ?? null;
  const result = data?.result ?? null;

  // Consent and payment happen outside this tab, so the page checks back
  // rather than asking the user to reload.
  const status = detail?.job.status;
  const shouldPoll = status === "WAITING_FOR_CONSENT" || status === "WAITING_FOR_PAYMENT";

  React.useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, reload]);

  const start = React.useCallback(async () => {
    setRunning(true);
    setProgress(null);
    try {
      await runJob(jobId, { onProgress: setProgress });
    } catch (thrown) {
      fail(toUserFacing(thrown, "The analysis failed."));
    } finally {
      setRunning(false);
      reload();
    }
  }, [jobId, reload, fail]);

  const buy = React.useCallback(async () => {
    if (!detail) return;
    setCheckingOut(true);
    try {
      const session = await api.checkout(detail.job.productId, `/analyses/${jobId}`);
      window.location.assign(session.url);
    } catch (thrown) {
      fail(toUserFacing(thrown, "Couldn't start checkout."));
      setCheckingOut(false);
    }
  }, [detail, jobId, fail]);

  const onGateChanged = React.useCallback(
    (gate: ConsentGate) => {
      set((current) =>
        current ? { ...current, detail: { ...current.detail, gate } } : current,
      );
      reload();
    },
    [set, reload],
  );

  if (!detail) {
    return (
      <Shell>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <p className="py-16 text-center text-muted">Loading…</p>
        )}
      </Shell>
    );
  }

  /* --- completed ------------------------------------------------------- */
  if (detail.job.status === "COMPLETED" && result) {
    return <ResultView detail={detail} result={result} />;
  }

  const product = getProduct(detail.job.productId);

  return (
    <Shell subtitle={detail.conversation.title}>
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardBody className="sm:px-6 sm:py-6">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
              {JOB_STATUS_LABELS[detail.job.status]}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              {detail.conversation.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              {formatNumber(detail.conversation.messageCount)} messages ·{" "}
              {formatDate(detail.conversation.startDate)} –{" "}
              {formatDate(detail.conversation.endDate)}
              {product ? ` · ${product.name}` : ""}
            </p>
          </CardBody>
        </Card>

        {error ? <ErrorState error={error} onRetry={reload} /> : null}

        {detail.job.status === "WAITING_FOR_CONSENT" ? (
          <>
            <ConsentPanel
              conversationId={detail.job.conversationId}
              gate={detail.gate}
              onChanged={onGateChanged}
            />
            <p className="text-xs leading-relaxed text-faint">
              This page checks back on its own. You can close it and come back — the
              request stays open, and the analysis is here when it is ready to run.
            </p>
          </>
        ) : null}

        {detail.job.status === "WAITING_FOR_PAYMENT" && product ? (
          <Card>
            <CardBody className="sm:px-6 sm:py-6">
              <SectionTitle hint={formatPrice(product)}>Unlock this analysis</SectionTitle>
              <p className="text-sm leading-relaxed text-muted">
                Consent is in place. {product.name} — {product.description}
              </p>
              {detail.entitlement.reason === "free_limit_reached" ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-ink">
                  You have used all of your free analyses.
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={() => void buy()} disabled={checkingOut}>
                  {checkingOut ? "Opening checkout…" : `Continue — ${formatPrice(product)}`}
                </Button>
                <Link href="/pricing">
                  <Button variant="secondary">See all options</Button>
                </Link>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {detail.job.status === "QUEUED" || detail.job.status === "CREATED" ? (
          <Card>
            <CardBody className="sm:px-6 sm:py-6">
              <SectionTitle>Ready to run</SectionTitle>
              <p className="text-sm leading-relaxed text-muted">
                Consent is in place and the analysis is unlocked. Running it sends the
                selected excerpts for AI analysis.
              </p>
              <Button
                size="lg"
                className="mt-5"
                onClick={() => void start()}
                disabled={running || !detail.runnable}
              >
                {running ? "Running…" : "Run the analysis"}
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {running || detail.job.status === "PROCESSING" ? (
          <RunProgressPanel progress={progress} job={detail} />
        ) : null}

        {detail.job.status === "FAILED" ? (
          <Card>
            <CardBody className="sm:px-6 sm:py-6">
              <SectionTitle>This analysis didn&rsquo;t finish</SectionTitle>
              <p className="text-sm leading-relaxed text-muted">
                Nothing was charged — the credit was returned. You can prepare a new
                analysis of the same conversation.
              </p>
              <Link href="/analyze" className="mt-5 inline-block">
                <Button>Start a new analysis</Button>
              </Link>
            </CardBody>
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Link href="/analyses">
            <Button variant="ghost">All analyses</Button>
          </Link>
        </div>
      </div>
    </Shell>
  );
}

function RunProgressPanel({
  progress,
  job,
}: {
  progress: RunProgress | null;
  job: JobDetail;
}) {
  const percent = progress?.percent ?? job.job.progress;
  const message = progress?.message ?? job.job.stageMessage ?? "Preparing conversation";

  return (
    <Card>
      <CardBody className="py-8 text-center sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-brand-700">
          Analyzing
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{message}</h2>
        {progress ? (
          <p className="mt-1.5 text-sm text-muted">
            Step {progress.step} of {progress.totalSteps}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-muted">
            This analysis is already running. The page will catch up.
          </p>
        )}

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label="Analysis progress"
          className="mx-auto mt-6 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function Shell({
  subtitle,
  children,
}: {
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader {...(subtitle ? { subtitle } : {})} />
      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
