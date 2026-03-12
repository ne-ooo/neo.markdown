import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Main entry
    'index': 'src/index.ts',
    // Core
    'core/index': 'src/core/index.ts',
    // Blocks
    'blocks/index': 'src/blocks/index.ts',
    // Inline
    'inline/index': 'src/inline/index.ts',
    // Presets
    'presets/commonmark': 'src/presets/commonmark.ts',
    'presets/gfm': 'src/presets/gfm.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
})
