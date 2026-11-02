import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'backend/drizzle/**',
      'skills/**',
      'docs/**',
    ],
  },
  // Backend and E2E (TypeScript, non type-aware)
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['backend/**/*.ts', 'e2e/**/*.ts'],
  })),
  {
    files: ['backend/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Names prefixed with an underscore are intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Frontend (plain browser JS)
  {
    files: ['frontend/src/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  // Root config files
  {
    files: ['*.js'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  prettier,
];
