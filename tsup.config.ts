import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Main entry
    'index': 'src/index.ts',
    'application/index': 'src/application/index.ts',
    'application/sync': 'src/application/sync.ts',
    'application/react': 'src/application/react.ts',
    'experimental/index': 'src/experimental/index.ts',
    'experimental/dom': 'src/experimental/dom.ts',
    'experimental/worker': 'src/experimental/worker.ts',
    'experimental/worker-client': 'src/experimental/worker-client.ts',
    // Default parser with the built-in structural HTML sanitizer
    'sanitized': 'src/sanitized.ts',
    // Core
    'core/index': 'src/core/index.ts',
    // Blocks
    'blocks/index': 'src/blocks/index.ts',
    // Inline
    'inline/index': 'src/inline/index.ts',
    // Presets
    'presets/commonmark': 'src/presets/commonmark.ts',
    'presets/gfm': 'src/presets/gfm.ts',
    // Plugins
    'plugins/highlight': 'src/plugins/highlight.ts',
    'plugins/code-presentation': 'src/plugins/code-presentation.ts',
    'plugins/embeds': 'src/plugins/embeds.ts',
    'plugins/toc': 'src/plugins/toc.ts',
    'plugins/copy-code': 'src/plugins/copy-code.ts',
    'plugins/embeds/react': 'src/plugins/embeds/react.tsx',
  },
  external: ['react', 'react-dom', '@lpm.dev/neo.markdown/experimental', '@lpm.dev/neo.markdown/incremental', '@lpm.dev/neo.markdown/worker-client', '@lpm.dev/neo.markdown/application'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
})
