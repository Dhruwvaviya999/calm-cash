import {
  insightListDtoSchema,
  recurringCandidateListDtoSchema,
  type InsightListDto,
  type RecurringCandidateListDto,
} from '@calmcash/shared';
import { z } from 'zod';

import { api } from '@/lib/api';

// Deterministic insights: computed by fixed rules from recorded transactions, available whether or
// not the assistant is switched on. `query` is the dashboard-style period query without the `?`.

const dismissedSchema = z.object({ dismissed: z.literal(true) });

export function listInsights(query: string, signal?: AbortSignal): Promise<InsightListDto> {
  return api.request(query === '' ? '/insights' : `/insights?${query}`, {
    schema: insightListDtoSchema,
    signal,
  });
}

export function listRecurringCandidates(signal?: AbortSignal): Promise<RecurringCandidateListDto> {
  return api.request('/insights/recurring-candidates', {
    schema: recurringCandidateListDtoSchema,
    signal,
  });
}

export async function dismissInsight(key: string): Promise<void> {
  await api.request(`/insights/${encodeURIComponent(key)}/dismiss`, {
    schema: dismissedSchema,
    method: 'POST',
  });
}

export async function dismissRecurringCandidate(key: string): Promise<void> {
  await api.request(`/insights/recurring-candidates/${encodeURIComponent(key)}/dismiss`, {
    schema: dismissedSchema,
    method: 'POST',
  });
}
