import {
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
} from '@calmcash/shared';

import type { EmailMessage } from '../../lib/email';

// Transactional e-mails of the authentication flow, as plain text plus a minimal, accessible HTML
// version. Every interpolated value is escaped. Links carry one-time tokens, so these messages are
// never logged.

interface Paragraphs {
  greeting: string;
  lines: readonly string[];
  action?: { label: string; url: string };
  footer: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(to: string, template: string, subject: string, content: Paragraphs): EmailMessage {
  const text = [
    content.greeting,
    '',
    ...content.lines.flatMap((line) => [line, '']),
    ...(content.action === undefined ? [] : [`${content.action.label}: ${content.action.url}`, '']),
    content.footer,
    '',
    '— CalmCash',
  ].join('\n');

  const paragraph = (value: string): string =>
    `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(value)}</p>`;
  const action =
    content.action === undefined
      ? ''
      : `<p style="margin:24px 0"><a href="${escapeHtml(content.action.url)}" style="background:#0f7a5c;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(content.action.label)}</a></p>` +
        `<p style="margin:0 0 16px;line-height:1.5;font-size:13px;color:#555555">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(content.action.url)}</span></p>`;

  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#fbfaf7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dc;border-radius:16px;padding:32px">',
    '<p style="margin:0 0 24px;font-size:18px;font-weight:600">Calm<span style="color:#0f7a5c">Cash</span></p>',
    paragraph(content.greeting),
    ...content.lines.map(paragraph),
    action,
    `<p style="margin:24px 0 0;line-height:1.5;font-size:13px;color:#555555">${escapeHtml(content.footer)}</p>`,
    '</div></body></html>',
  ].join('');

  return { to, subject, text, html, template };
}

export interface AuthEmailLinks {
  /** Origin of the web app, e.g. `https://app.calmcash.example`. */
  webAppUrl: string;
}

function link(webAppUrl: string, path: string, token?: string): string {
  const url = new URL(path, webAppUrl);
  if (token !== undefined) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

export function verificationEmail(
  links: AuthEmailLinks,
  recipient: { name: string; email: string },
  token: string,
): EmailMessage {
  return render(recipient.email, 'email-verification', 'Confirm your CalmCash email address', {
    greeting: `Hi ${recipient.name},`,
    lines: [
      'Welcome to CalmCash. Please confirm that this is your email address so you can sign in.',
      `The link works once and expires in ${EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.`,
    ],
    action: { label: 'Confirm email address', url: link(links.webAppUrl, '/verify-email', token) },
    footer: 'If you did not create a CalmCash account, you can ignore this email.',
  });
}

export function existingAccountEmail(
  links: AuthEmailLinks,
  recipient: { name: string; email: string },
): EmailMessage {
  return render(recipient.email, 'existing-account', 'You already have a CalmCash account', {
    greeting: `Hi ${recipient.name},`,
    lines: [
      'Someone tried to create a CalmCash account with this email address, but you already have one.',
      'You can sign in as usual. If you have forgotten your password, you can reset it from the sign-in page.',
    ],
    action: { label: 'Sign in to CalmCash', url: link(links.webAppUrl, '/login') },
    footer: 'If this was not you, no action is needed. Your account has not changed.',
  });
}

export function passwordResetEmail(
  links: AuthEmailLinks,
  recipient: { name: string; email: string },
  token: string,
): EmailMessage {
  return render(recipient.email, 'password-reset', 'Reset your CalmCash password', {
    greeting: `Hi ${recipient.name},`,
    lines: [
      'We received a request to reset the password of your CalmCash account.',
      `The link works once and expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes. Resetting signs you out on every device.`,
    ],
    action: {
      label: 'Choose a new password',
      url: link(links.webAppUrl, '/reset-password', token),
    },
    footer: 'If you did not ask for this, ignore this email. Your password stays the same.',
  });
}

export function passwordChangedEmail(
  links: AuthEmailLinks,
  recipient: { name: string; email: string },
): EmailMessage {
  return render(recipient.email, 'password-changed', 'Your CalmCash password was changed', {
    greeting: `Hi ${recipient.name},`,
    lines: [
      'The password of your CalmCash account was just changed, and other devices were signed out.',
    ],
    action: { label: 'Reset your password', url: link(links.webAppUrl, '/forgot-password') },
    footer:
      'If this was you, no action is needed. If not, reset your password right away to secure your account.',
  });
}
