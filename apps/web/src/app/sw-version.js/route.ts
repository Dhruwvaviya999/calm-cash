// The deployed version, imported by the service worker (`importScripts('/sw-version.js')`).
// Browsers re-check imported scripts byte for byte when they look for a service-worker update, so
// a new deployment changes this file and lets long-open tabs learn that a new version exists,
// even though /sw.js itself did not change. Rendered once at build time.

export const dynamic = 'force-static';

export function GET(): Response {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'development';
  return new Response(`self.CALMCASH_VERSION = ${JSON.stringify(version)};\n`, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
