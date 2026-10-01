import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getInstrument } from "@/shared/instruments";
import type { InstrumentSpec } from "@/shared/types/instrument";
import type { AccountSettings } from "@/shared/types/settings";
import type { AppStatus } from "@/shared/types/status";
import { api } from "@/ui/lib/apiClient";

interface AppData {
  status: AppStatus | null;
  settings: AccountSettings | null;
  /** The user's watchlist as instrument specs. */
  instruments: InstrumentSpec[];
  error: string | null;
  setSettings: (settings: AccountSettings) => void;
  /** Saves a change to the settings and applies it everywhere. */
  updateSettings: (patch: Partial<AccountSettings>) => Promise<AccountSettings>;
  reload: () => void;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettingsState] = useState<AccountSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.status(), api.settings()])
      .then(([s, st]) => {
        if (cancelled) return;
        setStatus(s);
        setSettingsState(st);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setSettings = useCallback((s: AccountSettings) => {
    setSettingsState(s);
    void api.status().then(setStatus).catch(() => undefined);
  }, []);
  const updateSettings = useCallback(
    async (patch: Partial<AccountSettings>) => {
      if (!settings) throw new Error("Settings not loaded");
      const saved = await api.saveSettings({ ...settings, ...patch });
      setSettings(saved);
      return saved;
    },
    [settings, setSettings],
  );
  const instruments = useMemo(
    () => (settings?.allowedPairs ?? []).map((s) => getInstrument(s)).filter((i): i is InstrumentSpec => !!i),
    [settings],
  );

  return <Ctx.Provider value={{ status, settings, instruments, error, setSettings, updateSettings, reload }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppData must be used inside AppDataProvider");
  return ctx;
}
