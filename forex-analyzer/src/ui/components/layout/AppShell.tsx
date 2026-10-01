import { NavLink, Outlet, useLocation } from "react-router";
import { useAppData } from "@/ui/hooks/useAppData";
import { useClock } from "@/ui/hooks/useClock";
import { feedState, useLiveFeed } from "@/ui/hooks/useLiveFeed";
import { DevPanel } from "./DevPanel";
import type { DataMode } from "@/shared/types/market";
import { useState } from "react";
import { activeSessions, SESSION_WINDOWS_UTC } from "@/shared/sessions";
import { Notice } from "@/ui/components/ui/Notice";

const NAV = [
  { to: "/", label: "Dashboard", glyph: "▦" },
  { to: "/analyze", label: "Trade Analyzer", glyph: "◎" },
  { to: "/autonomous", label: "Autonomous Analysis", glyph: "◇" },
  { to: "/journal", label: "Journal", glyph: "≡" },
  { to: "/settings", label: "Settings", glyph: "⚙" },
] as const;

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/analyze": "Trade Analyzer",
  "/autonomous": "Autonomous Analysis",
  "/journal": "Journal",
  "/settings": "Settings",
};

const DOT: Record<string, string> = { LIVE: "bg-pass", RECONNECTING: "bg-warn animate-pulse", OFFLINE: "bg-block" };
const DOT_TEXT: Record<string, string> = { LIVE: "text-pass", RECONNECTING: "text-warn", OFFLINE: "text-block" };

function DataModeToggle() {
  const { settings, updateSettings } = useAppData();
  const [busy, setBusy] = useState(false);
  const mode = settings?.dataMode ?? "LIVE";
  const choose = async (m: DataMode) => {
    if (m === mode || busy) return;
    setBusy(true);
    try {
      await updateSettings({ dataMode: m });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="label hidden lg:inline">Data mode</span>
      <div role="radiogroup" aria-label="Data mode" className="flex rounded border border-line-strong bg-panel-2 p-0.5">
        {(["LIVE", "MOCK"] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={m === mode}
            disabled={busy}
            onClick={() => void choose(m)}
            className={`rounded-sm px-2 py-0.5 text-[11px] font-semibold ${m === mode ? (m === "LIVE" ? "bg-pass/20 text-pass" : "bg-warn/20 text-warn") : "text-muted hover:text-fg"}`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedIndicator() {
  const feed = useLiveFeed();
  const { status } = useAppData();
  const state = feedState(feed);
  const mode = feed.status?.mode ?? status?.dataMode ?? "LIVE";
  const unavailable = mode === "LIVE" && status && !status.liveConfigured;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded border px-1.5 py-px text-[10.5px] font-semibold tracking-wide ${
          mode === "MOCK" ? "border-warn/40 bg-warn/10 text-warn" : unavailable ? "border-block/40 bg-block/10 text-block" : "border-pass/40 bg-pass/10 text-pass"
        }`}
        title={unavailable ? "TWELVE_DATA_API_KEY is not set on the server" : undefined}
      >
        {mode === "MOCK" ? "MOCK DATA" : unavailable ? "LIVE DATA UNAVAILABLE" : "LIVE DATA"}
      </span>
      <span className={`flex items-center gap-1 text-[11.5px] font-semibold ${DOT_TEXT[state.label]}`} title={state.reason ?? undefined} data-testid="feed-state">
        <span className={`h-2 w-2 rounded-full ${DOT[state.label]}`} aria-hidden />
        {mode === "MOCK" && state.label === "LIVE" ? "SIMULATED" : state.label}
      </span>
    </div>
  );
}

function TopBar() {
  const { status } = useAppData();
  const now = useClock();
  const { pathname } = useLocation();
  const sessions = activeSessions(now);
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
      <h1 className="text-[14px] font-semibold">{TITLES[pathname] ?? ""}</h1>
      <div className="flex min-w-0 items-center gap-4 text-[11.5px] text-muted">
        <DataModeToggle />
        <FeedIndicator />
        {status && (
          <span className={`hidden rounded border px-1.5 py-px text-[10.5px] font-semibold xl:inline ${status.ai.isMock ? "border-warn/40 text-warn" : "border-line-strong text-muted"}`}>
            {status.ai.isMock ? "MOCK AI" : `CLAUDE · ${status.ai.model}`}
          </span>
        )}
        <span className="num hidden md:inline">{now.toISOString().slice(11, 19)} UTC</span>
        <span className="hidden truncate 2xl:inline">
          {sessions.length ? sessions.map((s) => SESSION_WINDOWS_UTC[s].label).join(" · ") : "No major session"}
        </span>
      </div>
    </header>
  );
}

export function AppShell() {
  const { error, settings } = useAppData();
  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="flex w-14 shrink-0 flex-col border-r border-line bg-panel md:w-52" aria-label="Main">
        <div className="flex h-11 items-center gap-2 border-b border-line px-4">
          <span className="text-accent">◆</span>
          <span className="hidden text-[13px] font-semibold tracking-wide md:inline">FX Trade Analyzer</span>
        </div>
        <ul className="flex flex-col gap-0.5 p-2">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] ${
                    isActive ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg"
                  }`
                }
              >
                <span className="w-4 text-center" aria-hidden>
                  {item.glyph}
                </span>
                <span className="hidden md:inline">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-auto hidden border-t border-line p-3 text-[11px] leading-snug text-faint md:block">
          Decision support only. This app never places, modifies or closes orders. You decide.
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <Notice tone="block" className="mb-3">
              Could not reach the server: {error}
            </Notice>
          )}
          <Outlet />
        </main>
        {settings?.developerMode && <DevPanel />}
      </div>
    </div>
  );
}
