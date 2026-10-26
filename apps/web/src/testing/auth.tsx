import type { AuthSessionDto, UserDto } from '@calmcash/shared';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth';
import { ApiClientError, type ApiClientErrorCode } from '@/lib/api-client';

// Test helpers for components that read the authentication state. Values are built directly,
// so component tests never depend on the network or on the provider's start-up request.

export const TEST_USER: UserDto = {
  id: '0193a000-0000-7000-8000-000000000001',
  name: 'Asha Rao',
  email: 'asha@example.com',
  emailVerifiedAt: '2026-10-20T09:30:00.000Z',
  preferredCurrency: 'INR',
  timezone: 'Asia/Kolkata',
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:30:00.000Z',
};

export const TEST_SESSION: AuthSessionDto = {
  user: TEST_USER,
  csrfToken: 'c'.repeat(43),
  sessionId: '0193a000-0000-7000-8000-000000000101',
  expiresAt: '2026-11-03T09:30:00.000Z',
};

export function createAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    state: { status: 'authenticated', session: TEST_SESSION },
    signIn: vi.fn<AuthContextValue['signIn']>(() => Promise.resolve(TEST_SESSION)),
    signOut: vi.fn<AuthContextValue['signOut']>(() => Promise.resolve()),
    retry: vi.fn<AuthContextValue['retry']>(),
    updateUser: vi.fn<AuthContextValue['updateUser']>(),
    replaceSession: vi.fn<AuthContextValue['replaceSession']>(),
    endSession: vi.fn<AuthContextValue['endSession']>(),
    ...overrides,
  };
}

export function renderWithAuth(
  ui: ReactElement,
  value: AuthContextValue = createAuthValue(),
): RenderResult {
  return render(<AuthContext value={value}>{ui}</AuthContext>);
}

export function apiError(code: ApiClientErrorCode, message: string, status = 400): ApiClientError {
  return new ApiClientError({ code, message, status });
}
