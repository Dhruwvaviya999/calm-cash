import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { AccountDto } from '../types/account';
import type { ApiErrorResponse } from '../types/api';
import type { BudgetDto } from '../types/budget';
import type { CategoryDto } from '../types/category';
import type { HealthCheckDto, ReadinessCheckDto } from '../types/health';
import type { TransactionDto } from '../types/transaction';
import type { UserDto } from '../types/user';
import type { accountDtoSchema } from './account';
import type { apiErrorResponseSchema } from './api';
import type { budgetDtoSchema } from './budget';
import type { categoryDtoSchema } from './category';
import type { healthCheckDtoSchema, readinessCheckDtoSchema } from './health';
import type { transactionDtoSchema } from './transaction';
import type { userDtoSchema } from './user';

// These assertions are verified by `tsc` (pnpm typecheck). They fail the build if a Zod schema
// and its hand-written interface drift apart — including optional-vs-required differences.
describe('schema ⇄ interface contracts', () => {
  it('infers exactly the published DTO types', () => {
    expectTypeOf<z.output<typeof userDtoSchema>>().toEqualTypeOf<UserDto>();
    expectTypeOf<z.output<typeof accountDtoSchema>>().toEqualTypeOf<AccountDto>();
    expectTypeOf<z.output<typeof categoryDtoSchema>>().toEqualTypeOf<CategoryDto>();
    expectTypeOf<z.output<typeof transactionDtoSchema>>().toEqualTypeOf<TransactionDto>();
    expectTypeOf<z.output<typeof budgetDtoSchema>>().toEqualTypeOf<BudgetDto>();
    expectTypeOf<z.output<typeof healthCheckDtoSchema>>().toEqualTypeOf<HealthCheckDto>();
    expectTypeOf<z.output<typeof readinessCheckDtoSchema>>().toEqualTypeOf<ReadinessCheckDto>();
    expectTypeOf<z.output<typeof apiErrorResponseSchema>>().toEqualTypeOf<ApiErrorResponse>();
  });
});
