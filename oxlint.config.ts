import cloudflare from '@cloudflare/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [cloudflare],
  env: cloudflare.env,
  ignorePatterns: [
    ...cloudflare.ignorePatterns,
    '**/dist/**',
    '**/.wrangler/**',
    '**/coverage/**',
    '.agents/**',
    '.devin/**',
    // Vendored Siteplane UI source — installed/updated via the registry, not ours to restyle.
    '**/siteplane/**',
  ],
  rules: {
    // instanceof is used for this project's own error classes (single realm).
    '@nkzw/no-instanceof': 'off',
    'unicorn/filename-case': ['error', { case: 'kebabCase' }],
  },
  overrides: [
    {
      files: ['apps/admin/**/*.{ts,tsx}'],
      rules: {
        'react/only-export-components': ['warn', { allowConstantExport: true }],
      },
    },
    {
      // Specs and helpers drive a live worker through untyped pusher-js internals.
      files: ['**/test/**', '**/__tests__/**', '**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx}'],
      rules: {
        'quality/no-object-parameters': 'off',
        'quality/no-unsafe-dictionary-type': 'off',
        'typescript/no-explicit-any': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
    {
      // The worker's only log sink is the console; node scripts print by design.
      files: ['apps/worker/**', '**/*.mjs'],
      rules: { 'no-console': 'off' },
    },
  ],
});
