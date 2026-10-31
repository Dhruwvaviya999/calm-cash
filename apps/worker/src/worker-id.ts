import { randomBytes } from 'node:crypto';

/**
 * A name for this process in leases and heartbeats: host, process ID, and a random suffix, so two
 * workers on one host (or a restarted one) never share a lease identity. Bounded to the column's
 * 100 characters; only characters safe in logs are kept.
 */
export function workerIdFor(
  host: string,
  pid: number,
  random = randomBytes(4).toString('hex'),
): string {
  const safeHost = host.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 60) || 'worker';
  return `${safeHost}:${pid.toString()}:${random}`;
}
