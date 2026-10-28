# CalmCash UI architecture

How the web app (`apps/web`) is designed and built: the visual identity, design tokens, the
responsive application shell, the component system, and the rules that let later phases replace
prototype screens without rewriting the shell. Established in Phase 2; Phase 3 added the
authentication pages, route protection, and real account settings; Phase 4 made Accounts live;
Phase 5 made Transactions live (§7b); Phase 6 the dashboard (§7c); Phase 7 Budgets & planning
(§7d); Phase 8 statement imports and receipts (§7e).

## 1. Design principles

CalmCash should feel calm, trustworthy, and clear: a carefully designed product, not an admin
template.

- **Clarity over decoration.** Neutral warm surfaces, subtle borders, soft elevation, generous
  spacing. No gradients, glass effects, or ornamental illustrations.
- **Numbers first.** Money uses tabular figures, exact formatting (never floating point), and a
  consistent sign convention: `+` credit, `−` debit, no sign for transfers.
- **Never colour alone.** Every financial or status colour is paired with a sign, icon, or label.
- **Mobile is a first-class app.** Phones get an Android-style bottom bar and bottom sheets, not a
  shrunken desktop sidebar.
- **Honest UI.** Nothing implies a feature works before it does: unavailable actions are absent or
  clearly marked "Coming soon", and sample data is always labelled.
- **Restrained motion.** Short transitions (≤200ms) for state changes only, all disabled under
  `prefers-reduced-motion`.

## 2. Visual identity

- **Wordmark** (`components/brand/wordmark.tsx`): an emerald rounded tile with the Lucide `Sprout`
  icon (steady growth) beside "Calm**Cash**", with "Cash" in the primary colour. `variant="mark"`
  renders the tile alone with an accessible name. No image assets; the favicon
  (`app/icon.svg`) reuses the same mark.
- **Typography:** Geist Sans from the `geist` npm package, loaded with `next/font/local`, so builds
  never fetch fonts from the network. Default Tailwind type scale plus `text-2xs` (11px) for
  navigation labels.
- **Colour:** a warm paper light theme (primary) and a deep charcoal/slate dark theme, an emerald
  (light) / mint (dark) primary, and a restrained coral for debits and destructive actions.

## 3. Design tokens

All tokens live in [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css), following
the shadcn/ui conventions: raw values on `:root` (light) and `.dark`, mapped to Tailwind
utilities in `@theme inline`. Components use semantic utilities only (`bg-card`,
`text-muted-foreground`, `text-income`, …), never raw colours.

| Group               | Tokens                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Surfaces            | `background`, `foreground`, `card`, `popover`, `muted`, `muted-foreground`                                                |
| Actions             | `primary`, `secondary`, `accent`, `destructive` (+ `-foreground` pairs)                                                   |
| Status              | `success`, `warning`, `warning-text`                                                                                      |
| Money               | `income` (credit), `expense` (debit), `transfer`                                                                          |
| Lines and focus     | `border`, `input`, `ring`                                                                                                 |
| Charts              | `chart-1` … `chart-5` (account accents), `chart-income`, `chart-expense` (cash-flow series, Phase 6)                      |
| Navigation          | `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-accent`, `sidebar-border`, `sidebar-ring`                    |
| Shape and elevation | `--radius` (12px; derived `radius-sm` … `radius-2xl`), `--elevation-1…3` → `shadow-xs…lg`                                 |
| Shell geometry      | `--sidebar-width` (16rem), `--sidebar-width-collapsed` (4.5rem), `--app-header-height`, `--bottom-nav-height`, `--gutter` |

**Contrast.** Every text/background pair was checked against WCAG 2.x AA (4.5:1 for text, 3:1 for
the focus ring) in both themes: body text is about 16:1, muted text at least 5.3:1, and the
income, debit, transfer, and warning colours at least 5.2:1 on cards. Re-check any new pair the
same way before adding it.

**Chart series.** `chart-income` and `chart-expense` are separate from the text tokens: bars need
3:1 against the card, not 4.5:1, and the pair must stay apart for colour-blind readers. They differ
in lightness as well as hue (light theme: deep green vs. light coral; dark theme: bright green vs.
deep coral). Checked with the dataviz palette validator against the card surface: colour-vision
separation ΔE 10.5 (light, protanopia worst case) and 12.8 (dark, deuteranopia), normal-vision ΔE
≥ 29, contrast ≥ 3:1, all checks passing. Chart text (values, axis labels, legends) uses text
tokens, never the series colour.

**Utilities defined in CSS:**

| Utility / variant    | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `dark:`              | Applies under `.dark` on `<html>`.                                           |
| `sidebar-collapsed:` | Applies while `<html data-sidebar="collapsed">` (desktop sidebar collapsed). |
| `pt-safe`, `pb-safe` | Safe-area insets for notches and gesture bars.                               |
| `px-gutter`          | Responsive page gutter (16 / 24 / 32px) that also clears landscape cutouts.  |

## 4. Theme and display preferences

Theme (`light` · `dark` · `system`) and the desktop sidebar state are stored in `localStorage`
and mirrored on `<html>` ([`lib/preferences.ts`](../apps/web/src/lib/preferences.ts)):

1. `PreferencesScript` (rendered in the root layout's `<head>`) runs **before first paint** and
   applies `.dark` and `data-sidebar="collapsed"`, so statically prerendered pages never flash.
   `<html suppressHydrationWarning>` lets React accept those attributes.
2. Client components read preferences through `useThemePreference()` / `useSidebarState()`
   (`useSyncExternalStore` with a default server snapshot, so there is no hydration mismatch).
3. `PreferencesSync` follows OS light/dark changes and changes made in other tabs.

This follows the Next.js 16 guide "Preventing flash before hydration". `next-themes` is not used:
it renders its script from a Client Component, which React 19 warns about, while the custom store is
small, dependency-free, and its bootstrap script is unit-tested.

## 5. Application shell

Every in-app route lives in the `(app)` route group, whose layout renders
[`AppShell`](../apps/web/src/components/layout/app-shell.tsx) with the signed-in user's `UserMenu`
in its `accountMenu` slot, and wraps page content in `RequireAuth`. The shell is a Server Component.
Only the parts that need the current route or user input are Client Components. Navigation renders
immediately; page content appears once the session is confirmed (a skeleton until then, see
[authentication.md](./authentication.md#7-web-app)).

The public authentication pages live in the `(auth)` route group with
[`AuthShell`](../apps/web/src/components/layout/auth-shell.tsx): the wordmark, the theme control, and
one centred column (`max-w-md`) holding a single `AuthCard`.

| Width      | Navigation                                                           | Header                                    |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------- |
| < 768px    | Fixed bottom bar: Home · Transactions · Budgets · Accounts · More    | Compact bar with the wordmark             |
| 768–1023px | Icon-only navigation rail with tooltips                              | Breadcrumb (group › page), theme, account |
| ≥ 1024px   | Full sidebar with grouped links, collapsible to the rail (persisted) | Breadcrumb, theme, account                |

- **Bottom bar** (`MobileBottomNav`): every cell is the full 64px bar height (touch targets well
  above 48×48px); the active destination gets a Material-style pill; the bar pads for the gesture
  area with `pb-safe`. Below 360px the labels shrink slightly so "Transactions" never truncates.
- **More** (`MobileMoreMenu`): a bottom sheet (Radix Dialog) with secondary destinations from the
  navigation config and non-interactive "Coming later" items. Escape, the close button, the
  overlay, or choosing a destination closes it.
- **Sidebar** (`DesktopSidebar`): groups _Overview_ (Dashboard, Insights) and _Manage_
  (Transactions, Budgets, Accounts), with Settings and the collapse control pinned at the bottom.
  The active item has a tinted background, a left indicator, and `aria-current="page"`. When
  labels are hidden (rail or collapsed), they stay available to screen readers and appear as
  tooltips on hover or focus.
- **Navigation config** ([`lib/navigation.ts`](../apps/web/src/lib/navigation.ts)) is the single
  source of truth. Sidebar, bottom bar, More sheet, and breadcrumb all read it, and `href`s are
  typed `Route`s, so a broken link fails the build.
- **Page frame:** `PageContainer` (max width 80rem, responsive gutters and rhythm) and
  `PageHeader` (the page's only `<h1>`, description, optional eyebrow and actions).
- **Resilience:** `(app)/loading.tsx` and `(app)/error.tsx` render inside the shell, so a failing
  page never takes navigation down. The shell makes no API calls; the Phase 1 system-status
  check lives in Settings → About and diagnostics and fails gracefully.
- **Skip link:** the first focusable element jumps to `<main id="main-content">`.

## 6. Component system

Accessible primitives come from **shadcn/ui** (new-york style, Radix UI, `components.json`).
They are owned source files in `components/ui/` and were adapted to the project's lint rules
(explicit return types, `import type`, local `cn`). CalmCash components build on them:

| Area     | Component                                                                                                                                                                                | Responsibility                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ui       | `button`, `badge`, `card`, `input`, `skeleton`, `separator`, `avatar`, `tooltip`, `dropdown-menu`, `sheet`, `alert-dialog`, `native-select`                                              | Primitives (shadcn/ui; `native-select` is a styled native `<select>`).                                               |
| brand    | `Wordmark`                                                                                                                                                                               | Logo treatment.                                                                                                      |
| layout   | `AppShell`, `AuthShell`, `DesktopSidebar`, `MobileBottomNav`, `MobileMoreMenu`, `AppHeader`, `HeaderContext`, `PageContainer`, `PageHeader`, `SectionHeader`, `SectionLink`, `PageShell` | Shell, navigation, page structure.                                                                                   |
| theme    | `ThemeToggle`, `PreferencesScript`, `PreferencesSync`                                                                                                                                    | Theme menu and preference plumbing.                                                                                  |
| feedback | `StatusBadge`, `EmptyState`, `PlannedCapabilities`, `ErrorState`, `PageSkeleton`, `ListSkeleton`, `ConfirmDialog`, `PreviewNotice`                                                       | States and messaging.                                                                                                |
| finance  | `FinancialAmount`, `StatCard`, `ProgressMeter`, `CategoryIcon`                                                                                                                           | Money display patterns.                                                                                              |
| forms    | `SearchInput`, `FilterBar`, `FilterOptions`, `FormField`, `PasswordInput`, `MoneyInput`, `FormMessage`                                                                                   | Search, filters, labelled fields with hints and errors, show/hide passwords, exact money entry, form-level feedback. |
| charts   | `CHART_COLORS`, `AXIS_TICK`, `ChartTooltipCard`, `ChartTooltipRow`, `ChartLegendItem`, `ChartEmptyState`, `ChartSkeleton`, `ChartTableDisclosure`                                        | Recharts building blocks: token colours, tooltip, legend, empty and loading states, "Show as table".                 |

Feature modules (`features/<feature>/`, public API in `index.ts`):

| Feature         | Contents                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactions`  | `TransactionsPage` (live page), `TransactionRow`, `TransactionList`, `TransactionHistory` (table + phone rows), forms (`TransactionForm`, `ReconcileForm`), sheets (entry, details, filters, bulk, categories), `transaction-form-model.ts`, `transaction-filters.ts` (URL ⇄ filters) |
| `budgets`       | `BudgetsOverview` (live section), `BudgetProgress`, `BudgetTotals`, `BudgetStatusCounts`, `BudgetForm`, `BudgetDetailsSheet`; `budget-form-model.ts`, `budget-presentation.ts` (statuses, drill-down links)                                                                           |
| `recurring`     | `RecurringOverview` (coming up, calendar, schedules), `OccurrenceList`/`OccurrenceRow`, `BillCalendar`, `ScheduleForm` (also subscriptions), `RecordOccurrenceForm`, `PostponeForm`, `ScheduleDetailsSheet`; `useOccurrenceActions`, `usePlanningReferences`                          |
| `subscriptions` | `SubscriptionsOverview` (estimates, cancel, record a charge through the recurring actions)                                                                                                                                                                                            |
| `goals`         | `GoalsOverview`, `GoalProgress`, goal form and details with contributions                                                                                                                                                                                                             |
| `planning`      | `PlanningPage`: the `/budgets` hub with `SectionTabs` (`?section=`)                                                                                                                                                                                                                   |
| `accounts`      | `AccountsOverview` (live page), `AccountCard`, `AccountBalance`, `AccountsSummary`, `AccountForm`/`AccountFormSheet`, `AccountDetailsSheet`; `account-form-model.ts` (text ⇄ exact minor units)                                                                                       |
| `dashboard`     | `DashboardPage` (live page), `DashboardControls`, sections (`FinancialPosition`, `PeriodSummary`, `RecentActivity`), `CashFlowChart`, `SpendingChart`; `dashboard-selection.ts` (URL ⇄ period and currency)                                                                           |
| `auth`          | `AuthProvider`/`useAuth` (session lifecycle), `RequireAuth`, `GuestOnly`, `LoginForm`, `RegisterForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `VerifyEmailPanel`, `UserMenu`, `PasswordRequirements`                                                                              |
| `settings`      | `ProfileSettings`, `ChangePasswordForm`, `ActiveSessions`, `AppearanceSettings`, `ResetDisplayPreferences`                                                                                                                                                                            |
| `system-status` | `SystemStatusCard` (Phase 1 diagnostics, restyled)                                                                                                                                                                                                                                    |

**Transaction pattern.** `TransactionRow` answers _who_ (merchant, "To {account}" for transfers,
or "Balance adjustment"), _why_ (description or reason), _when_ (date in the user's time zone),
_how_ (category and payment account), and _how much_ (`FinancialAmount`), with the same structure
on every screen size. It takes the API's `TransactionListItemDto` (full `AccountDto`/`CategoryDto`
objects fit too). Voided rows are dimmed, struck through, and badged.

**Money.** `FinancialAmount` formats with `lib/format.ts`, which converts minor units to an exact
decimal string (BigInt arithmetic) and formats with `Intl.NumberFormat('en-IN')`. `display` size
renders the fraction smaller via `formatToParts`. Directions: `credit` (+, income colour),
`debit` (−, coral), `transfer` (no sign), `adjustment-up`/`adjustment-down` (+/−, neutral colour,
because a correction is neither income nor spending), `balance` (signed). Each also has a
screen-reader label; `directionForTransaction` picks one for any transaction.

**Server first.** Pages and most components are Server Components. Client Components are limited
to the theme toggle, preference sync, sidebar, bottom bar, More sheet, header breadcrumb, user menu,
confirm dialog, settings controls, the live dashboard, accounts, and transactions features, the
system-status card, and the authentication feature (provider, guards, forms), which need the browser
to reach the API with the session cookie. The dashboard and transactions pages read their state from
the URL with `useSearchParams`, so their routes wrap them in a `Suspense` boundary (the static shell
still prerenders).

## 7. Routes

| Route              | Content in Phase 2                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                | Temporary (307) redirect to `/dashboard` (which sends signed-out visitors to `/login`).                                                                                       |
| `/dashboard`       | **Live data** (§7c). Position, period summary, cash-flow trend, spending by category, recent activity; `?period=`, `?from=&to=`, `?currency=` in the URL.                     |
| `/transactions`    | **Live data** (§7b). Record, search, filter, edit, void, restore, bulk-edit, and reconcile; filters in the URL; `?reconcile=<id>`, `?new=1`, `?transaction=<id>` open sheets. |
| `/imports`         | **Live data** (§7e). Upload a CSV statement, import history; `?batch=<id>&step=map\|review\|reconcile` resumes one import.                                                    |
| `/budgets`         | **Live data** (§7d). Budgets & planning: `?section=budgets` (default), `recurring`, `subscriptions`, `goals`.                                                                 |
| `/accounts`        | **Live data.** Totals per currency (held vs. owed), accounts grouped by classification, active/archived filter, add/edit sheet, details sheet, archive and restore.           |
| `/insights`        | Upcoming-feature state and what to expect (no generated insights).                                                                                                            |
| `/settings`        | Profile (name, currency, time zone), password change, signed-in devices, theme, preference reset, diagnostics.                                                                |
| `/login`           | Sign in; notices after sign-out or an ended session; resend link for unconfirmed addresses.                                                                                   |
| `/register`        | Create an account with live password guidance; ends on a "check your inbox" confirmation.                                                                                     |
| `/forgot-password` | Request a reset link; the confirmation never reveals whether an account exists.                                                                                               |
| `/reset-password`  | Choose a new password from an e-mailed link; handles incomplete, expired, and used links.                                                                                     |
| `/verify-email`    | Consumes the confirmation link; offers a new link when it cannot be used.                                                                                                     |
| unknown URLs       | Branded 404 (HTTP 404).                                                                                                                                                       |

All routes are statically prerendered. Every route in the `(app)` group requires a signed-in user;
the `(auth)` pages are public, and `/login` and `/register` send signed-in users on to the app.

## 7a. Accounts page (Phase 4)

- **Live only.** Everything comes from `services/accounts.service.ts`; there is no fallback to
  fixtures, and nothing is stored in the browser. Loading shows a skeleton, failures an
  `ErrorState` with retry, and a new user a first-account `EmptyState`.
- **Held vs. owed.** Cards show "Balance" (or "Overdrawn") for assets and "Amount owed" (or "In
  credit") for credit cards, plus available credit when a limit exists. Totals show "Money held"
  and "Amount owed" per currency and never add them up. All figures are calculated by the API.
- **Adaptive form.** The type comes first and decides the rest: cash has no provider, cards ask
  for the amount owed and an optional limit, bank accounts accept a minus sign for overdrafts.
  Amounts are typed in major units in a `MoneyInput` and parsed exactly; extra decimal places are
  reported, never rounded. Once an account has transactions, currency, opening balance, and date
  are disabled with an explanation. Editing offers only types of the same classification.
- **Interactions.** The form and details open in side sheets (full width on phones); archiving asks
  for confirmation in the existing `ConfirmDialog` (a bottom sheet on phones), now also usable in
  controlled mode from a menu. After any change the list refreshes in the background
  (`useAsyncResource().refresh`) without flashing a skeleton, and a status message confirms it.
- Account accents (`color`) map onto the chart tokens, so both themes keep their checked contrast.
- Phase 6: the dashboard's "Where you stand" shows the same per-currency summary.
- Phase 5: account details show how many transactions the balance includes and link to
  **View transactions** (`/transactions?accountId=…`) and **Correct balance**
  (`/transactions?reconcile=…`).

## 7b. Transactions page (Phase 5)

- **Live only.** Data comes from `services/transactions.service.ts`, `categories.service.ts`, and
  `accounts.service.ts`; nothing is stored in the browser and no sample row is ever shown. States
  are distinct: loading skeleton; error with retry ("Nothing has been lost"); _no accounts yet_ (link
  to Accounts); _first transaction_ (call to action); _no results_ for active filters (with "Clear
  search and filters"); _no voided transactions_.
- **History.** Wide desktops (≥1280px, `xl`) get a table (date, who and why, category, account or
  "A → B", method, amount, row menu). Narrower screens — phones, tablets, and laptops where the
  sidebar takes room — get compact `TransactionRow`s with a full-row button that opens details; no
  table is ever squeezed onto a small screen, and nothing scrolls sideways at 320px.
- **Search and filters.** A search box (applied 350ms after typing stops), a filter sheet (type,
  date presets and range, account, category incl. subcategories, payment method, tags, amount range,
  status), a sort select, and removable chips with "Clear all". Everything lives in the URL with the
  API's parameter names (`transaction-filters.ts`), so views survive refresh and can be bookmarked;
  only IDs, dates, amounts, and the typed search text appear there. Any change of filter returns to
  page 1; pagination is "Previous / Page n of m / Next".
- **Totals.** One compact card per currency — money in, money out, net — for exactly the list's
  filters (`summaryQuery` shares the list's parameters), labelled with the period, excluding
  transfers, adjustments, and voided rows. Hidden in the Voided view.
- **Entry.** "Add transaction" opens a sheet with a type picker (Expense, Income, Transfer, Adjust
  balance). Each type shows only its fields; the merchant ("Paid to" / "Received from") follows the
  amount. Transfers offer only active accounts of the source's currency, never the source itself.
  Payment method, tags (chips with suggestions from `GET /tags`), and notes sit under "More details".
  Amounts are parsed exactly in the account's currency; date and time are read in the user's time
  zone with the shared `zonedDateTimeToInstant`. Errors appear inline; problems from one type are
  cleared when switching type. The submit button is disabled while saving, and each form instance
  sends one `Idempotency-Key`, so a retry after a network failure (values kept) cannot duplicate.
- **Balance correction.** "Correct a balance" (or "Adjust balance" in the type picker, or the account
  details link) asks for the balance the bank shows — or, for cards, the amount owed — plus a reason,
  then shows the API's preview ("Amount owed goes up by ₹500.00") and records only after "Record
  adjustment". If the balance changed meanwhile, it offers "Review again".
- **Details, edit, void.** The details sheet lists every field (time in the user's zone). Edit opens
  the same form prefilled and sends only changed fields (with `null` for fields a new type no longer
  uses). Void asks for confirmation (optional reason) in a bottom sheet on phones; voided
  transactions are restored from the Voided view. Transactions on archived accounts are read-only.
- **Bulk.** "Select" adds checkboxes; a sticky toolbar offers Categorise, Add tags, Remove tags, and
  Void for the selection (all or nothing, as the API guarantees).
- **Categories.** A sheet lists categories by kind with add (optionally inside a top-level one),
  rename, archive, and restore.
- **Deep link (Phase 6).** `?transaction=<id>` loads that transaction (`getTransaction`) and opens
  its details sheet over the current list; closing the sheet removes the parameter. The dashboard's
  recent activity links here.

## 7c. Dashboard (Phase 6)

- **Live only.** Four independent requests (`services/dashboard.service.ts`: overview, trends,
  categories; plus the newest transactions from `transactions.service.ts`). Each section has its own
  skeleton, error with retry, and empty state, so one failing request never blanks the page; the
  period controls always stay usable. Responses that arrive after the selection has changed are
  ignored. There is no fallback to sample data and nothing is cached in the browser.
- **States.** _No accounts yet_ (first-use: add an account), _no transactions yet_ (record the first
  one), _nothing in this period_ (per chart, naming the currency), _no earlier period to compare
  with_, loading, and per-section errors.
- **Controls.** Period: this month, last month, last 3 months, last 6 months, this year, or a custom
  range (validated start/end dates, end not in the future). Currency: shown only when the user holds
  more than one. Both live in the URL (`dashboard-selection.ts`, `router.replace` without scrolling),
  so a view can be bookmarked and survives refresh. All dates are in the user's time zone.
- **Where you stand.** Money held and amount owed per currency from the accounts summary, never
  added together, labelled as current (not affected by the period).
- **Period summary.** Money in, money out, net cash flow, savings rate — each with its change against
  the comparable previous period, named explicitly ("vs 1 Sept – 27 Sept 2026"). Changes are neutral
  in colour (an arrow, not red/green, because more spending is not always bad). Without income the
  savings rate reads "—" with "Needs income in this period", never 0 %. Help disclosures explain net
  cash flow (not a balance) and the savings rate (cash flow only: transfers and balance corrections
  are not included; negative when spending exceeds income).
- **Money in and out** (`CashFlowChart`). Grouped bars, one pair per day, week, month, or year
  (chosen by the API), one axis, compact currency ticks, legend, tooltip (money in, money out, net),
  keyboard navigation (Recharts `accessibilityLayer`), and "Show as table". Clicking a bar opens
  Transactions filtered to that type and bucket's dates.
- **Where your money went** (`SpendingChart`). Horizontal bars in one hue (magnitude, not identity),
  ranked, with direct value labels and truncated category names; "Other" and "Uncategorised" as the
  API returns them; "Show as table" with shares. A category bar opens its expenses for the period
  (`?type=expense&categoryId=…&from=…&to=…`); "Other" and "Uncategorised" open all expenses of the
  period, because the transaction filters cannot express "not these categories".
- **Recent activity.** The six newest active transactions in every currency, as `TransactionRow`s,
  each opening its details on the Transactions page (`?transaction=<id>`).
- **Planning previews (Phase 7).** Three independent cards below the activity: _Budgets_ (current
  monthly totals, status counts, the budgets furthest through their limit), _Coming up_ (overdue and
  the next 14 days, labelled as expected and not yet recorded), and _Savings goals_ (tracked
  amounts, explicitly not the savings rate). Each loads, fails, and retries on its own and links to
  its planning section; with nothing set up it says so instead of showing figures.
- Charts render at 320px without horizontal scrolling; long category names truncate with the full
  name in the tooltip and the table.

## 7d. Budgets & planning (Phase 7)

- **One page, four sections.** `/budgets` keeps its navigation slot ("Budgets" in every nav
  surface) and hosts `PlanningPage`: a `PageHeader` and `SectionTabs` (links with
  `aria-current="page"`, one URL per section via `?section=`). Each section is its own feature with
  its own `<h2>`, actions, loading skeleton, error with retry, and empty state.
- **Budgets.** A month switcher (weekly and yearly budgets show the week or year containing the
  chosen day), a currency select only when budgets exist in several currencies, Active/Archived.
  Totals per cadence ("This month: Budgeted · Spent · Left/Over") never add nested budgets twice
  and say so. Cards show name, scope, status badge (icon + text), a meter with alert marks
  (`aria-valuetext` gives the exact, uncapped percentage), spent of limit, and "left" or "over" in
  words. "Expenses" opens Transactions filtered to exactly the budget's scope
  (`type=expense&currency=…&from=…&to=…&categoryId=…`; the category filter includes
  subcategories). Details show the latest expenses through the same query. The form asks for scope,
  category, name, limit, and period; dates, currency, alerts, and a note sit behind "Dates,
  currency, and alerts" with sensible defaults (monthly from the 1st, 80 % alert).
- **Bills & recurring.** _Coming up_: expected totals per currency (labelled as plans), overdue
  first, then the next 30 days. _Calendar_: a Monday-first month grid of day buttons (accessible
  names such as "5 October 2026, 1 payment, 1 overdue"; dots repeat the meaning in a legend) with
  the selected day's payments below. _All schedules_: cards with rhythm in words ("Every month on
  the 31st (or the month's last day)") and status. Rows show "Expected" before pending amounts and
  a status badge; "Record" opens a sheet that states it records real money, preselects the
  schedule's account (only active accounts in the schedule's currency are offered) and category, and
  lets the amount and date be corrected; the button is disabled while saving and the API returns
  the first transaction on a repeat, so a double tap cannot record twice. Skip asks for
  confirmation; skipped and paused occurrences offer "Expect it after all"; recorded ones link to
  their transaction. Row actions wrap below the text on phones.
- **Subscriptions.** Estimates per currency (next 30 days, next 12 months, overdue) with a note
  that they are estimates; cards with provider, billing rhythm, next charge, and a 12-month
  estimate; record a due charge, pause, resume, cancel (confirmation), archive, restore. The empty
  state says subscriptions are added by the person, not detected.
- **Goals.** Cards with a progress meter (uncapped percentage, "beyond the target" when exceeded),
  target date, days left, and the monthly amount needed. Details offer Add / Take out / Set total
  with a note that nothing moves between accounts, the history, and pause, complete, reopen,
  archive, restore.
- **Verified** with headless Chrome at 320, 375, 430, 768, 1024, 1280, and 1440px in both themes
  (all four sections and the dashboard): no horizontal overflow and no failed section in 71 renders.

## 7e. Statement imports and receipts (Phase 8)

- **Entry points.** "Statement imports" in the Manage group (sidebar; "More" on phones) and an
  "Import statement" button in the Transactions header. `/imports` shows the upload form (account,
  CSV file, and an optional "File layout" disclosure for the separator and header row) and the
  import history; each import opens at `/imports?batch=<id>` (`&step=map|review|reconcile`), so
  it survives refresh and can be resumed later.
- **Stepper.** Upload → Map columns → Review & import → Reconcile, as an ordered list
  (`aria-current="step"`); steps after mapping unlock once the columns are confirmed. A finished
  import shows a summary instead (outcomes, the last balance check, links to the account's
  transactions and to every row, read-only).
- **Map columns.** The first rows exactly as read (text only, in a box that scrolls sideways on
  its own; the page never does), one select per field, the date layout (no preselection when the
  dates fit several layouts, with the reason shown), "One amount column" (with a required choice of
  what a negative amount means) or "Separate columns", the decimal separator, and the optional
  statement period and balances (cards and loans are entered as the amount owed).
- **Review & import.** Counts, filters (Needs attention, Ready, Imported, Matched, Skipped, All),
  "Check duplicates again", and "Import all ready (n)", which sends bounded requests until nothing
  importable is left and then says exactly what happened (imported, already imported, needing a
  category or decision, refused with the reason per line). Phones and narrow laptops get cards;
  wide desktops (`xl`) a table with selection, "Set category" for the selected rows, and "Import
  selected". A row sheet shows what the statement says, problems and warnings, duplicate
  candidates ("It is this transaction" links instead of recording), "Not a duplicate", "Skip",
  "Include this row again"/"Undo the match", and what will be recorded (type, category or other
  account, payee, purpose, payment method, notes).
- **Reconcile.** The statement's period and balances (editable without touching the mapping),
  opening and closing checks side by side (statement, ledger at the same instant, the difference in
  words), what to look for before correcting, and "Record a correction of …" behind a confirmation
  that states the amount, date, and account. "Finish import" and "Cancel import" ask first; cancel
  says imported transactions stay.
- **Receipts.** The transaction details sheet has a Receipts section: "Attach" (JPEG, PNG, WebP,
  or PDF up to 10 MB, checked for size before upload; the API's reason is shown when it refuses a
  file), a list with name, type, size, and date, image previews fetched through the authorised API
  into a temporary object URL, "Save" for any file, and "Remove" behind a confirmation that says the
  transaction does not change. Receipts of transactions on archived accounts are read-only.
- **Verified** with headless Chrome at 320, 375, 430, 768, 1024, 1280, and 1440px in both themes
  (import history, mapping, review, reconcile, summary, and the transaction details with receipts):
  no horizontal overflow of the page or of open sheets in 88 renders, no console errors, statement
  text containing `<script>` shown as text. The review filters at phone width exposed a shared
  `FilterOptions` bug (hidden radios widened the page when the options scrolled), fixed there.

## 8. Prototype data rules

- Since Phase 7 no sample data remains: the Budgets preview was the last user of
  `src/fixtures/sample-finances.ts`, which has been deleted with its test. Every finance screen
  shows live API data only.
- The ESLint ban stays and now covers every live feature and route
  (`features/{dashboard,accounts,transactions,budgets,recurring,subscriptions,goals,planning}/**`,
  `app/*/{dashboard,accounts,transactions,budgets}/**`, and the shared layers), so sample data can
  never be reintroduced where it could pass for real figures. Any future preview must carry a
  "Design preview" badge or a `PreviewNotice`.

## 9. Accessibility checklist

- Landmarks: one `<main>`, labelled `<nav>`s (only one visible per breakpoint), `<header>`, and
  sections labelled by their headings. Each page has exactly one `<h1>`.
- Keyboard: skip link, visible focus on everything (global `:focus-visible` fallback), Radix menus
  and dialogs with arrow keys, Escape, focus trapping, and focus return; native radios for filters.
- Labels: icon-only buttons have `aria-label`s; the search field has an accessible name; the
  collapse control reports `aria-expanded`.
- Status never by colour alone (badges include icons and text; amounts include signs and
  screen-reader labels; progress bars expose `aria-valuetext`).
- Touch targets at least 40px (48px+ in the bottom bar); 16px inputs on mobile avoid iOS zoom.
- `prefers-reduced-motion` disables animations and transitions globally.
- Forms: every field has a visible `<label>`; hints and errors are linked with `aria-describedby`,
  invalid fields get `aria-invalid`; form-level errors use `role="alert"`, confirmations
  `role="status"`. Inputs and buttons in forms are 44px tall and full width on phones (usable at
  320px). Password fields use the right `autocomplete` values and a labelled show/hide button.

## 10. Adding to the UI

**A new page:** create `app/(app)/<route>/page.tsx` with `PageContainer` + `PageHeader`; add the
destination to `NAV_ITEMS` (choose `group` and `mobilePlacement`) and it appears in every
navigation surface.

**A new shadcn/ui primitive:** from `apps/web`, run `pnpm dlx shadcn@4.22.1 add <name>`. Then:

1. replace `import { cn } from "cn"` with `import { cn } from "@/lib/utils"` and remove the `cn`
   package the CLI adds (`pnpm remove cn`); the project uses the established `clsx` +
   `tailwind-merge` helper;
2. install any peer the CLI omitted (for example `class-variance-authority`);
3. run `pnpm format` and `pnpm lint`, and add explicit return types (`React.JSX.Element`) where
   lint asks for them.

Never loosen lint or TypeScript settings to accommodate generated code.

**A new colour:** add the raw value to `:root` and `.dark`, map it in `@theme inline`, check its
contrast in both themes, and document it in section 3.
