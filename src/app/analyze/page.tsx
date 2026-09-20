"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { AnalysisModule } from "@/lib/analysis/modules";
import { getProduct } from "@/lib/billing/products";
import type { ConversationSegment } from "@/lib/analysis/segmentation";
import type { UserFacingError } from "@/lib/errors";
import type { Conversation } from "@/lib/model/message";
import type { ConversationStatistics } from "@/lib/stats";
import { computeStatistics } from "@/lib/stats";
import { computeAdvancedStatistics } from "@/lib/stats/advanced";
import { buildAdvancedDigest, buildAnalysisRequest } from "@/lib/pipeline/payload";
import { api, ApiError } from "@/lib/client/api";
import { ImportError, importTelegramFile } from "@/lib/client/importer";

import { ImportProgressIndicator } from "@/components/AnalysisProgress";
import { ConversationPreview } from "@/components/ConversationPreview";
import { ErrorState } from "@/components/ErrorState";
import { UploadDropzone } from "@/components/UploadDropzone";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { PlanPicker } from "@/components/v2/PlanPicker";
import { SelfPicker } from "@/components/v2/SelfPicker";
import { SiteHeader } from "@/components/v2/SiteHeader";

type Phase = "upload" | "importing" | "configure" | "creating";

interface ImportState {
  file: File;
  conversation: Conversation;
  statistics: ConversationStatistics;
  segments: ConversationSegment[];
}

const DEFAULT_GAP_MINUTES = 360;
const DEFAULT_MODULES: AnalysisModule[] = [
  "COMMUNICATION",
  "INTERACTION",
  "TOPICS",
  "EMOTIONAL_LANGUAGE",
  "CONFLICT",
  "TIMELINE",
  "PERSONAL_PROFILES",
  "RESPONSE_ADVICE",
  "AVOIDANCE_PATTERNS",
];

/**
 * The import wizard.
 *
 * It ends by creating a conversation record and an analysis job, then hands
 * over to the analysis page. Everything that happens afterwards - consent,
 * payment, running - lives there, because those steps are asynchronous and
 * have to survive closing the tab.
 */
export default function AnalyzePage() {
  const router = useRouter();

  const [phase, setPhase] = React.useState<Phase>("upload");
  const [error, setError] = React.useState<UserFacingError | null>(null);
  const [importMessage, setImportMessage] = React.useState("Opening the file…");

  const [importState, setImportState] = React.useState<ImportState | null>(null);
  const [gapMinutes, setGapMinutes] = React.useState(DEFAULT_GAP_MINUTES);
  const [selfId, setSelfId] = React.useState<string | null>(null);
  const [productId, setProductId] = React.useState("free");
  const [modules, setModules] = React.useState<AnalysisModule[]>(DEFAULT_MODULES);

  /* --- import ---------------------------------------------------------- */

  const runImport = React.useCallback(
    async (file: File, options: { chatId?: string; gap: number }) => {
      setPhase("importing");
      setError(null);
      setImportMessage("Opening the file…");

      try {
        const outcome = await importTelegramFile(file, {
          ...(options.chatId ? { chatId: options.chatId } : {}),
          conversationGapMinutes: options.gap,
          onProgress: (update) => setImportMessage(update.message),
        });
        setImportState({ file, ...outcome });
        // The most active participant is the likeliest "you", but it is a
        // guess and the picker makes that obvious.
        setSelfId(outcome.conversation.participants[0]?.id ?? null);
        setPhase("configure");
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

  const handleGapChange = React.useCallback(
    (minutes: number) => {
      setGapMinutes(minutes);
      if (!importState) return;
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

  const startOver = React.useCallback(() => {
    setImportState(null);
    setSelfId(null);
    setError(null);
    setPhase("upload");
  }, []);

  /* --- create ----------------------------------------------------------- */

  const create = React.useCallback(async () => {
    if (!importState || !selfId) return;
    setPhase("creating");
    setError(null);

    try {
      const { conversation, statistics, segments } = importState;
      const advanced = computeAdvancedStatistics(conversation, segments, {
        conversationGapMinutes: gapMinutes,
        medianResponseSeconds: Object.fromEntries(
          conversation.participants.map((participant) => [
            participant.id,
            statistics.response.perParticipant[participant.id]?.medianSeconds ?? 0,
          ]),
        ),
      });

      const built = buildAnalysisRequest(conversation, statistics, segments, {
        // Difficult moments are always included, so the module that reads them
        // is not looking at a conversation the shortlist was cut out of.
        maxSegments: 40,
      });
      const digest = buildAdvancedDigest(advanced, built.pseudonyms.toPseudonym);

      const created = await api.createConversation({
        title: conversation.chatName,
        source: conversation.source,
        chatType: conversation.chatType,
        messageCount: statistics.general.totalMessages,
        startDate: statistics.general.dateRange.start,
        endDate: statistics.general.dateRange.end,
        spanDays: statistics.general.dateRange.spanDays,
        timezoneOffsetMinutes: conversation.timezoneOffsetMinutes,
        statistics: { base: statistics, advanced },
        participants: conversation.participants.map((participant) => ({
          pseudonym: built.pseudonyms.toPseudonym.get(participant.id) ?? "?",
          displayName: participant.name,
          isSelf: participant.id === selfId,
          messageCount: participant.messageCount,
        })),
      });

      const job = await api.createJob({
        conversationId: created.conversation.id,
        productId,
        modules,
        input: {
          ...built.request,
          advanced: digest,
          modules,
          contentTypes: ["TEXT"],
          depth: getProduct(productId)?.depth ?? "standard",
        },
      });

      router.push(`/analyses/${job.job.id}`);
    } catch (thrown) {
      setError(
        thrown instanceof ApiError
          ? thrown.userFacing
          : {
              code: "UNKNOWN",
              message: "Couldn't prepare the analysis.",
              retryable: true,
            },
      );
      setPhase("configure");
    }
  }, [importState, selfId, gapMinutes, productId, modules, router]);

  const product = getProduct(productId);
  const tooLarge =
    product !== null &&
    importState !== null &&
    importState.statistics.general.totalMessages > product.maxMessages;

  const canContinue =
    importState !== null &&
    selfId !== null &&
    product !== null &&
    product.available &&
    !tooLarge &&
    modules.length > 0;

  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader subtitle={importState?.conversation.chatName} />

      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        <div className="mx-auto max-w-2xl space-y-6">
          {error ? (
            <ErrorState
              error={error}
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
              <UploadDropzone
                onFile={(file) => void runImport(file, { gap: gapMinutes })}
              />
            </>
          ) : null}

          {phase === "importing" ? (
            <ImportProgressIndicator message={importMessage} />
          ) : null}

          {(phase === "configure" || phase === "creating") && importState ? (
            <>
              <ConversationPreview
                conversation={importState.conversation}
                statistics={importState.statistics}
                gapMinutes={gapMinutes}
                onGapMinutesChange={handleGapChange}
                onChangeChat={(chatId) =>
                  void runImport(importState.file, { chatId, gap: gapMinutes })
                }
                onStartOver={startOver}
                busy={phase === "creating"}
                hideActions
              />

              <Card>
                <CardBody className="sm:px-6 sm:py-6">
                  <SelfPicker
                    participants={importState.conversation.participants.map((p) => ({
                      id: p.id,
                      name: p.name,
                      messageCount: p.messageCount,
                    }))}
                    selectedId={selfId}
                    onSelect={setSelfId}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardBody className="sm:px-6 sm:py-6">
                  <PlanPicker
                    productId={productId}
                    onProductChange={setProductId}
                    modules={modules}
                    onModulesChange={setModules}
                    messageCount={importState.statistics.general.totalMessages}
                  />
                </CardBody>
              </Card>

              <div className="flex flex-col gap-3 sm:flex-row-reverse">
                <Button
                  size="lg"
                  onClick={() => void create()}
                  disabled={!canContinue || phase === "creating"}
                  className="sm:min-w-56"
                >
                  {phase === "creating" ? "Preparing…" : "Continue"}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={startOver}
                  disabled={phase === "creating"}
                >
                  Cancel
                </Button>
              </div>

              <p className="text-xs leading-relaxed text-faint">
                Nothing is sent for AI analysis yet. The next step asks the other
                participant for consent; the analysis only runs once they have answered
                and the option you chose is unlocked.
              </p>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
