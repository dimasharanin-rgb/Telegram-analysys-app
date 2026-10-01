import { useEffect, useState } from "react";
import type { Instrument } from "@/shared/types/market";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { api } from "@/ui/lib/apiClient";
import { Button } from "@/ui/components/ui/Button";

/** Add instruments by searching the active data source; remove with ✕. Any recognised currency pair can be added. */
export function WatchlistEditor({ value, onChange }: { value: string[]; onChange: (list: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchSymbols(query)
        .then((r) => {
          setResults(r.filter((i) => !value.includes(i.symbol)).slice(0, 8));
          setError(null);
        })
        .catch((e: unknown) => {
          setResults([]);
          setError(e instanceof Error ? e.message : String(e));
        });
    }, 350);
    return () => clearTimeout(t);
  }, [query, value]);

  const add = (symbol: string) => {
    const s = normalizeSymbol(symbol);
    if (getInstrument(s) && !value.includes(s)) onChange([...value, s]);
    setQuery("");
  };

  const typed = normalizeSymbol(query);
  const canAddTyped = query.length >= 6 && !!getInstrument(typed) && !value.includes(typed) && !results.some((r) => r.symbol === typed);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((s) => (
          <span key={s} className="num flex items-center gap-1 rounded border border-line px-2 py-0.5">
            {s}
            <button type="button" aria-label={`Remove ${s}`} className="text-faint hover:text-block" onClick={() => onChange(value.filter((x) => x !== s))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="relative max-w-sm">
        <input placeholder="Search symbols, e.g. AUD/NZD" className="w-full" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search symbols" />
        {(results.length > 0 || canAddTyped) && (
          <ul className="absolute z-20 mt-1 w-full rounded border border-line-strong bg-panel-2 shadow-lg">
            {canAddTyped && (
              <li>
                <Button variant="ghost" className="w-full justify-start" onClick={() => add(typed)}>
                  Add {typed}
                </Button>
              </li>
            )}
            {results.map((r) => (
              <li key={r.symbol}>
                <Button variant="ghost" className="w-full justify-start" onClick={() => add(r.symbol)}>
                  <span className="num">{r.symbol}</span> <span className="text-faint">{r.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-[11px] text-warn">Search unavailable: {error}</p>}
    </div>
  );
}
