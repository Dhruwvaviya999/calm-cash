import { useCallback, useEffect, useState } from 'react';

import type { AsyncState } from '@/types/async-state';

export interface AsyncResource<TData> {
  state: AsyncState<TData>;
  /** Discards the current result and loads again (shows the loading state). */
  reload: () => void;
  /** Loads again in the background, keeping the current result on screen until it arrives. */
  refresh: () => void;
}

/**
 * Loads data on mount (client-side) and on `reload()`/`refresh()`, aborting the in-flight request
 * when the component unmounts or another load starts. `load` must be referentially stable, e.g. a
 * module-level function or a `useCallback`, otherwise every render would trigger a new request.
 */
export function useAsyncResource<TData>(
  load: (signal: AbortSignal) => Promise<TData>,
): AsyncResource<TData> {
  const [state, setState] = useState<AsyncState<TData>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setState({ status: 'success', data });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', error });
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  const refresh = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload, refresh };
}
