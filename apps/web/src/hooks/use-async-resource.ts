import { useCallback, useEffect, useState } from 'react';

import type { AsyncState } from '@/types/async-state';

export interface AsyncResource<TData> {
  state: AsyncState<TData>;
  /** Discards the current result and loads again. */
  reload: () => void;
}

/**
 * Loads data on mount (client-side) and on `reload()`, aborting the in-flight request when the
 * component unmounts or a reload starts. `load` must be referentially stable, e.g. a module-level
 * function, otherwise every render would trigger a new request.
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

  return { state, reload };
}
