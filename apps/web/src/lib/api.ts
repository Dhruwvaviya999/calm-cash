import { createApiClient, type ApiClient } from './api-client';
import { publicEnv } from './env';
import { getCsrfToken, notifySessionEnded, refreshSession } from './session-store';

/** The application-wide API client, configured from validated environment variables. */
export const api: ApiClient = createApiClient({
  baseUrl: publicEnv.apiUrl,
  getCsrfToken,
  refreshCsrfToken: refreshSession,
  onUnauthorized: notifySessionEnded,
});
