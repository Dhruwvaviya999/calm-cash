import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ForgotPasswordForm } from '@/features/auth';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage(): ReactNode {
  return <ForgotPasswordForm />;
}
