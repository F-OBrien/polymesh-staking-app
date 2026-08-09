import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config. `eslint-config-next` v16 ships native flat configs, so no
 * FlatCompat shim is needed.
 *
 * Two rules here are load-bearing rather than stylistic:
 *
 *  1. `no-restricted-imports` keeps the Polkadot stack out of any statically
 *     reachable module. It is megabytes of JavaScript, and the whole
 *     performance argument (design doc §6.1) rests on it being reached only
 *     through `await import()`. A static import would silently undo that, so it
 *     fails lint instead of quietly regressing the bundle.
 *  2. The `d3` meta-package is banned in favour of submodule imports, for the
 *     same reason — the previous app pulled in all of d3 to use two functions.
 */
const config = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      'legacy/**',
      'out/**',
      '.next/**',
      'node_modules/**',
      'public/data/**',
      'data/**',
      'coverage/**',
    ],
  },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'd3',
              message:
                'Import d3 submodules (d3-scale, d3-shape, d3-array) — the meta-package is ~600 KB.',
            },
          ],
          patterns: [
            {
              group: ['@polkadot/*', '@polymeshassociation/*'],
              message:
                'Load the Polkadot/Polymesh stack via `await import()` only (see lib/chain/). A static import puts megabytes on the critical path.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The chain compat layer and the ingestion scripts are the sanctioned place
    // to touch Polkadot APIs directly, and they run in Node, not the browser.
    files: ['lib/chain/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    // Declaration files emit nothing. The import ban above exists to keep
    // megabytes off the critical path, and a `.d.ts` cannot put anything in a
    // bundle — it is how `types/polymesh-chain.d.ts` pulls in the Polymesh type
    // augmentations without any runtime cost. Narrow on purpose: the ban still
    // applies to every real source file.
    files: ['**/*.d.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];

export default config;
