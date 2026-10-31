import {
  calendarDateInTimeZone,
  presetRange,
  type AiReportKind,
  type AssistantBlockDto,
  type FinancialReportDto,
  type FinancialReportInput,
} from '@calmcash/shared';

import { formatRange } from '../../lib/text-format';
import { narrate } from './narration';
import type { AiProvider } from './provider/ai-provider';
import { runTool, type ToolCallPlan, type ToolContext } from './tools';

// On-demand reports. Sections come from the same read-only tools as the assistant (and through
// them from the dashboard, budget, recurring, subscription, and insight services), so a report's
// figures always equal the app's; the model only adds a short explanation, grounding-checked.
// Reports are computed when asked for and never stored or scheduled.

const REPORT_TOOLS: Readonly<Record<AiReportKind, ToolCallPlan['tool'][]>> = {
  period: ['getFinancialOverview', 'getCategorySpending', 'getSpendingPatterns'],
  categories: ['getCategorySpending', 'getSpendingPatterns'],
  merchants: ['getTopMerchants'],
  subscriptions: ['getSubscriptions', 'getUpcomingPayments'],
  budgets: ['getBudgetStatus'],
};

const TITLES: Readonly<Record<AiReportKind, string>> = {
  period: 'Financial summary',
  categories: 'Spending by category',
  merchants: 'Where you paid most often',
  subscriptions: 'Subscriptions and upcoming payments',
  budgets: 'Budget performance',
};

export async function buildReport(
  provider: AiProvider | undefined,
  input: FinancialReportInput,
  context: ToolContext,
  now: Date,
): Promise<FinancialReportDto> {
  const today = calendarDateInTimeZone(now, context.caller.timeZone);
  const base: Omit<ToolCallPlan, 'tool'> =
    input.period === 'custom' && input.from !== undefined
      ? { month: input.from.slice(0, 7), currency: input.currency ?? null }
      : {
          period: input.period === 'custom' ? 'last-month' : input.period,
          currency: input.currency ?? null,
        };
  const range =
    input.period === 'custom' && input.from !== undefined && input.to !== undefined
      ? { from: input.from, to: input.to }
      : presetRange(input.period === 'custom' ? 'last-month' : input.period, today);

  const sections: AssistantBlockDto[] = [];
  const facts: string[] = [];
  const summaries: string[] = [];
  for (const tool of REPORT_TOOLS[input.kind]) {
    const result = await runTool({ tool, ...base }, context);
    sections.push(...result.blocks);
    facts.push(...result.facts);
    summaries.push(result.summary);
    if (result.links.length > 0) sections.push({ kind: 'links', links: result.links.slice(0, 3) });
  }
  const currency = sections.find(
    (block) => block.kind === 'figures' && block.currency !== undefined,
  );
  const narration = await narrate(provider, {
    question: `Explain this ${TITLES[input.kind].toLowerCase()} report in plain words.`,
    facts,
    template: summaries.join(' '),
    purpose: 'report',
  });
  return {
    kind: input.kind,
    period: range,
    ...(currency?.kind === 'figures' && currency.currency !== undefined
      ? { currency: currency.currency }
      : {}),
    title: `${TITLES[input.kind]} — ${formatRange(range.from, range.to)}`,
    sections: sections.slice(0, 8),
    narrative: narration.text.slice(0, 2_000),
    narrativeSource: narration.source,
    generatedAt: now.toISOString(),
  };
}
