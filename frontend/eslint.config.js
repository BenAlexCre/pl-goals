import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// ISSUE-79 (2026-11-02) — this config was an ESLint 9 template installed
// alongside ESLint 8 and none of its plugins, so lint had never run. Now:
// ESLint 9 + @eslint/js 9, react-hooks 6 (classic rules-of-hooks +
// exhaustive-deps; react-hooks 7's preset adds React Compiler readiness rules,
// and this app does not use the React Compiler), react-refresh, and
// eslint-plugin-react solely for `jsx-uses-vars` — ESLint 9's core scope
// analysis cannot see that `<Spinner />` uses the `Spinner` import, which
// otherwise reports every JSX-only import as unused. No rule is disabled.
export default defineConfig([
  globalIgnores(['dist', 'chrome-profile', '.chrome-profile']),
  {
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['flat/recommended'],
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
    },
  },
  // Node-run code: data-sync scripts, QA scripts, and build/test config.
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
])
