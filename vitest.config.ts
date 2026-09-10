import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: [
    ['incremental', 'experimental/index'], ['experimental', 'experimental/index'],
    ['worker-client', 'experimental/worker-client'], ['application', 'application/index'],
  ].map(([name, path]) => ({ find: new RegExp('^@lpm\\.dev/neo\\.markdown/' + name + '$'), replacement: new URL('./src/' + path + '.ts', import.meta.url).pathname })) },
  test: {
    globals: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, '.integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        'scripts/**',
        '.integration/**',
        '*.config.ts',
      ],
      thresholds: {
        'src/plugins/embeds/react.tsx': {
          statements: 95,
          branches: 80,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
})
