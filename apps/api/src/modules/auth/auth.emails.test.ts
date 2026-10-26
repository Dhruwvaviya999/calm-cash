import { describe, expect, it } from 'vitest';

import { existingAccountEmail, passwordResetEmail, verificationEmail } from './auth.emails';

const LINKS = { webAppUrl: 'https://app.calmcash.example' };
const TOKEN = 'T'.repeat(43);

describe('authentication e-mails', () => {
  it('link to the web app with the token as a query parameter', () => {
    const message = verificationEmail(LINKS, { name: 'Asha', email: 'asha@example.com' }, TOKEN);

    expect(message.to).toBe('asha@example.com');
    expect(message.template).toBe('email-verification');
    expect(message.text).toContain(`https://app.calmcash.example/verify-email?token=${TOKEN}`);
    expect(message.html).toContain(`https://app.calmcash.example/verify-email?token=${TOKEN}`);
  });

  it('escape user-controlled values in HTML', () => {
    const message = passwordResetEmail(
      LINKS,
      { name: '<script>alert("x")</script>', email: 'a@example.com' },
      TOKEN,
    );

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('tell existing users about a sign-up attempt without including any token', () => {
    const message = existingAccountEmail(LINKS, { name: 'Asha', email: 'asha@example.com' });

    expect(message.text).toContain('https://app.calmcash.example/login');
    expect(message.text).not.toContain('token=');
  });
});
