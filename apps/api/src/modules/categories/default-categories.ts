import type { CategoryKind } from '@calmcash/shared';

export interface DefaultCategory {
  name: string;
  kind: CategoryKind;
  children?: readonly string[];
}

/**
 * Categories every user starts with, provisioned once per user on first use. Names are unique per
 * kind across the whole tree (a database constraint), so subcategories use specific names rather
 * than repeating "Other".
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { kind: 'expense', name: 'Food', children: ['Restaurants', 'Food delivery', 'Cafes & snacks'] },
  { kind: 'expense', name: 'Groceries' },
  {
    kind: 'expense',
    name: 'Transport',
    children: ['Fuel', 'Public transport', 'Taxi & rides', 'Parking & tolls'],
  },
  { kind: 'expense', name: 'Shopping', children: ['Clothing', 'Electronics', 'Household items'] },
  { kind: 'expense', name: 'Housing', children: ['Rent', 'Maintenance & repairs'] },
  {
    kind: 'expense',
    name: 'Utilities',
    children: ['Electricity', 'Water', 'Mobile & internet', 'Cooking gas'],
  },
  {
    kind: 'expense',
    name: 'Health',
    children: ['Medicines', 'Doctor & tests', 'Health insurance'],
  },
  { kind: 'expense', name: 'Entertainment', children: ['Movies & events', 'Hobbies'] },
  { kind: 'expense', name: 'Education', children: ['Courses & fees', 'Books & supplies'] },
  { kind: 'expense', name: 'Subscriptions', children: ['Streaming', 'Software & apps'] },
  { kind: 'expense', name: 'Travel', children: ['Flights', 'Trains & buses', 'Hotels'] },
  { kind: 'expense', name: 'Other' },
  { kind: 'income', name: 'Salary' },
  { kind: 'income', name: 'Freelance' },
  { kind: 'income', name: 'Business' },
  { kind: 'income', name: 'Interest' },
  { kind: 'income', name: 'Refunds' },
  { kind: 'income', name: 'Other' },
];
