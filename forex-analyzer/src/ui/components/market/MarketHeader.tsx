import { formatPrice, getInstrument } from "@/shared/instruments";
import { useAppData } from "@/ui/hooks/useAppData";
import { useDataAge } from "@/ui/hooks/useDataAge";
import { feedState, useLiveFeed } from "@/ui/hooks/useLiveFeed";

/** Pair selector and the live price strip: bid, ask, spread, mid and how old the data is. */
export function MarketHeader() {
  const feed = useLiveFeed();
  const { instruments, settings } = useAppData();
  const instrument = getInstrument(feed.symbol);
  const q = feed.quote;
  const threshold = settings?.freshnessThresholdSeconds ?? 120;
  const age = useDataAge(q?.timestamp, threshold);
  const state = feedState(feed);
  const px = (v: number | null | undefined) => (v == null ? "—" : formatPrice(v, instrument));
  const spreadPips = q?.spread != null && instrument ? (q.spread / instrument.pipSize).toFixed(1) : null;
  const options = instruments.some((i) => i.symbol === feed.symbol) ? instruments : [...instruments, ...(instrument ? [instrument] : [])];

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-panel px-3 py-2" aria-label="Market">
      <select aria-label="Pair" className="num text-[14px] font-semibold" value={feed.symbol} onChange={(e) => feed.setSymbol(e.target.value)}>
        {options.map((i) => (
          <option key={i.symbol} value={i.symbol}>
            {i.symbol}
          </option>
        ))}
      </select>
      <Field label="Bid" value={px(q?.bid)} />
      <Field label="Ask" value={px(q?.ask)} />
      <Field label="Spread" value={spreadPips === null ? (q ? "n/a" : "—") : `${spreadPips} pips`} title={q && q.spread === null ? "This source does not report bid/ask" : undefined} />
      <Field label="Price" value={px(q?.mid)} big />
      <div className="ml-auto flex min-w-0 items-center gap-3 text-[11.5px]">
        <span
          data-testid="data-age"
          className={`num ${age.stale ? "text-warn" : "text-muted"}`}
          title={q ? `Price time ${new Date(q.timestamp).toISOString()} · received ${new Date(q.receivedAt).toISOString()}` : undefined}
        >
          {age.text}
        </span>
        {age.stale && <span className="rounded border border-warn/50 bg-warn/10 px-1.5 py-px text-[10.5px] font-semibold text-warn">STALE DATA</span>}
        {q && <span className="text-faint">{q.source === "twelvedata-ws" ? "Twelve Data stream" : q.source === "twelvedata-rest" ? "Twelve Data REST" : "Mock"}</span>}
        {state.label !== "LIVE" && state.reason && (
          <span className="max-w-[340px] truncate text-warn" title={state.reason}>
            {state.reason}
          </span>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, big, title }: { label: string; value: string; big?: boolean; title?: string }) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="label">{label}</span>
      <span className={`num ${big ? "text-[17px] font-semibold" : "text-[14px]"}`}>{value}</span>
    </div>
  );
}
