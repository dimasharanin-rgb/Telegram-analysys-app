import { useState } from "react";
import type { AutonomousAnalysisResult } from "@/shared/types/autonomous";
import type { ScanResult } from "@/shared/types/setup";
import type { Timeframe } from "@/shared/types/trade";
import { api } from "@/ui/lib/apiClient";
import { useAppData } from "@/ui/hooks/useAppData";
import { useAsync } from "@/ui/hooks/useAsync";
import { CandidateCard } from "@/ui/components/autonomous/CandidateCard";
import { Button } from "@/ui/components/ui/Button";
import { Notice, Spinner } from "@/ui/components/ui/Notice";
import { Panel } from "@/ui/components/ui/Panel";
import { DirectionTag } from "@/ui/components/ui/VerdictBadge";

const SCAN_TIMEFRAMES: Timeframe[] = ["M5", "M15", "H1", "H4"];

/**
 * Scan → deterministic candidates → (on request) AI evaluation → deterministic
 * risk validation → final analysis decision. Paper analysis only.
 */
export function AutonomousPage() {
  const { settings, status } = useAppData();
  const watchlist = settings?.allowedPairs ?? [];
  const [symbols, setSymbols] = useState<string[]>(() => watchlist.slice(0, 3));
  const [timeframes, setTimeframes] = useState<Timeframe[]>(["M15", "H1"]);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AutonomousAnalysisResult>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const log = useAsync(() => api.decisions(30), [Object.keys(results).length]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const selected = symbols.filter((s) => watchlist.includes(s));

  const runScan = async () => {
    setScanning(true);
    setScanError(null);
    setResults({});
    try {
      setScan(await api.scan({ symbols: selected, timeframes }));
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const analyze = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const r = await api.analyzeCandidate(id);
      setResults((m) => ({ ...m, [id]: r }));
    } catch (e) {
      setErrors((m) => ({ ...m, [id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Notice>
        Paper analysis only. The scanner finds setups deterministically; the AI may propose a hypothetical trade or decline; every
        proposal is re-checked by the same risk engine as manual trades, which has the final say. Nothing is ever sent to a broker.
        {status?.ai.isMock ? " AI: MOCK rules (no ANTHROPIC_API_KEY)." : ""}
      </Notice>

      <Panel title="Scan for setup candidates" bodyClassName="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pairs">
          {watchlist.map((s) => (
            <label key={s} className="flex items-center gap-1.5 rounded border border-line px-2 py-0.5">
              <input type="checkbox" checked={symbols.includes(s)} onChange={() => setSymbols(toggle(symbols, s))} />
              <span className="num">{s}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5" role="group" aria-label="Timeframes">
            {SCAN_TIMEFRAMES.map((tf) => (
              <label key={tf} className="flex items-center gap-1.5 rounded border border-line px-2 py-0.5">
                <input type="checkbox" checked={timeframes.includes(tf)} onChange={() => setTimeframes(toggle(timeframes, tf))} />
                <span className="num">{tf}</span>
              </label>
            ))}
          </div>
          <Button variant="primary" onClick={runScan} disabled={scanning || selected.length === 0 || timeframes.length === 0}>
            {scanning ? "Scanning…" : "Scan"}
          </Button>
          {scanning && <Spinner label="Deterministic scan (no AI)…" />}
          {scanError && <span className="text-block">{scanError}</span>}
        </div>
      </Panel>

      {scan && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" data-testid="scan-summary">
            <span>Scanned {new Date(scan.scannedAt).toLocaleTimeString()}</span>
            {scan.symbols.map((s) => (
              <span key={s.symbol} className={s.status === "OK" ? "" : "text-warn"} title={s.reason}>
                {s.symbol}: {s.status === "OK" ? `${s.candidates} candidate${s.candidates === 1 ? "" : "s"}` : `unavailable (${s.reason})`}
              </span>
            ))}
          </div>
          {scan.candidates.length === 0 ? (
            <Panel>
              <p className="text-muted">No candidates. Nothing in the selected markets meets the deterministic conditions right now, which is a normal result.</p>
            </Panel>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {scan.candidates.map((c) => (
                <CandidateCard key={c.id} candidate={c} result={results[c.id] ?? null} analyzing={!!busy[c.id]} error={errors[c.id] || null} onAnalyze={() => void analyze(c.id)} />
              ))}
            </div>
          )}
        </>
      )}

      <Panel
        title="Decision log"
        actions={log.data && <span className="text-[11px] text-faint">{log.data.counts.total} analyses · {log.data.counts.trade} trade proposals · {log.data.counts.noTrade} no trade</span>}
        bodyClassName="overflow-x-auto p-0"
      >
        {!log.data || log.data.decisions.length === 0 ? (
          <p className="p-3 text-muted">No candidate has been analysed yet. Both TRADE and NO_TRADE outcomes are recorded here.</p>
        ) : (
          <table className="w-full min-w-[760px] text-[12px]" aria-label="Decision log">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="px-3 py-1.5 font-medium">Time</th>
                <th className="px-2 py-1.5 font-medium">Candidate</th>
                <th className="px-2 py-1.5 font-medium">AI</th>
                <th className="px-2 py-1.5 text-right font-medium">Quality</th>
                <th className="px-2 py-1.5 font-medium">Risk</th>
                <th className="px-2 py-1.5 font-medium">Final</th>
                <th className="px-3 py-1.5 font-medium">Model · prompt</th>
              </tr>
            </thead>
            <tbody>
              {log.data.decisions.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0" title={d.finalReason}>
                  <td className="num px-3 py-1.5 text-muted">{new Date(d.analyzedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-2 py-1.5">
                    <span className="num">{d.symbol}</span> {d.timeframe} <DirectionTag direction={d.candidateDirection} /> {d.setupType}
                  </td>
                  <td className="px-2 py-1.5">{d.aiDecision ?? (d.error ? `ERROR (${d.error.code})` : "—")}</td>
                  <td className="num px-2 py-1.5 text-right">{d.setupQuality ?? "—"}</td>
                  <td className={`px-2 py-1.5 ${d.riskValidation ? (d.riskValidation.passed ? "text-pass" : "text-block") : "text-faint"}`}>
                    {d.riskValidation ? (d.riskValidation.passed ? "PASSED" : "FAILED") : "—"}
                  </td>
                  <td className={`px-2 py-1.5 font-semibold ${d.finalDecision === "TRADE" ? "text-pass" : "text-muted"}`}>{d.finalDecision === "TRADE" ? "TRADE PROPOSAL" : "NO TRADE"}</td>
                  <td className="px-3 py-1.5 text-faint">
                    {d.model} · {d.promptVersion}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
