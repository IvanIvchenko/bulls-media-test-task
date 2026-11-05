import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: { 'import-x': importX },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['error'] }],

      // Order: node built-ins, frameworks, third-party, then relative; alphabetised.
      'import-x/order': [
        'error',
        {
          groups: [['builtin'], ['external'], ['internal'], ['parent', 'sibling', 'index']],
          pathGroups: [
            { pattern: 'fastify', group: 'external', position: 'before' },
            { pattern: '@langchain/**', group: 'external', position: 'before' },
            { pattern: '@anthropic-ai/**', group: 'external', position: 'before' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  // Rules that need type information. The agent is async from end to end, so a forgotten `await` is the likeliest bug.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  // Production code declares what it needs (see agent/needs.util.ts) instead of asserting `value!`.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
  },
  // The CLI and tests are allowed to print.
  { files: ['src/cli/**', 'test/**', 'src/**/*.spec.ts'], rules: { 'no-console': 'off' } },
);
