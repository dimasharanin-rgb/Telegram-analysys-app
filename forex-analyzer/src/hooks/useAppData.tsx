import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/apiClient";
import type { InstrumentSpec } from "@/types/instrument";
import type { AccountSettings } from "@/types/settings";
import type { AppStatus } from "@/types/status";

interface AppData {
  status: AppStatus | null;
  settings: AccountSettings | null;
  instruments: InstrumentSpec[];
  error: string | null;
  setSettings: (settings: AccountSettings) => void;
  reload: () => void;
}

const Ctx = createContext<AppData | null>(null);

/** Server status, settings and the instrument catalogue, loaded once and shared by every page. */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [instruments, setInstruments] = useState<InstrumentSpec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.status(), api.settings(), api.instruments()])
      .then(([s, st, inst]) => {
        if (cancelled) return;
        setStatus(s);
        setSettings(st);
        setInstruments(inst);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return <Ctx.Provider value={{ status, settings, instruments, error, setSettings, reload }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppData must be used inside AppDataProvider");
  return ctx;
}
