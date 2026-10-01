import { NavLink, Outlet, useLocation } from "react-router";
import { useAppData } from "@/hooks/useAppData";
import { useClock } from "@/hooks/useClock";
import { activeSessions, SESSION_WINDOWS_UTC } from "@/lib/sessions";
import { Notice } from "@/components/ui/Notice";

const NAV = [
  { to: "/", label: "Dashboard", glyph: "▦" },
  { to: "/analyze", label: "Trade Analyzer", glyph: "◎" },
  { to: "/journal", label: "Journal", glyph: "≡" },
  { to: "/settings", label: "Settings", glyph: "⚙" },
] as const;

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/analyze": "Trade Analyzer",
  "/journal": "Journal",
  "/settings": "Settings",
};

function ModeBadge({ mock, label }: { mock: boolean; label: string }) {
  return (
    <span
      className={`rounded border px-1.5 py-px text-[10.5px] font-semibold tracking-wide ${
        mock ? "border-warn/40 bg-warn/10 text-warn" : "border-pass/40 bg-pass/10 text-pass"
      }`}
    >
      {label}
    </span>
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
      <div className="flex min-w-0 items-center gap-3 text-[11.5px] text-muted">
        {status && (
          <div className="hidden items-center gap-1.5 sm:flex">
            <ModeBadge mock={status.marketData.isMock} label={status.marketData.isMock ? "MOCK MARKET DATA" : status.marketData.name.toUpperCase()} />
            <ModeBadge mock={status.ai.isMock} label={status.ai.isMock ? "MOCK AI" : `CLAUDE · ${status.ai.model}`} />
          </div>
        )}
        <span className="num hidden md:inline">
          {now.toISOString().slice(11, 19)} UTC
        </span>
        <span className="hidden truncate lg:inline">
          {sessions.length ? sessions.map((s) => SESSION_WINDOWS_UTC[s].label).join(" · ") : "No major session"}
        </span>
      </div>
    </header>
  );
}

export function AppShell() {
  const { error } = useAppData();
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
      </div>
    </div>
  );
}
