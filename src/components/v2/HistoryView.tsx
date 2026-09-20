"use client";

import * as React from "react";
import Link from "next/link";

import { JOB_STATUS_LABELS } from "@/lib/analysis/job";
import { api, type JobSummary } from "@/lib/client/api";
import { formatDate, formatDateTime, formatNumber } from "@/lib/client/format";
import { toUserFacing, useRemote } from "@/lib/client/use-remote";

import { ErrorState } from "@/components/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

type Tone = React.ComponentProps<typeof Badge>["tone"];

const STATUS_TONE: Record<JobSummary["status"], Tone> = {
  CREATED: "neutral",
  WAITING_FOR_CONSENT: "caution",
  WAITING_FOR_PAYMENT: "caution",
  QUEUED: "brand",
  PROCESSING: "brand",
  COMPLETED: "positive",
  FAILED: "caution",
  CANCELLED: "neutral",
};

/**
 * Every analysis this browser has started.
 *
 * Deliberately a list of analyses, not of conversations: the same chat can be
 * analysed more than once, and what a person comes back for is a report.
 */
export function HistoryView() {
  const fetcher = React.useCallback(() => api.listJobs(), []);
  const remote = useRemote(fetcher, "Couldn't load your analyses.");
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const jobs = remote.data?.jobs ?? null;
  const { error, reload, fail } = remote;

  const remove = async (jobId: string) => {
    setBusy(jobId);
    try {
      await api.deleteJob(jobId);
      setPendingDelete(null);
      reload();
    } catch (thrown) {
      fail(toUserFacing(thrown, "Couldn't delete that analysis."));
    } finally {
      setBusy(null);
    }
  };

  if (error && !jobs) {
    return <ErrorState error={error} onRetry={reload} />;
  }

  if (!jobs) {
    return <p className="py-16 text-center text-muted">Loading…</p>;
  }

  if (jobs.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight">No analyses yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            Export a chat from Telegram Desktop as JSON and bring it here. Your
            analyses are tied to this browser — there is no account to sign in to.
          </p>
          <Link href="/analyze" className="mt-6 inline-block">
            <Button size="lg">Start an analysis</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      <ul className="space-y-3">
        {jobs.map((job) => {
          const conversation = job.conversation;
          const confirming = pendingDelete === job.id;

          return (
            <li key={job.id}>
              <Card>
                <CardBody className="sm:px-6 sm:py-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold tracking-tight">
                          {conversation?.title ?? "Deleted conversation"}
                        </h2>
                        <Badge tone={STATUS_TONE[job.status]}>
                          {JOB_STATUS_LABELS[job.status]}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-sm text-muted">
                        {conversation
                          ? `${formatNumber(conversation.messageCount)} messages · ${formatDate(
                              conversation.startDate,
                            )} – ${formatDate(conversation.endDate)}`
                          : "The conversation behind this analysis has been deleted."}
                      </p>
                      <p className="mt-1 text-xs text-faint">
                        {job.productName} · started {formatDateTime(job.createdAt)}
                        {job.completedAt
                          ? ` · finished ${formatDateTime(job.completedAt)}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link href={`/analyses/${job.id}`}>
                        <Button size="sm" variant={job.status === "COMPLETED" ? "primary" : "secondary"}>
                          {job.status === "COMPLETED" ? "Open report" : "Continue"}
                        </Button>
                      </Link>
                      {confirming ? null : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPendingDelete(job.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  {confirming ? (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
                      <p className="text-sm leading-relaxed text-ink">
                        Delete this analysis and everything stored with it — the
                        statistics, the written report and the quoted excerpts? This
                        cannot be undone.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => void remove(job.id)}
                          disabled={busy === job.id}
                        >
                          {busy === job.id ? "Deleting…" : "Delete permanently"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPendingDelete(null)}
                          disabled={busy === job.id}
                        >
                          Keep it
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
