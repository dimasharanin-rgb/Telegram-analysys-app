import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/ui/components/ui/Button";
import { Field } from "@/ui/components/ui/Field";
import { Notice, Spinner } from "@/ui/components/ui/Notice";
import { Panel } from "@/ui/components/ui/Panel";
import { useAppData } from "@/ui/hooks/useAppData";
import { api, ApiError } from "@/ui/lib/apiClient";
import { formatMoney } from "@/shared/format";
import { SESSION_WINDOWS_UTC } from "@/shared/sessions";
import { WatchlistEditor } from "@/ui/components/market/WatchlistEditor";
import { fromSettingsForm, toSettingsForm, type SettingsFormValues } from "@/ui/lib/settingsForm";
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_STATE_SOURCES,
  DAILY_LOSS_BASES,
  DRAWDOWN_MODES,
  TRADING_SESSIONS,
} from "@/shared/types/settings";

const BASIS_LABEL = { INITIAL_BALANCE: "Initial balance", DAY_START_BALANCE: "Balance at start of day" } as const;
const DD_LABEL = { STATIC: "Static (from initial balance)", TRAILING: "Trailing (from closed-balance high)" } as const;
const SOURCE_LABEL = { JOURNAL: "Derived from the journal", MANUAL: "Entered manually" } as const;

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

export function SettingsPage() {
  const { settings, status, setSettings } = useAppData();
  const [form, setForm] = useState<SettingsFormValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "block"; text: string } | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(toSettingsForm(settings));
  }, [settings, form]);

  const preview = useMemo(() => (form ? fromSettingsForm(form).settings : null), [form]);

  if (!form) return <Spinner label="Loading settings…" />;

  const set = <K extends keyof SettingsFormValues>(key: K, value: SettingsFormValues[K]) => {
    setForm({ ...form, [key]: value });
    setMessage(null);
  };
  const setManual = (key: keyof SettingsFormValues["manualState"], value: string) => {
    setForm({ ...form, manualState: { ...form.manualState, [key]: value } });
    setMessage(null);
  };
  const toggle = <T extends string>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const text = (key: keyof SettingsFormValues, label: string, hint?: ReactNode, suffix?: string) => (
    <Field label={label} htmlFor={key} error={errors[key]} hint={hint}>
      <div className="flex items-center gap-1.5">
        <input
          id={key}
          inputMode="decimal"
          className="num w-full"
          value={form[key] as string}
          aria-invalid={!!errors[key]}
          onChange={(e) => set(key, e.target.value as never)}
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </div>
    </Field>
  );

  const save = async () => {
    const { settings: parsed, errors: errs } = fromSettingsForm(form);
    setErrors(errs);
    if (!parsed) {
      setMessage({ tone: "block", text: "Some values are invalid. Nothing was saved." });
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveSettings(parsed);
      setSettings(saved);
      setForm(toSettingsForm(saved));
      setMessage({ tone: "info", text: "Settings saved. New analyses use these rules." });
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setMessage({ tone: "block", text: e instanceof Error ? e.message : "Saving failed." });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset every setting to its default value?")) return;
    const saved = await api.resetSettings();
    setSettings(saved);
    setForm(toSettingsForm(saved));
    setErrors({});
    setMessage({ tone: "info", text: "Defaults restored." });
  };

  const ccy = preview?.currency ?? form.currency;
  const size = preview?.accountSize ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <Notice>
        These are your own parameters. Funded-account programmes differ, so none of these values are assumed to be
        universal rules. The risk engine enforces exactly what is configured here, before any AI analysis runs.
      </Notice>

      <Panel title="Account">
        <Grid>
          {text("accountSize", "Account size", "Initial balance of the account.")}
          <Field label="Currency" htmlFor="currency">
            <select id="currency" value={form.currency} onChange={(e) => set("currency", e.target.value as SettingsFormValues["currency"])}>
              {ACCOUNT_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </Grid>
      </Panel>

      <Panel title="Funded-account rules">
        <Grid>
          {text("maxDailyLossPct", "Maximum daily loss", preview ? `= ${formatMoney((size * preview.maxDailyLossPct) / 100, ccy)} of the initial balance` : undefined, "%")}
          <Field label="Daily loss measured from" htmlFor="dailyLossBasis">
            <select id="dailyLossBasis" value={form.dailyLossBasis} onChange={(e) => set("dailyLossBasis", e.target.value as SettingsFormValues["dailyLossBasis"])}>
              {DAILY_LOSS_BASES.map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </select>
          </Field>
          {text("maxDrawdownPct", "Maximum total drawdown", preview ? `Floor ${formatMoney(size - (size * preview.maxDrawdownPct) / 100, ccy)} (static)` : undefined, "%")}
          <Field label="Drawdown mode" htmlFor="drawdownMode">
            <select id="drawdownMode" value={form.drawdownMode} onChange={(e) => set("drawdownMode", e.target.value as SettingsFormValues["drawdownMode"])}>
              {DRAWDOWN_MODES.map((m) => (
                <option key={m} value={m}>
                  {DD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          {text("maxRiskPerTradePct", "Maximum risk per trade", preview ? `= ${formatMoney((size * preview.maxRiskPerTradePct) / 100, ccy)} at the initial balance` : undefined, "%")}
          {text("maxOpenPositions", "Maximum simultaneous positions")}
          {text("minRiskReward", "Minimum risk/reward", "1 : value. Trades below it are blocked.")}
        </Grid>
      </Panel>

      <Panel title="Instruments, sessions and scoring">
        <div className="flex flex-col gap-4">
          <Field label="Watchlist / allowed instruments" error={errors.allowedPairs} hint="Trades on instruments not in this list are blocked by the risk engine.">
            <WatchlistEditor value={form.allowedPairs} onChange={(list) => set("allowedPairs", list)} />
          </Field>
          <Field label="Trading sessions" hint="Outside these sessions a trade gets a WARNING (it is not blocked). None selected = no restriction.">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {TRADING_SESSIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded border border-line px-2 py-1">
                  <input type="checkbox" checked={form.tradingSessions.includes(s)} onChange={() => set("tradingSessions", toggle(form.tradingSessions, s))} />
                  <span>{SESSION_WINDOWS_UTC[s].label}</span>
                  <span className="num ml-auto text-[10.5px] text-faint">
                    {String(SESSION_WINDOWS_UTC[s].start).padStart(2, "0")}–{String(SESSION_WINDOWS_UTC[s].end).padStart(2, "0")} UTC
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Grid>
            {text("minSetupScore", "Minimum setup score", "An AI verdict below this is capped at CAUTION. The score is a heuristic, not a probability.")}
            <Field label="Trading day resets in" htmlFor="dayResetTimeZone" error={errors.dayResetTimeZone} hint='IANA time zone, e.g. "UTC" or "Europe/Prague". Used for daily loss.'>
              <input id="dayResetTimeZone" value={form.dayResetTimeZone} aria-invalid={!!errors.dayResetTimeZone} onChange={(e) => set("dayResetTimeZone", e.target.value)} />
            </Field>
          </Grid>
        </div>
      </Panel>

      <Panel title="Account state">
        <div className="flex flex-col gap-3">
          <Field label="Balance, today's P/L and open positions" htmlFor="accountStateSource">
            <select
              id="accountStateSource"
              className="max-w-sm"
              value={form.accountStateSource}
              onChange={(e) => set("accountStateSource", e.target.value as SettingsFormValues["accountStateSource"])}
            >
              {ACCOUNT_STATE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          {form.accountStateSource === "MANUAL" && preview && (
            <p className="text-[12px] text-muted">
              Current drawdown (from the starting balance):{" "}
              <span className="num text-fg">
                {formatMoney(Math.max(0, preview.accountSize - preview.manualState.equity), ccy)} (
                {((Math.max(0, preview.accountSize - preview.manualState.equity) / preview.accountSize) * 100).toFixed(2)}%)
              </span>
              . Entered by hand — this app never connects to a broker.
            </p>
          )}
          {form.accountStateSource === "JOURNAL" ? (
            <p className="text-[12px] text-muted">
              Balance = account size + P/L of closed journal trades. Open positions are journal entries marked “Open”, each
              counted at its full analysed risk. Record outcomes in the Journal to keep the daily-loss and drawdown checks accurate.
            </p>
          ) : (
            <Grid>
              {(
                [
                  ["balance", "Current balance"],
                  ["equity", "Current equity"],
                  ["todayRealizedPnl", "Today's realised P/L"],
                  ["todayUnrealizedPnl", "Today's unrealised P/L"],
                  ["openPositions", "Open positions"],
                  ["openRisk", "Risk on open positions"],
                  ["highWaterMark", "Highest closed balance"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} htmlFor={`m-${key}`} error={errors[`manualState.${key}`]}>
                  <input
                    id={`m-${key}`}
                    className="num"
                    inputMode="decimal"
                    value={form.manualState[key]}
                    aria-invalid={!!errors[`manualState.${key}`]}
                    onChange={(e) => setManual(key, e.target.value)}
                  />
                </Field>
              ))}
            </Grid>
          )}
        </div>
      </Panel>

      <Panel title="Market data">
        <div className="flex flex-col gap-3">
          <Grid>
            <Field label="Data mode" htmlFor="dataMode" hint="LIVE uses Twelve Data. MOCK is synthetic data for development; it is never used in LIVE mode.">
              <select id="dataMode" value={form.dataMode} onChange={(e) => set("dataMode", e.target.value as SettingsFormValues["dataMode"])}>
                <option value="LIVE">LIVE — Twelve Data</option>
                <option value="MOCK">MOCK — synthetic</option>
              </select>
            </Field>
            {text("freshnessThresholdSeconds", "Freshness threshold", "Data older than this is marked STALE DATA and is not analysed.", "s")}
            <Field label="Developer mode" hint="Shows the API usage panel (Twelve Data / Claude requests and errors).">
              <label className="flex items-center gap-2 py-1.5">
                <input type="checkbox" checked={form.developerMode} onChange={(e) => set("developerMode", e.target.checked)} />
                <span>Show API usage panel</span>
              </label>
            </Field>
          </Grid>
          <div className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
            <div>
              <span className="label">Twelve Data</span>
              <p className={status && !status.liveConfigured ? "text-block" : ""}>
                {status ? (status.liveConfigured ? "API key configured on the server." : "LIVE DATA UNAVAILABLE — TWELVE_DATA_API_KEY is not set in the server's .env.") : "…"}
              </p>
            </div>
            <div>
              <span className="label">AI analyst</span>
              <p>{status ? (status.ai.isMock ? "Mock rules (no ANTHROPIC_API_KEY set on the server)" : `Claude · ${status.ai.model}`) : "…"}</p>
            </div>
            <p className="text-faint sm:col-span-2">
              API keys live in the server's .env file. They are never sent to the browser or stored in the database; the browser
              only talks to this application's server.
            </p>
          </div>
        </div>
      </Panel>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-bg/95 py-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="ghost" onClick={reset}>
          Reset to defaults
        </Button>
        {message && <span className={message.tone === "block" ? "text-block" : "text-pass"}>{message.text}</span>}
      </div>
    </div>
  );
}
