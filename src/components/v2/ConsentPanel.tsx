"use client";

import * as React from "react";

import { CONSENT_STATUS_LABELS } from "@/lib/consent/state";
import { api, ApiError, type ConsentGate } from "@/lib/client/api";
import type { UserFacingError } from "@/lib/errors";
import { formatDate } from "@/lib/client/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, SectionTitle } from "@/components/ui/Card";
import { ErrorState } from "@/components/ErrorState";

export interface ConsentPanelProps {
  conversationId: string;
  gate: ConsentGate;
  /**
   * What this analysis needs authorising. Comes from the job's own media plan,
   * so a chat with voice messages asks about voice messages and a text-only
   * one does not.
   */
  dataTypes: readonly string[];
  onChanged: (gate: ConsentGate) => void;
}

/**
 * Asking the other participant.
 *
 * The link is shown once, because only its hash is stored. How it reaches the
 * other person is up to them - the application does not send messages on
 * anyone's behalf, and does not ask for their contact details to do so.
 */
export function ConsentPanel({
  conversationId,
  gate,
  dataTypes,
  onChanged,
}: ConsentPanelProps) {
  const [links, setLinks] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<UserFacingError | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  const send = async (participantId: string) => {
    setBusy(participantId);
    setError(null);
    try {
      const response = await api.requestConsent(conversationId, participantId, dataTypes);
      setLinks((current) => ({ ...current, [participantId]: response.url }));
      onChanged(response.gate);
    } catch (thrown) {
      setError(
        thrown instanceof ApiError
          ? thrown.userFacing
          : { code: "UNKNOWN", message: "Couldn't create the request.", retryable: true },
      );
    } finally {
      setBusy(null);
    }
  };

  const copy = async (participantId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(participantId);
      setTimeout(() => setCopied(null), 2400);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Card>
      <CardBody className="sm:px-6 sm:py-6">
        <SectionTitle
          hint={gate.satisfied ? "All set" : `${gate.blocking.length} still needed`}
        >
          Participant consent
        </SectionTitle>

        <p className="mb-3 text-sm leading-relaxed text-muted">
          A conversation belongs to everyone in it. Before it is analysed, each other
          participant is asked whether they agree — with a link of their own, which
          they can also use to withdraw later.
        </p>

        {/*
          What the link will ask for, before it is sent. Someone forwarding a
          consent request should know whether they are asking about words, or
          about their photographs and recorded voice - those are different
          things to ask of a person.
        */}
        <p className="mb-5 text-sm leading-relaxed text-ink-soft">
          This request covers <strong>{describeScope(dataTypes)}</strong>.
        </p>

        {error ? (
          <div className="mb-4">
            <ErrorState error={error} />
          </div>
        ) : null}

        <ul className="space-y-3">
          {gate.requirements.map((requirement) => (
            <li
              key={requirement.participantId}
              className="rounded-lg border border-line bg-canvas-soft px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {requirement.displayName}
                    {requirement.isSelf ? (
                      <span className="ml-2 font-normal text-muted">(you)</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {!requirement.required
                      ? "Your own confirmation was recorded at import"
                      : requirement.status
                        ? CONSENT_STATUS_LABELS[requirement.status]
                        : "Not asked yet"}
                    {requirement.required &&
                    requirement.expiresAt &&
                    requirement.status &&
                    ["PENDING", "VIEWED"].includes(requirement.status)
                      ? ` · expires ${formatDate(requirement.expiresAt)}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {requirement.satisfied ? (
                    <Badge tone="positive">Ready</Badge>
                  ) : requirement.status === "DECLINED" ? (
                    <Badge tone="caution">Declined</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant={requirement.status ? "secondary" : "primary"}
                      disabled={busy !== null}
                      onClick={() => void send(requirement.participantId)}
                    >
                      {busy === requirement.participantId
                        ? "Creating…"
                        : requirement.status
                          ? "Send a new link"
                          : "Request consent"}
                    </Button>
                  )}
                </div>
              </div>

              {links[requirement.participantId] ? (
                <div className="mt-3 rounded-md border border-brand-100 bg-brand-50 px-3 py-3">
                  <p className="text-xs font-medium text-brand-800">
                    Send this link to {requirement.displayName}
                  </p>
                  <p className="mt-1.5 break-all font-mono text-xs text-ink-soft">
                    {links[requirement.participantId]}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void copy(
                          requirement.participantId,
                          links[requirement.participantId]!,
                        )
                      }
                    >
                      {copied === requirement.participantId ? "Copied ✓" : "Copy link"}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-brand-800/80">
                    This is the only time the link is shown — only a hash of it is
                    stored. If you lose it, send a new one.
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {gate.declined ? (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-ink">
            A participant declined. This conversation will not be analysed, and nothing
            has been sent for AI processing.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * The content types a request covers, in words rather than labels.
 *
 * Reads as a sentence fragment because it sits inside one, and names voice
 * messages and photographs rather than "AUDIO" and "IMAGES" - the panel is for
 * the person doing the asking, not for the schema.
 */
function describeScope(dataTypes: readonly string[]): string {
  const parts: string[] = ["the text of the conversation"];
  if (dataTypes.includes("IMAGES")) parts.push("photos and files that were sent");
  if (dataTypes.includes("AUDIO")) parts.push("voice messages, which are transcribed");

  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
