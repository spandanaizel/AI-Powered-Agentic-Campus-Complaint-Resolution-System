import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/** Fetch on mount/when deps change. Returns { data, error, loading, reload }. Aborts stale requests. */
export function useApi(path, { query, skip = false } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !skip });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([path, query]);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (skip || !path) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, { query, signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => { if (error.name !== 'AbortError') setState({ data: null, error, loading: false }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, skip]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} | Campus Complaint Desk` : 'Campus Complaint Desk';
  }, [title]);
}
