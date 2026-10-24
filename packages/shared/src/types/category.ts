import type { CategoryKind } from '../constants/domain';
import type { EntityId, IsoDateTimeString } from './common';

/** A user-defined label for income or expense transactions; also the scope of a budget. */
export interface CategoryDto {
  id: EntityId;
  userId: EntityId;
  name: string;
  kind: CategoryKind;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
