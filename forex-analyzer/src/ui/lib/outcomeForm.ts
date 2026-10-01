import type { JournalEntry, JournalStatus, OutcomeUpdate, TradeResult } from "@/shared/types/journal";
import { fieldErrors, outcomeSchema } from "@/shared/schemas";

/** One choice in the form covers both status and result. */
export type OutcomeChoice = "PENDING" | "OPEN" | TradeResult;

export interface OutcomeFormValues {
  choice: OutcomeChoice;
  actualPnl: string;
  rMultiple: string;
  notes: string;
  closedAt: string;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toOutcomeForm(e: JournalEntry): OutcomeFormValues {
  return {
    choice: e.status === "CLOSED" ? (e.result ?? "PENDING") : e.status,
    actualPnl: e.actualPnl === null ? "" : String(e.actualPnl),
    rMultiple: e.rMultiple === null ? "" : String(e.rMultiple),
    notes: e.outcomeNotes,
    closedAt: toLocalInput(e.closedAt),
  };
}

export function fromOutcomeForm(v: OutcomeFormValues): { outcome: OutcomeUpdate | null; errors: Record<string, string> } {
  const status: JournalStatus = v.choice === "PENDING" || v.choice === "OPEN" ? v.choice : "CLOSED";
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  const result = outcomeSchema.safeParse({
    status,
    result: status === "CLOSED" ? v.choice : null,
    actualPnl: v.choice === "CANCELLED" ? null : num(v.actualPnl),
    rMultiple: v.choice === "CANCELLED" ? null : num(v.rMultiple),
    notes: v.notes,
    closedAt: status === "CLOSED" && v.closedAt ? new Date(v.closedAt).toISOString() : null,
  });
  return result.success ? { outcome: result.data, errors: {} } : { outcome: null, errors: fieldErrors(result.error) };
}
