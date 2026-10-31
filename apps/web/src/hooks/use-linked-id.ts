import { entityIdSchema } from '@calmcash/shared';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * The record a link asked to open (`?budget=…`, `?schedule=…`), read once when the page opens.
 * Only a well-formed ID is accepted; the page still loads it through the API, which decides
 * whether it exists and belongs to the signed-in user. Must render inside a Suspense boundary.
 */
export function useLinkedId(name: string): string | undefined {
  const params = useSearchParams();
  const [linked] = useState(() => {
    const parsed = entityIdSchema.safeParse(params.get(name));
    return parsed.success ? parsed.data : undefined;
  });
  return linked;
}
