import { EventEmitter, once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { pino } from 'pino';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { registerGracefulShutdown } from './shutdown';

const servers: Server[] = [];

async function startServer(): Promise<Server> {
  const server = createServer((_req, res) => {
    res.end('ok');
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

interface ShutdownHarness {
  events: EventEmitter;
  exit: Mock<(code: number) => void>;
  cleanup: Mock<() => Promise<void>>;
  shutdown: (reason: string, exitCode: number) => Promise<void>;
}

function setup(
  server: Server,
  cleanup: () => Promise<void> = () => Promise.resolve(),
): ShutdownHarness {
  const events = new EventEmitter();
  const exit = vi.fn<(code: number) => void>();
  const cleanupSpy = vi.fn(cleanup);
  const shutdown = registerGracefulShutdown({
    server,
    logger: pino({ level: 'silent' }),
    timeoutMs: 5_000,
    cleanup: cleanupSpy,
    events,
    exit,
  });
  return { events, exit, cleanup: cleanupSpy, shutdown };
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe('registerGracefulShutdown', () => {
  it('closes the server, runs cleanup, then exits with code 0 on SIGTERM', async () => {
    const server = await startServer();
    const { events, exit, cleanup } = setup(server);

    events.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });

    expect(server.listening).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('exits with code 1 after a fatal error', async () => {
    const server = await startServer();
    const { events, exit } = setup(server);

    events.emit('uncaughtException', new Error('boom'));
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  it('exits with code 1 when cleanup fails', async () => {
    const server = await startServer();
    const { exit, shutdown } = setup(server, () => Promise.reject(new Error('disconnect failed')));

    await shutdown('test', 0);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs the sequence only once when several signals arrive', async () => {
    const server = await startServer();
    const { events, exit, cleanup } = setup(server);

    events.emit('SIGINT');
    events.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
});
