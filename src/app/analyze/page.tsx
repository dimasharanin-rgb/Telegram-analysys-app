"use client";

import * as React from "react";
import Link from "next/link";

import type { Analysis } from "@/lib/ai/schema";
import type { ConversationSegment } from "@/lib/analysis/segmentation";
import type { UserFacingError } from "@/lib/errors";
import type { Conversation, NormalizedMessage } from "@/lib/model/message";
import type { ProgressEvent } from "@/lib/pipeline/run";
import type { ConversationStatistics } from "@/lib/stats";
import { computeStatistics } from "@/lib/stats";
import {
  buildAnalysisRequest,
  buildPseudonyms,
  type BuiltPayload,
} from "@/lib/pipeline/payload";
import { AnalysisError, requestAnalysis } from "@/lib/client/analyze-client";
import { ImportError, importTelegramFile } from "@/lib/client/importer";
import { buildInsightDeck, prioritiseDeck } from "@/lib/client/insights";
import { formatNumber } from "@/lib/client/format";

import { AnalysisProgress, ImportProgressIndicator } from "@/components/AnalysisProgress";
import { AppNav, type AppTab } from "@/components/AppNav";
import { ConsentModal } from "@/components/ConsentModal";
import { ConversationPreview } from "@/components/ConversationPreview";
import { ErrorState } from "@/components/ErrorState";
import { InsightDeck } from "@/components/InsightDeck";
import { StatsDashboard } from "@/components/StatsDashboard";
import { UploadDropzone } from "@/components/UploadDropzone";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

type Phase = "upload" | "importing" | "preview" | "analyzing" | "results";

interface ImportState {
  file: File;
  conversation: Conversation;
  statistics: ConversationStatistics;
  segments: ConversationSegment[];
}

const DEFAULT_GAP_MINUTES = 360;

export default function AnalyzePage() {
  const [phase, setPhase] = React.useState<Phase>("upload");
  const [tab, setTab] = React.useState<AppTab>("analyze");
  const [error, setError] = React.useState<UserFacingError | null>(null);

  const [importState, setImportState] = React.useState<ImportState | null>(null);
  const [gapMinutes, setGapMinutes] = React.useState(DEFAULT_GAP_MINUTES);
  const [importMessage, setImportMessage] = React.useState("Opening the file…");

  const [payload, setPayload] = React.useState<BuiltPayload | null>(null);
  const [consentOpen, setConsentOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<ProgressEvent | null>(null);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);

  /* --- derived ---------------------------------------------------------- */

  const messageMap = React.useMemo(() => {
    const map = new Map<string, NormalizedMessage>();
    for (const message of importState?.conversation.messages ?? []) {
      map.set(message.id, message);
    }
    return map;
  }, [importState]);

  const colorIndex = React.useMemo(() => {
    const map = new Map<string, number>();
    importState?.conversation.participants.forEach((participant, index) => {
      map.set(participant.id, index);
    });
    return map;
  }, [importState]);

  // Pseudonyms are derived from the participant order, so they are stable
  // whether or not an analysis request has been built yet.
  const pseudonyms = React.useMemo(
    () =>
      payload?.pseudonyms ??
      (importState ? buildPseudonyms(importState.conversation) : null),
    [payload, importState],
  );

  const deck = React.useMemo(() => {
    if (!analysis || !importState || !pseudonyms) return null;
    return prioritiseDeck(
      buildInsightDeck({
        statistics: importState.statistics,
        analysis,
        pseudonyms,
      }),
    );
  }, [analysis, importState, pseudonyms]);

  /* --- import ----------------------------------------------------------- */

  const runImport = React.useCallback(
    async (file: File, options: { chatId?: string; gap: number }) => {
      setPhase("importing");
      setError(null);
      setAnalysis(null);
      setPayload(null);
      setImportMessage("Opening the file…");

      try {
        const outcome = await importTelegramFile(file, {
          ...(options.chatId ? { chatId: options.chatId } : {}),
          conversationGapMinutes: options.gap,
          onProgress: (update) => setImportMessage(update.message),
        });
        setImportState({ file, ...outcome });
        setPhase("preview");
        setTab("analyze");
      } catch (thrown) {
        setError(
          thrown instanceof ImportError
            ? thrown.userFacing
            : {
                code: "UNKNOWN",
                message: "That file couldn't be imported.",
                hint: "Check it is the result.json produced by Telegram Desktop.",
                retryable: false,
              },
        );
        setPhase("upload");
      }
    },
    [],
  );

  const handleFile = React.useCallback(
    (file: File) => {
      void runImport(file, { gap: gapMinutes });
    },
    [runImport, gapMinutes],
  );

  const handleGapChange = React.useCallback(
    (minutes: number) => {
      setGapMinutes(minutes);
      if (!importState) return;
      // Recomputing from the already-parsed conversation is cheap - no
      // re-reading the file, no re-parsing.
      const recomputed = computeStatistics(importState.conversation, {
        conversationGapMinutes: minutes,
      });
      setImportState({
        ...importState,
        statistics: recomputed.statistics,
        segments: recomputed.segments,
      });
    },
    [importState],
  );

  const handleChangeChat = React.useCallback(
    (chatId: string) => {
      if (!importState) return;
      void runImport(importState.file, { chatId, gap: gapMinutes });
    },
    [importState, runImport, gapMinutes],
  );

  const startOver = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setImportState(null);
    setPayload(null);
    setAnalysis(null);
    setProgress(null);
    setError(null);
    setConsentOpen(false);
    setPhase("upload");
    setTab("analyze");
  }, []);

  /* --- consent + analysis ----------------------------------------------- */

  const openConsent = React.useCallback(() => {
    if (!importState) return;
    const built = buildAnalysisRequest(
      importState.conversation,
      importState.statistics,
      importState.segments,
    );
    setPayload(built);
    setConsentOpen(true);
  }, [importState]);

  const startAnalysis = React.useCallback(async () => {
    if (!payload) return;
    setConsentOpen(false);
    setPhase("analyzing");
    setError(null);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const outcome = await requestAnalysis(payload.request, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      setAnalysis(outcome.analysis);
      setPhase("results");
      setTab("insights");
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === "AbortError") {
        setPhase("preview");
        return;
      }
      setError(
        thrown instanceof AnalysisError
          ? thrown.userFacing
          : {
              code: "UNKNOWN",
              message: "The analysis could not be completed.",
              retryable: true,
            },
      );
      setPhase("preview");
    } finally {
      abortRef.current = null;
    }
  }, [payload]);

  const cancelAnalysis = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("preview");
  }, []);

  /* --- render ----------------------------------------------------------- */

  const available: Record<AppTab, boolean> = {
    analyze: true,
    insights: analysis !== null,
    stats: importState !== null,
  };

  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <header className="no-print border-b border-line bg-white">
        <div className="app-container flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white"
            >
              C
            </span>
            <span className="hidden sm:inline">Conversation Analyzer</span>
          </Link>

          <div className="flex items-center gap-3">
            {importState ? (
              <span className="hidden max-w-48 truncate text-sm text-muted md:inline">
                {importState.conversation.chatName}
              </span>
            ) : null}
            <Link
              href="/privacy"
              className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Privacy
            </Link>
          </div>
        </div>
      </header>

      <AppNav active={tab} available={available} onChange={setTab} />

      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        {tab === "analyze" ? (
          <div className="mx-auto max-w-2xl space-y-6">
            {error && phase !== "analyzing" ? (
              <ErrorState
                error={error}
                {...(payload && importState
                  ? { onRetry: () => void startAnalysis(), retryLabel: "Run analysis again" }
                  : {})}
                {...(importState ? { onStartOver: startOver } : {})}
              />
            ) : null}

            {phase === "upload" ? (
              <>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    Import a conversation
                  </h1>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">
                    Upload the JSON file Telegram Desktop creates when you export a chat.
                    It is read here in your browser.
                  </p>
                </div>
                <UploadDropzone onFile={handleFile} />
              </>
            ) : null}

            {phase === "importing" ? <ImportProgressIndicator message={importMessage} /> : null}

            {(phase === "preview" || (phase === "results" && tab === "analyze")) &&
            importState ? (
              phase === "results" ? (
                <CompletedSummary
                  conversation={importState.conversation}
                  statistics={importState.statistics}
                  onViewInsights={() => setTab("insights")}
                  onStartOver={startOver}
                  onReanalyze={() => void startAnalysis()}
                />
              ) : (
                <ConversationPreview
                  conversation={importState.conversation}
                  statistics={importState.statistics}
                  gapMinutes={gapMinutes}
                  onGapMinutesChange={handleGapChange}
                  onChangeChat={handleChangeChat}
                  onContinue={openConsent}
                  onStartOver={startOver}
                />
              )
            ) : null}

            {phase === "analyzing" ? (
              <AnalysisProgress event={progress} onCancel={cancelAnalysis} />
            ) : null}
          </div>
        ) : null}

        {tab === "insights" && deck && importState ? (
          <div className="mx-auto max-w-2xl">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                One pattern per card, each labelled as a measured figure or an AI
                interpretation. Open the evidence to see the messages behind it.
              </p>
            </div>
            <InsightDeck
              primary={deck.primary}
              extra={deck.extra}
              messages={messageMap}
              colorIndex={colorIndex}
            />
          </div>
        ) : null}

        {tab === "stats" && importState && pseudonyms ? (
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
                <p className="mt-1.5 text-sm text-muted">
                  Calculated on this device from every message in the export.
                </p>
              </div>
            </div>
            <StatsDashboard
              statistics={importState.statistics}
              analysis={analysis}
              pseudonyms={pseudonyms}
              conversationTitle={importState.conversation.chatName}
            />
          </div>
        ) : null}
      </main>

      {consentOpen && payload && importState ? (
        <ConsentModal
          excerptMessages={payload.request.excerpts.reduce(
            (sum, excerpt) => sum + excerpt.messages.length,
            0,
          )}
          excerptCharacters={payload.excerptCharacters}
          totalMessages={importState.statistics.general.totalMessages}
          participantCount={importState.conversation.participants.length}
          onConfirm={() => void startAnalysis()}
          onCancel={() => setConsentOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CompletedSummary({
  conversation,
  statistics,
  onViewInsights,
  onStartOver,
  onReanalyze,
}: {
  conversation: Conversation;
  statistics: ConversationStatistics;
  onViewInsights: () => void;
  onStartOver: () => void;
  onReanalyze: () => void;
}) {
  return (
    <Card>
      <CardBody className="sm:px-6 sm:py-6">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
          Analysis complete
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {conversation.chatName}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {formatNumber(statistics.general.totalMessages)} messages ·{" "}
          {formatNumber(statistics.initiation.totalConversations)} conversations ·{" "}
          {conversation.participants.length} participants
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={onViewInsights}>View insights</Button>
          <Button variant="secondary" onClick={onReanalyze}>
            Run analysis again
          </Button>
          <Button variant="ghost" onClick={onStartOver}>
            Analyse another conversation
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
