import type { Server } from 'node:http';

import type { Logger } from './logger';

/** The subset of `process` used for shutdown; injectable so the sequence can be tested. */
export interface ProcessEventSource {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
}

export interface GracefulShutdownOptions {
  server: Server;
  logger: Logger;
  /** Maximum time to wait for in-flight requests before forcing the process to exit. */
  timeoutMs: number;
  /** Releases resources (e.g. database connections) after the server stops accepting requests. */
  cleanup: () => Promise<void>;
  /** Defaults to the real `process`. */
  events?: ProcessEventSource;
  /** Defaults to `process.exit`. */
  exit?: (code: number) => void;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
    // Keep-alive sockets without an active request would otherwise hold `close()` open.
    server.closeIdleConnections();
  });
}

/**
 * Stops accepting connections on SIGINT/SIGTERM, lets in-flight requests finish, runs cleanup,
 * and exits. Fatal process errors trigger the same sequence with a non-zero exit code.
 * Returns the shutdown function so callers (and tests) can trigger it directly.
 */
export function registerGracefulShutdown({
  server,
  logger,
  timeoutMs,
  cleanup,
  events = process,
  exit = (code) => process.exit(code),
}: GracefulShutdownOptions): (reason: string, exitCode: number) => Promise<void> {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, 'Graceful shutdown timed out; forcing exit');
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);
    forceExit.unref();

    let finalExitCode = exitCode;
    try {
      if (server.listening) {
        await closeServer(server);
      }
      await cleanup();
      logger.info('Shutdown complete');
    } catch (error: unknown) {
      logger.error({ err: error }, 'Error during shutdown');
      finalExitCode = 1;
    } finally {
      clearTimeout(forceExit);
      exit(finalExitCode);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    events.once(signal, () => {
      void shutdown(signal, 0);
    });
  }

  events.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });

  events.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException', 1);
  });

  return shutdown;
}
