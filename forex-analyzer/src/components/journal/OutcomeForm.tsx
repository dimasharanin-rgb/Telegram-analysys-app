import { useEffect, useState } from "react";
import type { JournalEntry } from "@/types/journal";
import { api } from "@/lib/apiClient";
import { formatMoney } from "@/lib/format";
import { fromOutcomeForm, toOutcomeForm, type OutcomeChoice, type OutcomeFormValues } from "@/lib/outcomeForm";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

const CHOICES: { value: OutcomeChoice; label: string }[] = [
  { value: "PENDING", label: "Not decided yet" },
  { value: "OPEN", label: "Open (trade taken)" },
  { value: "WIN", label: "Win" },
  { value: "LOSS", label: "Loss" },
  { value: "BREAKEVEN", label: "Breakeven" },
  { value: "CANCELLED", label: "Cancelled / not taken" },
];

/** Records what actually happened to an analysed trade. */
export function OutcomeForm({ entry, onSaved }: { entry: JournalEntry; onSaved: (entry: JournalEntry) => void }) {
  const [form, setForm] = useState<OutcomeFormValues>(() => toOutcomeForm(entry));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setForm(toOutcomeForm(entry)), [entry]);

  const closed = !["PENDING", "OPEN", "CANCELLED"].includes(form.choice);
  const set = (patch: Partial<OutcomeFormValues>) => {
    setForm({ ...form, ...patch });
    setMessage(null);
  };

  const save = async () => {
    const { outcome, errors: errs } = fromOutcomeForm(form);
    setErrors(errs);
    if (!outcome) return;
    setSaving(true);
    try {
      const updated = await api.updateOutcome(entry.id, outcome);
      onSaved(updated);
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Outcome" htmlFor="outcome" error={errors.result}>
          <select id="outcome" value={form.choice} onChange={(e) => set({ choice: e.target.value as OutcomeChoice })}>
            {CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        {closed && (
          <Field label="Closed at" htmlFor="closedAt" hint="Determines which day's P/L it counts towards.">
            <input id="closedAt" type="datetime-local" value={form.closedAt} onChange={(e) => set({ closedAt: e.target.value })} />
          </Field>
        )}
        {closed && (
          <Field label={`Actual P/L (${entry.accountCurrency})`} htmlFor="pnl" error={errors.actualPnl}>
            <input id="pnl" className="num" inputMode="decimal" placeholder="-50.00" value={form.actualPnl} aria-invalid={!!errors.actualPnl} onChange={(e) => set({ actualPnl: e.target.value })} />
          </Field>
        )}
        {closed && (
          <Field
            label="R multiple"
            htmlFor="r"
            error={errors.rMultiple}
            hint={entry.riskAmount ? `Leave empty to compute P/L ÷ ${formatMoney(entry.riskAmount, entry.accountCurrency)}` : undefined}
          >
            <input id="r" className="num" inputMode="decimal" placeholder="auto" value={form.rMultiple} onChange={(e) => set({ rMultiple: e.target.value })} />
          </Field>
        )}
      </div>
      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <textarea id="notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save outcome"}
        </Button>
        {message && <span className="text-[12px] text-muted">{message}</span>}
      </div>
    </div>
  );
}
