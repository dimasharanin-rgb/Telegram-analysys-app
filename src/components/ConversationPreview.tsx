"use client";

import * as React from "react";
import type { Conversation } from "@/lib/model/message";
import type { ConversationStatistics } from "@/lib/stats";
import { formatDate, formatNumber } from "@/lib/client/format";
import { ParticipantBadge } from "./ParticipantBadge";
import { Button } from "./ui/Button";
import { Card, CardBody, SectionTitle } from "./ui/Card";

export interface ConversationPreviewProps {
  conversation: Conversation;
  statistics: ConversationStatistics;
  /** Minutes of silence that separate two conversations. */
  gapMinutes: number;
  onGapMinutesChange: (minutes: number) => void;
  onChangeChat: (chatId: string) => void;
  onContinue?: () => void;
  onStartOver: () => void;
  busy?: boolean;
  /** The V2 wizard supplies its own continue control further down the page. */
  hideActions?: boolean;
}

const GAP_OPTIONS = [
  { value: 60, label: "1 hour", hint: "Many short conversations" },
  { value: 180, label: "3 hours", hint: "Balanced" },
  { value: 360, label: "6 hours", hint: "Recommended" },
  { value: 720, label: "12 hours", hint: "Fewer, longer conversations" },
];

export function ConversationPreview({
  conversation,
  statistics,
  gapMinutes,
  onGapMinutesChange,
  onChangeChat,
  onContinue,
  onStartOver,
  busy,
  hideActions,
}: ConversationPreviewProps) {
  const { general, initiation } = statistics;

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                Conversation found
              </p>
              <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">
                {conversation.chatName}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {formatDate(general.dateRange.start)} – {formatDate(general.dateRange.end)}
                {" · "}
                {formatNumber(general.dateRange.spanDays)} days
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onStartOver}>
              Use a different file
            </Button>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Messages", value: formatNumber(general.totalMessages) },
              { label: "Active days", value: formatNumber(general.activeDays) },
              {
                label: "Conversations",
                value: formatNumber(initiation.totalConversations),
              },
              {
                label: "Per active day",
                value: formatNumber(general.averageMessagesPerActiveDay),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-line bg-canvas-soft px-3 py-3"
              >
                <dt className="text-[0.7rem] uppercase tracking-wide text-muted">
                  {item.label}
                </dt>
                <dd className="mt-0.5 text-xl font-semibold tracking-tight text-ink">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6">
            <SectionTitle>Participants</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {conversation.participants.map((participant, index) => (
                <ParticipantBadge
                  key={participant.id}
                  name={participant.name}
                  index={index}
                  detail={`${formatNumber(participant.messageCount)} messages`}
                />
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Names stay in your browser. The AI analysis sees them only as
              &ldquo;Participant A&rdquo;, &ldquo;Participant B&rdquo;, and the names are
              put back when the results are shown to you.
            </p>
          </div>
        </CardBody>
      </Card>

      {conversation.availableChats.length > 1 ? (
        <Card>
          <CardBody>
            <SectionTitle hint={`${conversation.availableChats.length} chats in this file`}>
              Analyse a different chat
            </SectionTitle>
            <label className="sr-only" htmlFor="chat-select">
              Choose which chat to analyse
            </label>
            <select
              id="chat-select"
              value={conversation.chatId}
              disabled={busy}
              onChange={(event) => onChangeChat(event.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink"
            >
              {conversation.availableChats.map((chat) => (
                <option key={chat.id} value={chat.id}>
                  {chat.name} — {formatNumber(chat.messageCount)} messages
                </option>
              ))}
            </select>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <SectionTitle hint="Affects initiation and response-time statistics">
            When does a new conversation start?
          </SectionTitle>
          <p className="mb-4 text-sm leading-relaxed text-muted">
            A Telegram export is one long stream. To count who starts conversations, and
            to avoid treating an overnight silence as a slow reply, the app splits the
            stream wherever a long enough gap appears.
          </p>
          <div
            role="radiogroup"
            aria-label="Conversation gap"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {GAP_OPTIONS.map((option) => {
              const active = option.value === gapMinutes;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => onGapMinutesChange(option.value)}
                  className={
                    active
                      ? "rounded-lg border-2 border-brand-600 bg-brand-50 px-3 py-3 text-left"
                      : "rounded-lg border border-line bg-white px-3 py-3 text-left hover:border-brand-200 hover:bg-brand-50/40"
                  }
                >
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-faint">
            {initiation.algorithm}
          </p>
        </CardBody>
      </Card>

      {conversation.warnings.length > 0 ? (
        <Card>
          <CardBody>
            <SectionTitle>Worth knowing about this export</SectionTitle>
            <ul className="space-y-2">
              {conversation.warnings.map((warning) => (
                <li key={warning.code} className="flex gap-2.5 text-sm text-ink-soft">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300"
                  />
                  <span className="leading-relaxed">{warning.message}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {hideActions ? null : (
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button size="lg" onClick={onContinue} disabled={busy} className="sm:min-w-56">
            Continue to analysis
          </Button>
          <Button size="lg" variant="secondary" onClick={onStartOver} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
