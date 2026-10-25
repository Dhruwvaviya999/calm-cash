// @ts-check
// Single flat config for the whole monorepo. Packages run `eslint .` from their own directory
// and ESLint resolves this file by walking up from the working directory.
import { createRequire } from 'node:module';
import { join } from 'node:path';

import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const WEB_FILES = ['apps/web/**/*.{ts,tsx}'];

// Resolve React from the web app so eslint-plugin-react does not need to "detect" it from the
// repository root, where React is intentionally not installed.
const requireFromWeb = createRequire(join(import.meta.dirname, 'apps/web/package.json'));
/** @type {{ version: string }} */
const reactPackage = requireFromWeb('react/package.json');

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/out/',
    '**/build/',
    '**/coverage/',
    '**/next-env.d.ts',
    'apps/api/src/generated/',
    'prisma/migrations/',
  ]),

  js.configs.recommended,

  // Next.js (React, hooks, a11y, Core Web Vitals) rules apply to the web app only.
  ...nextCoreWebVitals.map((config) => ({ ...config, files: WEB_FILES })),
  {
    files: WEB_FILES,
    settings: {
      react: { version: reactPackage.version },
      // Absolute, so the rule works no matter which directory ESLint is started from.
      next: { rootDir: join(import.meta.dirname, 'apps/web') },
    },
  },

  // Strict, type-aware rules for every TypeScript file in the workspace.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          minimumDescriptionLength: 10,
        },
      ],
      // Type assertions bypass the checker; narrow `unknown` values with guards or Zod instead.
      // (`as const` is always allowed.)
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // Prototype fixtures may only feed preview UI (routes and features), never infrastructure or
  // the reusable design system.
  {
    files: ['apps/web/src/{components,hooks,lib,services,types}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/fixtures', '@/fixtures/*', '**/fixtures/*'],
              message:
                'Sample fixtures are prototype-only and must not reach shared code or services.',
            },
          ],
        },
      ],
    },
  },

  // General hygiene for all files.
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);
