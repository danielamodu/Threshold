import { useAuth } from "@clerk/clerk-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

interface ApiCallState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Fetches once per dependency change, using the real Clerk session token. */
export function useApiCall<T>(
  fn: (token: string | null) => Promise<T>,
  deps: React.DependencyList,
): ApiCallState<T> & { reload: () => void } {
  const { getToken, isLoaded } = useAuth();
  const [state, setState] = useState<ApiCallState<T>>({ data: null, loading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (!isLoaded) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const token = await getToken();
      const data = await fn(token);
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err),
      });
    }
  }, [isLoaded, getToken, reloadKey, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: () => setReloadKey((k) => k + 1) };
}
