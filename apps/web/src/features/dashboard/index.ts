// Public surface of the dashboard feature. Sections receive typed data as props, so they work
// unchanged when the API provides real figures.
export { BalanceOverview } from './components/balance-overview';
export { BudgetOverview } from './components/budget-overview';
export { RecentTransactions } from './components/recent-transactions';
export { SpendingOverview } from './components/spending-overview';
export { SummaryStats } from './components/summary-stats';
export type { AccountBalance, CategoryAmount, MonthlyAmount, MonthSummary } from './types';
