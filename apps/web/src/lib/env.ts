import { z } from 'zod';

/** Browser-safe configuration. Only NEXT_PUBLIC_* variables may appear here. */
export interface PublicEnv {
  /** API origin for separate local servers, or empty for the current origin on Vercel. */
  apiUrl: string;
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .union([
      z.literal(''),
      z
        .url({
          protocol: /^https?$/,
          error: 'Must be an http(s) API origin, or empty to use the current origin.',
        })
        .refine(
          (value) => URL.canParse(value) && new URL(value).origin === value.replace(/\/$/, ''),
          {
            message:
              'Use an origin without a path, query, or fragment; /api/v1 is added by the client.',
          },
        ),
    ])
    .default(''),
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
