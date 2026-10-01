import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { FinalVerdict } from "@/types/analysis";
import type { JournalEntry, JournalFilters, JournalSummary } from "@/types/journal";
import { api } from "@/lib/apiClient";
import { formatMoney } from "@/lib/format";
import { useAppData } from "@/hooks/useAppData";
import { useAsync } from "@/hooks/useAsync";
import { JournalDetail } from "@/components/journal/JournalDetail";
import { Button } from "@/components/ui/Button";
import { Notice, Spinner } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { DirectionTag, VerdictBadge } from "@/components/ui/VerdictBadge";

const VERDICTS: FinalVerdict[] = ["ACCEPTABLE", "CAUTION", "REJECT", "BLOCKED", "UNAVAILABLE"];
const RESULTS = ["PENDING", "OPEN", "WIN", "LOSS", "BREAKEVEN", "CANCELLED"] as const;

function resultLabel(e: JournalSummary): { text: string; tone: string } {
  if (e.status === "PENDING") return { text: "—", tone: "text-faint" };
  if (e.status === "OPEN") return { text: "OPEN", tone: "text-accent" };
  const tone = e.result === "WIN" ? "text-pass" : e.result === "LOSS" ? "text-block" : "text-muted";
  return { text: e.result ?? "—", tone };
}

export function JournalPage() {
  const { instruments } = useAppData();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<JournalFilters>({});
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const list = useAsync(() => api.journal(filters), [JSON.stringify(filters)]);

  const open = useCallback(
    async (id: string) => {
      try {
        setSelected(await api.journalEntry(id));
      } catch {
        setSelected(null);
      }
    },
    [],
  );

  useEffect(() => {
    const id = params.get("entry");
    if (id) void open(id);
  }, [params, open]);

  const close = useCallback(() => {
    setSelected(null);
    if (params.has("entry")) setParams({}, { replace: true });
  }, [params, setParams]);

  const update = (patch: Partial<JournalFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const score = (raw: string) => {
    const n = Number(raw);
    return raw.trim() === "" || !Number.isFinite(n) ? undefined : Math.min(100, Math.max(0, n));
  };
  const entries = list.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Filters" bodyClassName="flex flex-wrap items-end gap-2 p-3">
        <Filter label="Pair">
          <select value={filters.pair ?? ""} onChange={(e) => update({ pair: e.target.value || undefined })}>
            <option value="">All</option>
            {instruments.map((i) => (
              <option key={i.symbol}>{i.symbol}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Verdict">
          <select value={filters.verdict ?? ""} onChange={(e) => update({ verdict: (e.target.value || undefined) as FinalVerdict | undefined })}>
            <option value="">All</option>
            {VERDICTS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Score min">
          <input className="num w-16" inputMode="numeric" value={filters.minScore ?? ""} onChange={(e) => update({ minScore: score(e.target.value) })} />
        </Filter>
        <Filter label="Score max">
          <input className="num w-16" inputMode="numeric" value={filters.maxScore ?? ""} onChange={(e) => update({ maxScore: score(e.target.value) })} />
        </Filter>
        <Filter label="Result">
          <select value={filters.result ?? ""} onChange={(e) => update({ result: (e.target.value || undefined) as JournalFilters["result"] })}>
            <option value="">All</option>
            {RESULTS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Filter>
        <Filter label="From">
          <input type="date" value={filters.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} />
        </Filter>
        <Filter label="To">
          <input type="date" value={filters.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} />
        </Filter>
        <Button variant="ghost" onClick={() => setFilters({})}>
          Clear
        </Button>
        <span className="ml-auto text-[12px] text-muted">{list.loading ? <Spinner /> : `${entries.length} entries`}</span>
      </Panel>

      {list.error && <Notice tone="block">{list.error.message}</Notice>}

      <Panel bodyClassName="overflow-x-auto">
        {entries.length === 0 && !list.loading ? (
          <p className="p-4 text-muted">No analyses match. Every analysis you run in the Trade Analyzer is saved here.</p>
        ) : (
          <table className="w-full min-w-[820px] text-[12.5px]">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Pair</th>
                <th className="px-2 py-2 font-medium">Direction</th>
                <th className="px-2 py-2 text-right font-medium">AI score</th>
                <th className="px-2 py-2 font-medium">Verdict</th>
                <th className="px-2 py-2 text-right font-medium">R:R</th>
                <th className="px-2 py-2 text-right font-medium">Risk</th>
                <th className="px-2 py-2 font-medium">Result</th>
                <th className="px-2 py-2 text-right font-medium">P/L</th>
                <th className="px-3 py-2 text-right font-medium">R</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const r = resultLabel(e);
                return (
                  <tr
                    key={e.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-panel-2"
                    onClick={() => void open(e.id)}
                    tabIndex={0}
                    onKeyDown={(ev) => ev.key === "Enter" && void open(e.id)}
                  >
                    <td className="num px-3 py-1.5 text-muted">{new Date(e.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="num px-2 py-1.5 font-medium">{e.pair}</td>
                    <td className="px-2 py-1.5">
                      <DirectionTag direction={e.direction} /> <span className="text-faint">{e.timeframe}</span>
                    </td>
                    <td className="num px-2 py-1.5 text-right">{e.aiScore ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <VerdictBadge verdict={e.finalVerdict} />
                    </td>
                    <td className="num px-2 py-1.5 text-right">{e.riskReward === null ? "—" : `1:${e.riskReward.toFixed(2)}`}</td>
                    <td className="num px-2 py-1.5 text-right text-muted">{e.riskPercent === null ? "—" : `${e.riskPercent.toFixed(2)}%`}</td>
                    <td className={`px-2 py-1.5 font-medium ${r.tone}`}>{r.text}</td>
                    <td className={`num px-2 py-1.5 text-right ${e.actualPnl === null ? "text-faint" : e.actualPnl >= 0 ? "text-pass" : "text-block"}`}>
                      {e.actualPnl === null ? "—" : formatMoney(e.actualPnl, e.accountCurrency, { sign: true })}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{e.rMultiple === null ? "—" : e.rMultiple.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {selected && (
        <JournalDetail
          entry={selected}
          onClose={close}
          onSaved={(updated) => {
            setSelected(updated);
            list.reload();
          }}
          onDelete={async (id) => {
            await api.deleteEntry(id);
            close();
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
