import type { ReactNode } from "react";
import type { InstrumentSpec } from "@/shared/types/instrument";
import { DIRECTIONS, TIMEFRAMES } from "@/shared/types/trade";
import type { TradeFormValues } from "@/ui/lib/tradeForm";
import { Button } from "@/ui/components/ui/Button";
import { Field } from "@/ui/components/ui/Field";
import { Panel } from "@/ui/components/ui/Panel";
import { Segmented } from "@/ui/components/ui/Segmented";

interface TradeFormProps {
  values: TradeFormValues;
  errors: Record<string, string>;
  showErrors: boolean;
  instrument: InstrumentSpec | undefined;
  /** Whether a live price is available for MARKET entry. */
  marketAvailable: boolean;
  analyzing: boolean;
  onChange: (values: TradeFormValues) => void;
  onAnalyze: () => void;
  onReset: () => void;
}

export function TradeForm({ values, errors, showErrors, instrument, marketAvailable, analyzing, onChange, onAnalyze, onReset }: TradeFormProps) {
  const set = <K extends keyof TradeFormValues>(key: K, value: TradeFormValues[K]) => onChange({ ...values, [key]: value });
  const err = (key: string) => (showErrors ? errors[key] : undefined);

  const priceInput = (key: "entry" | "stopLoss" | "takeProfit", label: string, opts: { readOnly?: boolean; hint?: ReactNode } = {}) => (
    <Field label={label} htmlFor={key} error={err(key)} hint={opts.hint}>
      <input
        id={key}
        className={`num w-full ${opts.readOnly ? "text-muted" : ""}`}
        inputMode="decimal"
        autoComplete="off"
        readOnly={opts.readOnly}
        placeholder={instrument ? (0).toFixed(instrument.pricePrecision) : ""}
        value={values[key]}
        aria-invalid={!!err(key)}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );

  return (
    <Panel title={`Trade setup · ${values.pair}`} className="h-full">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onAnalyze();
        }}
      >
        <Field label="Direction">
          <Segmented
            name="Direction"
            value={values.direction}
            options={DIRECTIONS}
            onChange={(d) => set("direction", d)}
            colorFor={(d) => (d === "LONG" ? "bg-long/20 text-long" : "bg-short/20 text-short")}
          />
        </Field>
        <Field label="Entry type">
          <Segmented name="Entry type" value={values.entryType} options={["MARKET", "CUSTOM"] as const} onChange={(t) => set("entryType", t)} />
        </Field>
        {priceInput("entry", "Entry", {
          readOnly: values.entryType === "MARKET",
          hint:
            values.entryType === "MARKET"
              ? marketAvailable
                ? `Follows the live ${values.direction === "LONG" ? "ask" : "bid"}.`
                : "No live price yet."
              : undefined,
        })}
        <div className="grid grid-cols-2 gap-3">
          {priceInput("stopLoss", "Stop loss")}
          {priceInput("takeProfit", "Take profit")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Position size" htmlFor="positionSize" error={err("positionSize")} hint="Lots. Empty = size for max risk.">
            <input
              id="positionSize"
              className="num"
              inputMode="decimal"
              placeholder="auto"
              value={values.positionSize}
              aria-invalid={!!err("positionSize")}
              onChange={(e) => set("positionSize", e.target.value)}
            />
          </Field>
          <Field label="Timeframe">
            <select value={values.timeframe} onChange={(e) => set("timeframe", e.target.value as TradeFormValues["timeframe"])}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf}>{tf}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Trade thesis" htmlFor="thesis" error={err("thesis")}>
          <textarea
            id="thesis"
            rows={2}
            maxLength={2000}
            placeholder="e.g. Breakout and retest of H1 resistance"
            value={values.thesis}
            onChange={(e) => set("thesis", e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1 py-2" disabled={analyzing}>
            {analyzing ? "ANALYZING…" : "ANALYZE TRADE"}
          </Button>
          <Button variant="ghost" onClick={onReset} disabled={analyzing}>
            Clear
          </Button>
        </div>
        <p className="text-[11px] text-faint">Analysis only. No order is placed.</p>
      </form>
    </Panel>
  );
}
