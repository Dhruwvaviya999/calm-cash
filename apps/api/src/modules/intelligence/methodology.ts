import { INTELLIGENCE_METHODOLOGY_VERSION, type MethodologyDto } from '@calmcash/shared';

// The documented methods, returned with every result so the page and the assistant explain the
// same thing the code does. Keep these in step with docs/database-design.md §3h.

const HISTORY =
  'History is the last six completed calendar months in your time zone, in one currency. Months before your first recorded income or expense are left out; the first month counts only if recording began in its first seven days.';

const COMMON_LIMITATIONS = [
  'Estimates come from your recorded history; they are not guarantees and are not statistically validated predictions.',
  'Currencies are never added together or converted.',
  'Transfers between your accounts and balance corrections are neither income nor spending.',
];

export const CASH_FLOW_METHODOLOGY: MethodologyDto = {
  version: INTELLIGENCE_METHODOLOGY_VERSION,
  summary:
    'Projected net position = money held − money owed now + scheduled income + (optional) estimated income − scheduled bills − estimated everyday spending, from today to the end of the horizon.',
  steps: [
    'Starting point: balances of your active accounts now (money held minus money owed on cards and loans).',
    'Scheduled: pending occurrences of your recurring schedules and subscriptions due by the horizon. Recorded, skipped, and paused occurrences are not counted again; overdue bills are counted as still to pay; overdue income is not counted.',
    'Everyday spending: the median of the completed months’ expenses that were not recorded from a schedule, × days × 12 ÷ 365.25.',
    'The range uses your lowest and highest completed month instead of the median. It is the spread of your own months, not a confidence interval.',
    'Estimated income (only when you choose it): the median of completed months’ income that was not recorded from a schedule, spread the same way.',
    HISTORY,
  ],
  assumptions: [
    'Schedules are kept up to date: amounts and due dates are as you entered them.',
    'Everyday spending continues at a typical month’s pace.',
    'Income without a schedule is not assumed unless you include it.',
  ],
  limitations: [
    ...COMMON_LIMITATIONS,
    'It is a projection per currency, not a bank balance: future spending cannot be assigned to a particular account.',
    'A bill paid without recording its occurrence may be counted both in everyday spending history and as still due.',
    'Fewer than two completed months with spending (or fewer than ten expenses): only scheduled amounts are projected.',
  ],
};

export const SPENDING_FORECAST_METHODOLOGY: MethodologyDto = {
  version: INTELLIGENCE_METHODOLOGY_VERSION,
  summary:
    'Estimated month end = actual spending so far + typical month × days still to come ÷ days in the month, per top-level category.',
  steps: [
    'Actual: expenses recorded in the month so far (subcategories counted in their main category).',
    'Typical month: the median of the category’s completed history months, zero months included once recording had started.',
    'Next month has no actual spending yet, so its estimate is the typical month.',
    'Trend: rising or falling when the median of the newest three months differs from the three before by 20 % or more (needs six months).',
    'A category needs spending in at least two completed months for an estimate.',
    HISTORY,
  ],
  assumptions: [
    'Spending in the rest of the month follows a typical month, spread evenly over its days.',
  ],
  limitations: [
    ...COMMON_LIMITATIONS,
    'A single large purchase changes the median little, so it is not treated as a new habit; irregular costs (yearly fees) are underestimated in most months.',
    'Budgets are shown for comparison only and are never changed by an estimate.',
  ],
};

export const BUDGET_METHODOLOGY: MethodologyDto = {
  version: INTELLIGENCE_METHODOLOGY_VERSION,
  summary:
    'Suggested limits come from your completed months: the average month, and a conservative target at your lower-spending months. Each says how many past months stayed within it.',
  steps: [
    'Historical average: the mean monthly spending of the category, rounded up to a readable step (100 currency units from 1,000; 10 from 100; otherwise 1).',
    'Conservative target: the lower quartile (25th percentile) of monthly spending, rounded up the same way — an amount already managed in at least a quarter of those months.',
    'Repeated overspending: over the limit in at least two of the last four completed budget months.',
    'Consistently unused: less than half used in each of the last three or four completed months.',
    'Limit below typical: the limit is under the lower quartile of monthly spending.',
    'High variability: the gap between the highest and lowest month is larger than the typical month.',
    'Categories without a budget are suggested when they take at least 10 % of average monthly spending.',
    HISTORY,
  ],
  assumptions: [
    'Past months are a reasonable guide to a starting limit; you can always choose your own.',
  ],
  limitations: [
    ...COMMON_LIMITATIONS,
    'Suggestions are planning starting points, not optimal values. An unused budget may be planned for later spending.',
    'Nothing is created or changed until you save the budget form yourself.',
  ],
};

export const GOAL_METHODOLOGY: MethodologyDto = {
  version: INTELLIGENCE_METHODOLOGY_VERSION,
  summary:
    'Projected completion = today + ⌈remaining ÷ recent monthly allocations⌉ months. Required per month = ⌈remaining ÷ calendar months left to the target date⌉.',
  steps: [
    'Recent pace: net allocations (added minus withdrawn) in the completed months since the first allocation, at most six, divided by those months and rounded down.',
    'A completion date is only estimated with at least two completed months of allocations and a pace above zero.',
    'On track: the projected date is on or before the target date. Behind: it is after.',
  ],
  assumptions: [
    'Allocations continue at their recent pace; goals never receive money automatically.',
  ],
  limitations: [
    'Goal progress is a planning figure: it is not an account balance and does not move money.',
    'Without enough allocation history, only the amount needed per month is shown.',
  ],
};

export const HEALTH_METHODOLOGY: MethodologyDto = {
  version: INTELLIGENCE_METHODOLOGY_VERSION,
  summary:
    'Separate, explainable indicators — cash flow, budgets, recurring obligations, savings goals, and money held — each with its definition, period, currency, and values. There is no overall score.',
  steps: [
    'Savings rate = (income − spending) ÷ income over the last three completed months; not available without income.',
    'Scheduled bills against income = scheduled payments due in the next 30 days ÷ the median income of the last three completed months (same currency only).',
    'Money held compared with spending = cash, bank, savings, and wallet balances ÷ the median monthly spending of completed months.',
    HISTORY,
  ],
  assumptions: ['Account balances are as recorded in CalmCash.'],
  limitations: [
    ...COMMON_LIMITATIONS,
    'Investment and other account values are what you entered, not market prices; loans, property, and other assets outside CalmCash are not included, so this is not a full net worth.',
    'Money held is not called an emergency fund, because CalmCash does not know what it is set aside for.',
  ],
};

export const PATTERN_METHODOLOGY: MethodologyDto = {
  version: INTELLIGENCE_METHODOLOGY_VERSION,
  summary:
    'Actual figures from recorded income and expenses in the period, compared with the same number of days immediately before.',
  steps: [
    'Categories: subcategories are counted in their main category; archived categories still show their past spending.',
    'Merchants are grouped by the first words of the merchant (or the description when there is none); they are not verified identities.',
    'Median and quartiles are exact recorded amounts (nearest rank), never interpolated.',
    'Small payments: expenses at or below the lower quartile of the period.',
  ],
  assumptions: [],
  limitations: [...COMMON_LIMITATIONS, 'Changes show that recorded amounts differ, not why.'],
};

export const SCENARIO_POLICY =
  'Recalculated from your current records every time it runs. Only the assumptions are saved; no result is stored, so it is never out of date.';
