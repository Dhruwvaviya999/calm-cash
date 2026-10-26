import type { TransactionCategoryRefDto, TransactionListItemDto } from '@calmcash/shared';

// Wording for transactions that more than one component needs. Pure presentation.

/** "Food › Restaurants" for a subcategory, "Groceries" for a top-level one. */
export function categoryLabel(category: TransactionCategoryRefDto | undefined): string {
  if (category === undefined) {
    return 'Uncategorised';
  }
  return category.parentName === undefined
    ? category.name
    : `${category.parentName} › ${category.name}`;
}

/** Who the money went to or came from, as a list title. */
export function counterpartyTitle({
  transaction,
  transferAccount,
}: TransactionListItemDto): string {
  switch (transaction.type) {
    case 'transfer':
      return `To ${transferAccount?.name ?? 'another account'}`;
    case 'balance_adjustment':
      return 'Balance adjustment';
    case 'income':
    case 'expense':
      return transaction.merchant ?? transaction.description;
  }
}
