import { z } from 'zod';

/** Browser-safe configuration. Only NEXT_PUBLIC_* variables may appear here. */
export interface PublicEnv {
  /** Origin of the CalmCash API, e.g. `http://localhost:4000`. */
  apiUrl: string;
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url({
    protocol: /^https?$/,
    error: 'Must be the http(s) origin of the CalmCash API, e.g. "http://localhost:4000".',
  }),
});

function loadPublicEnv(): PublicEnv {
  // Next.js inlines NEXT_PUBLIC_* values at build time only when they are referenced literally,
  // so each variable must be read as `process.env.NAME` (never via a dynamic key).
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid public environment configuration:\n${issues}\n` +
        'Copy apps/web/.env.example to apps/web/.env.local and adjust the values.',
    );
  }

  return { apiUrl: result.data.NEXT_PUBLIC_API_URL };
}

export const publicEnv: PublicEnv = loadPublicEnv();
