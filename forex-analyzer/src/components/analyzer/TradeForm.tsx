import { useState, type ReactNode } from "react";
import type { InstrumentSpec } from "@/types/instrument";
import { DIRECTIONS, TIMEFRAMES } from "@/types/trade";
import { api } from "@/lib/apiClient";
import { formatPrice } from "@/lib/instruments";
import type { TradeFormValues } from "@/lib/tradeForm";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";

interface TradeFormProps {
  values: TradeFormValues;
  errors: Record<string, string>;
  showErrors: boolean;
  instruments: InstrumentSpec[];
  allowedPairs: string[];
  analyzing: boolean;
  onChange: (values: TradeFormValues) => void;
  onAnalyze: () => void;
  onReset: () => void;
}

export function TradeForm({ values, errors, showErrors, instruments, allowedPairs, analyzing, onChange, onAnalyze, onReset }: TradeFormProps) {
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const set = <K extends keyof TradeFormValues>(key: K, value: TradeFormValues[K]) => onChange({ ...values, [key]: value });
  const err = (key: string) => (showErrors ? errors[key] : undefined);
  const instrument = instruments.find((i) => i.symbol === values.pair);

  const useMarketPrice = async () => {
    setQuoteNote("Fetching…");
    try {
      const { quote, stale } = await api.quote(values.pair);
      const price = values.direction === "LONG" ? (quote.ask ?? quote.price) : (quote.bid ?? quote.price);
      onChange({ ...values, entry: formatPrice(price, instrument) });
      setQuoteNote(stale ? `Quote may be stale: ${stale}` : `${values.direction === "LONG" ? "Ask" : "Bid"} ${formatPrice(price, instrument)}`);
    } catch (e) {
      setQuoteNote(e instanceof Error ? e.message : "Quote unavailable");
    }
  };

  const priceInput = (key: "entry" | "stopLoss" | "takeProfit", label: string, extra?: ReactNode) => (
    <Field label={label} htmlFor={key} error={err(key)} hint={key === "entry" ? (quoteNote ?? undefined) : undefined}>
      <div className="flex gap-1.5">
        <input
          id={key}
          className="num w-full"
          inputMode="decimal"
          autoComplete="off"
          placeholder={instrument ? (0).toFixed(instrument.pricePrecision) : ""}
          value={values[key]}
          aria-invalid={!!err(key)}
          onChange={(e) => set(key, e.target.value)}
        />
        {extra}
      </div>
    </Field>
  );

  return (
    <Panel title="Proposed trade" className="h-full">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onAnalyze();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pair" htmlFor="pair" error={err("pair")}>
            <select id="pair" className="num" value={values.pair} onChange={(e) => set("pair", e.target.value)}>
              {instruments.map((i) => (
                <option key={i.symbol} value={i.symbol}>
                  {i.symbol}
                  {allowedPairs.includes(i.symbol) ? "" : " (not allowed)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Direction">
            <Segmented
              name="Direction"
              value={values.direction}
              options={DIRECTIONS}
              onChange={(d) => set("direction", d)}
              colorFor={(d) => (d === "LONG" ? "bg-long/20 text-long" : "bg-short/20 text-short")}
            />
          </Field>
        </div>

        {priceInput(
          "entry",
          "Entry",
          <Button variant="secondary" onClick={useMarketPrice} title="Fill with the current market price" className="shrink-0 px-2">
            Market
          </Button>,
        )}
        <div className="grid grid-cols-2 gap-3">
          {priceInput("stopLoss", "Stop loss")}
          {priceInput("takeProfit", "Take profit")}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Position size (optional)" htmlFor="positionSize" error={err("positionSize")} hint="Lots. Empty = suggested size.">
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

        <Field label="Trade thesis / notes" htmlFor="thesis" error={err("thesis")}>
          <textarea
            id="thesis"
            rows={3}
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
