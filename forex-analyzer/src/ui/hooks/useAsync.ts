import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Runs an async loader on mount and whenever `deps` change; ignores results from superseded runs. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    load()
      .then((value) => {
        if (id !== run.current) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (id !== run.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (id === run.current) setLoading(false);
      });
  }, [...deps, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
