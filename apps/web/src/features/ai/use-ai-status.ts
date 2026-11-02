'use client';

import type { AiStatusDto } from '@calmcash/shared';

import { useAsyncResource, type AsyncResource } from '@/hooks/use-async-resource';
import { getAiStatus } from '@/services/ai.service';

// The assistant's availability, shared by every AI feature on a page. One request answers them
// all for half a minute (the API checks the local model at most that often too); a change in
// Settings clears it at once.

const FRESH_FOR_MS = 30_000;

let cached: { at: number; promise: Promise<AiStatusDto> } | undefined;

/** Forgets the shared status, e.g. after the person switched AI features on or off. */
export function invalidateAiStatus(): void {
  cached = undefined;
}

function loadAiStatus(): Promise<AiStatusDto> {
  const now = Date.now();
  if (cached === undefined || now - cached.at > FRESH_FOR_MS) {
    const promise = getAiStatus();
    cached = { at: now, promise };
    // A failed check is not remembered: the next component asks again.
    promise.catch(() => {
      if (cached?.promise === promise) cached = undefined;
    });
  }
  return cached.promise;
}

export function useAiStatus(): AsyncResource<AiStatusDto> {
  return useAsyncResource(loadAiStatus);
}
