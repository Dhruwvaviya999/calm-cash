import {
  ACCOUNT_COLORS,
  accountNameSchema,
  accountRuleViolations,
  calendarDateInTimeZone,
  CREATABLE_ACCOUNT_TYPES,
  createAccountInputSchema,
  CURRENCY_CODES,
  describeDecimalAmountError,
  formatDecimalAmount,
  getAccountClassification,
  parseDecimalAmount,
  parseMinorUnits,
  requiresNonNegativeBalance,
  serializeMinorUnits,
  supportsCreditLimit,
  updateAccountInputSchema,
  type AccountColor,
  type AccountDto,
  type AccountType,
  type CreatableAccountType,
  type CreateAccountInput,
  type CurrencyCode,
  type UpdateAccountInput,
} from '@calmcash/shared';

import type { FieldErrors } from '@/lib/form-errors';

// The account form works with text the person typed; this module converts it to the API's exact
// minor-unit contracts (and back), with the same rules the API enforces. No React here.

export const ACCOUNT_FORM_FIELDS = [
  'name',
  'type',
  'currency',
  'openingBalance',
  'openingBalanceDate',
  'institution',
  'creditLimit',
  'color',
] as const;

export type AccountFormField = (typeof ACCOUNT_FORM_FIELDS)[number];
export type AccountFormValues = Record<AccountFormField, string>;
export type AccountFormErrors = FieldErrors<AccountFormField>;

export type AccountFormResult<TInput> =
  { ok: true; input: TInput } | { ok: false; errors: AccountFormErrors };

/** How the form describes the balance and the optional fields for each type. */
export interface AccountTypeFormCopy {
  balanceLabel: string;
  balanceHint: string;
  /** Liabilities are entered as the positive amount owed. */
  enterAsAmountOwed: boolean;
  allowNegative: boolean;
  /** `undefined` hides the institution field. */
  institutionLabel: string | undefined;
  showCreditLimit: boolean;
}

export function getAccountTypeFormCopy(type: AccountType): AccountTypeFormCopy {
  const liability = getAccountClassification(type) === 'liability';
  const base: AccountTypeFormCopy = {
    balanceLabel: 'Current balance',
    balanceHint: 'What the account holds today. Enter 0 if it is empty.',
    enterAsAmountOwed: liability,
    allowNegative: !liability && !requiresNonNegativeBalance(type),
    institutionLabel: 'Bank or provider (optional)',
    showCreditLimit: supportsCreditLimit(type),
  };
  switch (type) {
    case 'cash':
      return {
        ...base,
        balanceLabel: 'Cash on hand',
        balanceHint: 'How much cash you have right now.',
        institutionLabel: undefined,
      };
    case 'bank':
      return {
        ...base,
        institutionLabel: 'Bank (optional)',
        balanceHint: 'Today’s balance. Use a minus sign for an overdraft, e.g. -2500.',
      };
    case 'savings':
      return { ...base, institutionLabel: 'Bank (optional)' };
    case 'digital_wallet':
      return { ...base, institutionLabel: 'Wallet provider (optional)' };
    case 'credit_card':
    case 'loan':
      return {
        ...base,
        balanceLabel: 'Amount you owe now',
        balanceHint:
          'The outstanding balance on your latest statement or app. Enter 0 if nothing is owed.',
        institutionLabel: 'Card issuer (optional)',
      };
    case 'investment':
    case 'other':
      return { ...base, balanceHint: 'Today’s balance. Use a minus sign if it is negative.' };
  }
}

export function isCreatableAccountType(value: string): value is CreatableAccountType {
  return CREATABLE_ACCOUNT_TYPES.some((type) => type === value);
}

function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_CODES.some((code) => code === value);
}

function isAccountColor(value: string): value is AccountColor {
  return ACCOUNT_COLORS.some((color) => color === value);
}

export function emptyAccountFormValues(
  currency: CurrencyCode,
  timeZone: string,
): AccountFormValues {
  return {
    name: '',
    type: '',
    currency,
    openingBalance: '',
    openingBalanceDate: calendarDateInTimeZone(new Date(), timeZone),
    institution: '',
    creditLimit: '',
    color: '',
  };
}

/** Form values that show an existing account exactly as stored. */
export function accountToFormValues(account: AccountDto): AccountFormValues {
  const opening = parseMinorUnits(account.openingBalanceMinor);
  const copy = getAccountTypeFormCopy(account.type);
  return {
    name: account.name,
    type: account.type,
    currency: account.currency,
    openingBalance: formatDecimalAmount(
      copy.enterAsAmountOwed ? -opening : opening,
      account.currency,
    ),
    openingBalanceDate: account.openingBalanceDate,
    institution: account.institution ?? '',
    creditLimit:
      account.creditLimitMinor === undefined
        ? ''
        : formatDecimalAmount(parseMinorUnits(account.creditLimitMinor), account.currency),
    color: account.color ?? '',
  };
}

/** API field paths (`body.openingBalanceMinor`) and schema paths mapped onto form fields. */
export function formFieldForPath(path: string): AccountFormField | undefined {
  const key = path.replace(/^body\./, '');
  switch (key) {
    case 'openingBalanceMinor':
      return 'openingBalance';
    case 'creditLimitMinor':
      return 'creditLimit';
    default:
      return ACCOUNT_FORM_FIELDS.find((field) => field === key);
  }
}

export function formErrorsFromPaths(
  issues: readonly { path: string; message: string }[],
): AccountFormErrors {
  const errors: AccountFormErrors = {};
  for (const issue of issues) {
    const field = formFieldForPath(issue.path);
    if (field !== undefined && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

interface ParsedAmounts {
  openingBalanceMinor: string;
  creditLimitMinor: string | undefined;
}

/** Type, currency, and amounts from the text fields, or the first problem per field. */
function parseCommon(values: AccountFormValues):
  | { ok: true; type: CreatableAccountType; currency: CurrencyCode; amounts: ParsedAmounts }
  | {
      ok: false;
      errors: AccountFormErrors;
    } {
  const errors: AccountFormErrors = {};
  const type = isCreatableAccountType(values.type) ? values.type : undefined;
  const currency = isCurrencyCode(values.currency) ? values.currency : undefined;
  if (type === undefined) {
    errors.type = 'Choose an account type.';
  }
  if (currency === undefined) {
    errors.currency = 'Choose a currency.';
  }
  if (type === undefined || currency === undefined) {
    return { ok: false, errors };
  }

  const copy = getAccountTypeFormCopy(type);
  let openingBalanceMinor = '0';
  const opening = parseDecimalAmount(values.openingBalance, currency, {
    allowNegative: copy.allowNegative,
  });
  if (opening.ok) {
    openingBalanceMinor = serializeMinorUnits(
      copy.enterAsAmountOwed ? -opening.minorUnits : opening.minorUnits,
    );
  } else {
    errors.openingBalance =
      opening.error === 'negative' && !copy.enterAsAmountOwed
        ? 'This type of account cannot have a negative balance.'
        : describeDecimalAmountError(opening.error, currency);
  }

  let creditLimitMinor: string | undefined;
  if (copy.showCreditLimit && values.creditLimit.trim() !== '') {
    const limit = parseDecimalAmount(values.creditLimit, currency);
    if (!limit.ok) {
      errors.creditLimit = describeDecimalAmountError(limit.error, currency);
    } else if (limit.minorUnits === 0n) {
      errors.creditLimit = 'Enter a credit limit above zero, or leave it empty.';
    } else {
      creditLimitMinor = serializeMinorUnits(limit.minorUnits);
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, type, currency, amounts: { openingBalanceMinor, creditLimitMinor } };
}

/** Adds the name problem (if any) to errors found elsewhere, so every issue shows at once. */
function withNameError(values: AccountFormValues, errors: AccountFormErrors): AccountFormErrors {
  const name = accountNameSchema.safeParse(values.name);
  return name.success ? errors : { name: name.error.issues[0]?.message, ...errors };
}

/** Builds the create request, validated with the same shared schema as the API. */
export function buildCreateAccountInput(
  values: AccountFormValues,
): AccountFormResult<CreateAccountInput> {
  const common = parseCommon(values);
  if (!common.ok) {
    return { ok: false, errors: withNameError(values, common.errors) };
  }
  const copy = getAccountTypeFormCopy(common.type);
  const institution = values.institution.trim();
  const candidate = {
    name: values.name,
    type: common.type,
    currency: common.currency,
    openingBalanceMinor: common.amounts.openingBalanceMinor,
    openingBalanceDate: values.openingBalanceDate,
    ...(copy.institutionLabel === undefined || institution === '' ? {} : { institution }),
    ...(common.amounts.creditLimitMinor === undefined
      ? {}
      : { creditLimitMinor: common.amounts.creditLimitMinor }),
    ...(isAccountColor(values.color) ? { color: values.color } : {}),
  };
  const parsed = createAccountInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      errors: formErrorsFromPaths(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      ),
    };
  }
  return { ok: true, input: parsed.data };
}

/**
 * Builds a minimal update with only the fields that changed (`null` clears optional fields).
 * `input` is `undefined` when nothing changed.
 */
export function buildUpdateAccountInput(
  account: AccountDto,
  values: AccountFormValues,
): AccountFormResult<UpdateAccountInput | undefined> {
  const common = parseCommon(values);
  if (!common.ok) {
    return { ok: false, errors: withNameError(values, common.errors) };
  }
  const copy = getAccountTypeFormCopy(common.type);
  const changes: UpdateAccountInput = {};

  const name = values.name.trim();
  if (name !== account.name) changes.name = values.name;
  if (common.type !== account.type) changes.type = common.type;
  if (common.currency !== account.currency) changes.currency = common.currency;
  if (common.amounts.openingBalanceMinor !== account.openingBalanceMinor) {
    changes.openingBalanceMinor = common.amounts.openingBalanceMinor;
  }
  if (values.openingBalanceDate !== account.openingBalanceDate) {
    changes.openingBalanceDate = values.openingBalanceDate;
  }
  const institution = copy.institutionLabel === undefined ? '' : values.institution.trim();
  if (institution !== (account.institution ?? '')) {
    changes.institution = institution === '' ? null : institution;
  }
  const creditLimit = common.amounts.creditLimitMinor;
  if (creditLimit !== account.creditLimitMinor) {
    changes.creditLimitMinor = creditLimit ?? null;
  }
  const color = isAccountColor(values.color) ? values.color : undefined;
  if (color !== account.color) {
    changes.color = color ?? null;
  }

  if (Object.keys(changes).length === 0) {
    return { ok: true, input: undefined };
  }

  const issues = [
    ...accountRuleViolations({
      type: common.type,
      openingBalanceMinor: common.amounts.openingBalanceMinor,
      creditLimitMinor: creditLimit,
    }),
  ];
  const parsed = updateAccountInputSchema.safeParse(changes);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
  if (issues.length > 0 || !parsed.success) {
    return { ok: false, errors: formErrorsFromPaths([...issues, ...schemaIssues]) };
  }
  return { ok: true, input: parsed.data };
}

/** Types an existing account may switch to: the same classification only (API rule). */
export function editableAccountTypes(current: AccountType): CreatableAccountType[] {
  const classification = getAccountClassification(current);
  return CREATABLE_ACCOUNT_TYPES.filter(
    (type) => getAccountClassification(type) === classification,
  );
}
