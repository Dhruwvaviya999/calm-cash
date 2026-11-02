import { waitUntil } from '@vercel/functions';

import type { Logger } from './logger';

/**
 * Work that must not delay or shape an HTTP response — for example e-mails whose delivery would
 * otherwise reveal through timing or errors whether an account exists. Failures are logged, and
 * `drain()` lets graceful shutdown (and tests) wait for in-flight tasks.
 */
export interface BackgroundTasks {
  run: (name: string, task: () => Promise<void>) => void;
  drain: () => Promise<void>;
}

export function createBackgroundTasks(logger: Logger): BackgroundTasks {
  const pending = new Set<Promise<void>>();

  return {
    run: (name, task) => {
      const promise = Promise.resolve()
        .then(task)
        .catch((error: unknown) => {
          logger.error({ err: error, task: name }, 'Background task failed');
        })
        .finally(() => {
          pending.delete(promise);
        });
      pending.add(promise);
      // Registers with the current Vercel invocation; outside Vercel this is a no-op.
      waitUntil(promise);
    },

    drain: async () => {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
