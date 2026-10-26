import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // An underscore-prefixed parameter is this repo's marker for "intentionally
      // unused" — a callback or theme hook that has to keep its position in a
      // fixed signature (see `defaultMath(_tex, inner, _display)`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // shadcn/ui components are vendored: each file pairs its component with the
    // `cva` variants (and sometimes the hook) that go with it, and regeneration
    // would wipe any per-file exception. Splitting those exports into extra files
    // would rewrite import paths all over the app for a dev-only HMR rule.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
