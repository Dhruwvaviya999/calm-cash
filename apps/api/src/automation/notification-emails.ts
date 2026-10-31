import {
  NOTIFICATION_TYPE_CATEGORY,
  notificationHref,
  type MonthlySummaryDto,
  type NotificationCategory,
  type NotificationTargetDto,
  type NotificationType,
} from '@calmcash/shared';

import type { EmailMessage } from '../lib/email';
import { escapeHtml } from '../lib/html';
import {
  describeRatio,
  formatBasisPoints,
  formatMoney,
  formatMonth,
  formatRange,
} from './notification-text';

// E-mails for notifications: plain text plus a minimal, accessible HTML version in the style of
// the authentication e-mails. Every interpolated value is escaped. Subjects are generic — no
// names, amounts, or descriptions — because subjects show up in lock screens and inbox previews.
// Each e-mail links to the related page (which still requires signing in) and to the settings
// where e-mail can be switched off.

const SUBJECTS: Readonly<Record<NotificationType, string>> = {
  budget_approaching_limit: 'Budget alert from CalmCash',
  budget_limit_reached: 'Budget limit reached — CalmCash',
  recurring_payment_upcoming: 'Payment reminder from CalmCash',
  recurring_payment_due: 'A payment is due today — CalmCash',
  recurring_payment_overdue: 'Overdue payment reminder — CalmCash',
  subscription_renewal_upcoming: 'Subscription renewal reminder — CalmCash',
  monthly_summary_ready: 'Your monthly summary from CalmCash',
  email_delivery_problem: 'CalmCash notification',
};

const CATEGORY_NAMES: Readonly<Record<NotificationCategory, string>> = {
  budget_alerts: 'budget alerts',
  upcoming_payments: 'upcoming payment reminders',
  overdue_payments: 'overdue payment reminders',
  subscription_renewals: 'subscription renewal reminders',
  monthly_summary: 'monthly summaries',
};

export interface NotificationEmailInput {
  to: string;
  recipientName: string;
  type: NotificationType;
  title: string;
  body: string;
  target: NotificationTargetDto | undefined;
  /** Monthly summaries: the figures, recomputed when the e-mail is sent. */
  summary?: MonthlySummaryDto | undefined;
  /** Stable per delivery, reused by retries. */
  messageId: string;
  webAppUrl: string;
}

function countOf(count: number, noun: string): string {
  return `${count.toString()} ${noun}${count === 1 ? '' : 's'}`;
}

function summaryLines(summary: MonthlySummaryDto): { heading: string; lines: string[] }[] {
  const { currency } = summary;
  const money = (amount: string): string => formatMoney(amount, currency);
  const sections = [
    {
      heading: `What happened in ${formatMonth(summary.month)} (${formatRange(summary.from, summary.to)})`,
      lines: [
        `Income: ${money(summary.incomeMinor)} (${countOf(summary.incomeCount, 'transaction')})`,
        `Spending: ${money(summary.expenseMinor)} (${countOf(summary.expenseCount, 'transaction')})`,
        `Net cash flow: ${money(summary.netMinor)}`,
        `Savings rate: ${describeRatio(summary.savingsRate)}`,
      ],
    },
  ];
  if (summary.topCategories.length > 0) {
    sections.push({
      heading: 'Where the money went',
      lines: summary.topCategories.map(
        (entry) =>
          `${entry.name}: ${money(entry.amountMinor)} (${formatBasisPoints(BigInt(entry.shareBasisPoints))} of spending)`,
      ),
    });
  }
  if (summary.budgets.total > 0) {
    const { budgets } = summary;
    sections.push({
      heading: 'Monthly budgets',
      lines: [
        `${budgets.onTrack.toString()} on track, ${budgets.approachingLimit.toString()} near their limit, ${budgets.limitReached.toString()} at their limit, ${budgets.overBudget.toString()} over budget.`,
      ],
    });
  }
  sections.push({
    heading: `Still expected (${formatRange(summary.upcoming.from, summary.upcoming.to)})`,
    lines: [
      summary.upcoming.expenseCount === 0
        ? 'No scheduled payments are expected.'
        : `${countOf(summary.upcoming.expenseCount, 'scheduled payment')}, about ${money(summary.upcoming.expectedExpenseMinor)} in total. These are plans, not money that has moved.`,
    ],
  });
  return sections;
}

export function renderNotificationEmail(input: NotificationEmailInput): EmailMessage {
  const subject = SUBJECTS[input.type];
  const pageUrl = new URL(notificationHref(input.target), input.webAppUrl).toString();
  const settingsUrl = new URL(
    notificationHref({ kind: 'notification_settings' }),
    input.webAppUrl,
  ).toString();
  const category = NOTIFICATION_TYPE_CATEGORY[input.type];
  const footer =
    category === null
      ? 'You can review your notification settings in CalmCash.'
      : `You receive this because e-mail is on for ${CATEGORY_NAMES[category]}. Turn it off in Settings → Notifications.`;
  const sections = input.summary === undefined ? [] : summaryLines(input.summary);

  const text = [
    `Hi ${input.recipientName},`,
    '',
    input.title,
    '',
    input.body,
    '',
    ...sections.flatMap((section) => [
      section.heading,
      ...section.lines.map((line) => `- ${line}`),
      '',
    ]),
    `Open in CalmCash: ${pageUrl}`,
    '',
    `${footer} ${settingsUrl}`,
    '',
    'CalmCash never moves money or records a payment on its own.',
    '',
    '— CalmCash',
  ].join('\n');

  const paragraph = (value: string, style = 'margin:0 0 16px;line-height:1.5'): string =>
    `<p style="${style}">${escapeHtml(value)}</p>`;
  const sectionHtml = sections
    .map(
      (section) =>
        `<h2 style="margin:24px 0 8px;font-size:15px">${escapeHtml(section.heading)}</h2>` +
        `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.5">${section.lines
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join('')}</ul>`,
    )
    .join('');

  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#fbfaf7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dc;border-radius:16px;padding:32px">',
    '<p style="margin:0 0 24px;font-size:18px;font-weight:600">Calm<span style="color:#0f7a5c">Cash</span></p>',
    paragraph(`Hi ${input.recipientName},`),
    `<h1 style="margin:0 0 12px;font-size:18px;line-height:1.4">${escapeHtml(input.title)}</h1>`,
    paragraph(input.body),
    sectionHtml,
    `<p style="margin:24px 0"><a href="${escapeHtml(pageUrl)}" style="background:#0f7a5c;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Open in CalmCash</a></p>`,
    `<p style="margin:24px 0 0;line-height:1.5;font-size:13px;color:#555555">${escapeHtml(footer)} <a href="${escapeHtml(settingsUrl)}" style="color:#0f7a5c">Notification settings</a></p>`,
    paragraph(
      'CalmCash never moves money or records a payment on its own.',
      'margin:8px 0 0;line-height:1.5;font-size:13px;color:#555555',
    ),
    '</div></body></html>',
  ].join('');

  return {
    to: input.to,
    subject,
    text,
    html,
    template: `notification:${input.type}`,
    messageId: input.messageId,
  };
}
