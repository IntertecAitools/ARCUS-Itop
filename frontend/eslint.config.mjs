import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** Shared layers: may only import other shared layers. */
const SHARED = ['components', 'lib', 'hooks', 'stores', 'types', 'config', 'theme'].map((d) => `./src/${d}`);
const SHELL = ['./src/app', './src/App.tsx', './src/main.tsx'];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/mockServiceWorker.js',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Rule 1: app → features → shared. Never import upward.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: SHARED,
              from: ['./src/features', './src/mocks', ...SHELL],
              message: 'Shared code must not import features, mocks or the app shell.',
            },
            {
              target: './src/features',
              from: ['./src/mocks', ...SHELL],
              message: 'Features must not import the app shell or mocks.',
            },
          ],
        },
      ],
      // Rule 2: features are imported only through their index.ts.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/*/*'], message: 'Import a feature only through its index.ts (@/features/<name>).' },
          ],
        },
      ],
      // Rule 3: all API calls go through lib/api-client.
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use lib/api-client instead of fetch.' }],
      // Rule 5: no hardcoded colours.
      'no-restricted-syntax': [
        'error',
        {
          // a string that is only a hex colour, e.g. '#2563eb'
          selector: 'Literal[value=/^#[0-9a-fA-F]+$/]',
          message: 'No hardcoded colours. Use theme tokens (Tailwind classes or var(--color-*)).',
        },
      ],
    },
  },
  {
    files: ['src/lib/api-client/**'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/mocks/**', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
      'import/no-restricted-paths': 'off',
      'no-restricted-imports': 'off',
    },
  },
]);
