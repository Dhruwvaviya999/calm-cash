import type { CategoryKind } from '../constants/domain';
import type { CategoryStatus } from '../constants/transactions';
import type { EntityId, IsoDateTimeString } from './common';

/**
 * A label for income or expense transactions; also the scope of a budget. Categories form a
 * two-level tree: a top-level category (e.g. "Transport") may have subcategories ("Fuel") of the
 * same kind. Every user gets a default set and can add their own.
 */
export interface CategoryDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  kind: CategoryKind;
  /** Present on subcategories: the top-level category they belong to. */
  parentId?: EntityId;
  status: CategoryStatus;
  /** Present when `status` is `archived`. */
  archivedAt?: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** All of the user's categories (active and archived), top-level ones before their children. */
export interface CategoryListDto {
  categories: CategoryDto[];
}

// --- Requests ----------------------------------------------------------------------------------

export interface CreateCategoryInput {
  name: string;
  kind: CategoryKind;
  /** Makes the new category a subcategory of this top-level category of the same kind. */
  parentId?: EntityId;
}

/**
 * Only the name can change. The kind and position in the tree are fixed, because changing them
 * would silently move past transactions between income and spending reports.
 */
export interface UpdateCategoryInput {
  name: string;
}
