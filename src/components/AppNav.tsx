"use client";

import * as React from "react";
import { cx } from "@/lib/client/format";

export type AppTab = "analyze" | "insights" | "stats";

export interface AppNavProps {
  active: AppTab;
  available: Record<AppTab, boolean>;
  onChange: (tab: AppTab) => void;
}

const TABS: { id: AppTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "analyze",
    label: "Analyze",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      </svg>
    ),
  },
  {
    id: "insights",
    label: "Insights",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" />
      </svg>
    ),
  },
  {
    id: "stats",
    label: "Stats",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10" />
        <path d="M12 20V4" />
        <path d="M20 20v-6" />
      </svg>
    ),
  },
];

/**
 * Tabs on desktop, a thumb-reachable bottom bar on mobile.
 * Tabs the run has not reached yet are disabled rather than hidden, so the
 * shape of the flow is visible from the first screen.
 */
export function AppNav({ active, available, onChange }: AppNavProps) {
  return (
    <>
      {/* Desktop / tablet */}
      <nav
        aria-label="Sections"
        className="no-print hidden border-b border-line bg-white sm:block"
      >
        <div className="app-container flex gap-1">
          {TABS.map((tab) => {
            const enabled = available[tab.id];
            const current = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={!enabled}
                aria-current={current ? "page" : undefined}
                onClick={() => onChange(tab.id)}
                className={cx(
                  "relative -mb-px flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors",
                  current
                    ? "border-b-2 border-brand-600 text-brand-700"
                    : "border-b-2 border-transparent text-muted hover:text-ink",
                  !enabled && "cursor-not-allowed text-faint hover:text-faint",
                )}
              >
                <span aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile */}
      <nav
        aria-label="Sections"
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <ul className="grid grid-cols-3">
          {TABS.map((tab) => {
            const enabled = available[tab.id];
            const current = active === tab.id;
            return (
              <li key={tab.id}>
                <button
                  type="button"
                  disabled={!enabled}
                  aria-current={current ? "page" : undefined}
                  onClick={() => onChange(tab.id)}
                  className={cx(
                    "flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-medium",
                    current ? "text-brand-700" : "text-muted",
                    !enabled && "text-faint",
                  )}
                >
                  <span aria-hidden="true">{tab.icon}</span>
                  {tab.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
