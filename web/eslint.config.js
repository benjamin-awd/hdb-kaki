import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Never lint build output, vendored assets, or the config surface itself.
  {
    ignores: ['dist/', '.astro/', 'public/duckdb/', 'src/assets/fonts/', '*.config.*'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,

  // Browser globals for client-side TS/Astro; Node globals for build scripts.
  {
    files: ['**/*.{ts,astro}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // `any` is used deliberately at the DuckDB/ECharts/d3 boundaries where the
      // upstream types are absent or wrong. Keep it visible as a warning rather
      // than a hard gate. Unused vars stay an error, but allow a leading `_` to
      // intentionally discard a binding (e.g. destructuring, unused args).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs', '*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Turn off stylistic rules that Prettier owns. Must stay last.
  prettier,
);
