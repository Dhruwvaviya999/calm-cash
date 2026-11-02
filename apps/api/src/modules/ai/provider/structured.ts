import { z } from 'zod';

import { AiUnavailableError, type AiChatMessage, type AiProvider } from './ai-provider';

// Structured model output. The model is asked for JSON matching a schema derived from a Zod
// schema; the answer is parsed defensively and validated with the same Zod schema. Valid JSON is
// not trusted — callers still check every identifier and value against the user's own data. An
// unreadable answer is retried once (asking again changes nothing in CalmCash), then refused.

/** Removes a ```json fence or leading/trailing prose some models add around JSON. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (end < start) return undefined;
  try {
    const value: unknown = JSON.parse(candidate.slice(start, end + 1));
    return value;
  } catch {
    return undefined;
  }
}

/** The JSON Schema sent to the model for a Zod schema (draft 7, no Zod-only keywords). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
  const { $schema: _dropped, ...rest } = json;
  return rest;
}

export interface StructuredRequest<TSchema extends z.ZodType> {
  provider: AiProvider;
  messages: readonly AiChatMessage[];
  schema: TSchema;
  purpose: string;
  maxOutputTokens?: number;
  signal?: AbortSignal | undefined;
}

export async function generateStructured<TSchema extends z.ZodType>({
  provider,
  messages,
  schema,
  purpose,
  maxOutputTokens,
  signal,
}: StructuredRequest<TSchema>): Promise<z.output<TSchema>> {
  const jsonSchema = jsonSchemaFor(schema);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const text = await provider.complete({
      messages,
      jsonSchema,
      purpose,
      signal,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    });
    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) {
      return parsed.data;
    }
  }
  throw new AiUnavailableError('invalid_output');
}
