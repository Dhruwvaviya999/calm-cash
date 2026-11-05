import { api } from '@/lib/api';

/** The signed-in person's records as one JSON file (see the API's data-export module). */
export function downloadFinancialData(signal?: AbortSignal): Promise<Blob> {
  return api.download('/exports/financial-data', signal);
}
