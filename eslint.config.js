import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The type checker already enforces the strictest options TypeScript offers, so
 * linting is scoped to the defects `tsc` cannot see: unawaited promises,
 * misused async values and unreachable or unused code paths.
 *
 * The `lint` script passes the same roots `tsconfig.json` includes rather than
 * linting the whole working tree. ESLint does not read `.git/info/exclude`, so
 * `eslint .` also reports on a contributor's local scratch directories and
 * fails their build over files the repository does not own.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.graph-workbench/**',
      'test-results/**',
      'registry-dist/**',
      'apps/workbench/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': ['error', {
        selector: 'TSNonNullExpression > TSAsExpression',
        message: 'Do not combine a cast with a non-null assertion; narrow the type instead.',
      }],
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
