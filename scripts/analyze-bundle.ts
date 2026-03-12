/**
 * Bundle size analysis script
 * Analyzes the bundle size and tree-shaking effectiveness
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '../dist')

interface FileSize {
  file: string
  size: number
  gzipped?: number
}

function getFileSize(filePath: string): number {
  const stats = fs.statSync(filePath)
  return stats.size
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function analyzeDirectory(dir: string, ext: string): FileSize[] {
  const files: FileSize[] = []

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir)

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (entry.endsWith(ext) && !entry.endsWith('.map')) {
        const relativePath = path.relative(distDir, fullPath)
        files.push({
          file: relativePath,
          size: getFileSize(fullPath),
        })
      }
    }
  }

  walk(dir)
  return files
}

console.log('📦 Bundle Size Analysis\n')
console.log('=' .repeat(80))

// Analyze ESM build
console.log('\n🔹 ESM Build (.js files)')
console.log('-'.repeat(80))
const esmFiles = analyzeDirectory(distDir, '.js')
esmFiles.sort((a, b) => b.size - a.size)

let totalESM = 0
for (const file of esmFiles) {
  console.log(`  ${file.file.padEnd(40)} ${formatBytes(file.size).padStart(10)}`)
  totalESM += file.size
}
console.log('-'.repeat(80))
console.log(`  Total ESM:`.padEnd(40) + formatBytes(totalESM).padStart(10))

// Analyze CJS build
console.log('\n🔹 CJS Build (.cjs files)')
console.log('-'.repeat(80))
const cjsFiles = analyzeDirectory(distDir, '.cjs')
cjsFiles.sort((a, b) => b.size - a.size)

let totalCJS = 0
for (const file of cjsFiles) {
  console.log(`  ${file.file.padEnd(40)} ${formatBytes(file.size).padStart(10)}`)
  totalCJS += file.size
}
console.log('-'.repeat(80))
console.log(`  Total CJS:`.padEnd(40) + formatBytes(totalCJS).padStart(10))

// Analyze TypeScript declarations
console.log('\n🔹 TypeScript Declarations (.d.ts files)')
console.log('-'.repeat(80))
const dtsFiles = analyzeDirectory(distDir, '.d.ts')
dtsFiles.sort((a, b) => b.size - a.size)

let totalDTS = 0
for (const file of dtsFiles) {
  console.log(`  ${file.file.padEnd(40)} ${formatBytes(file.size).padStart(10)}`)
  totalDTS += file.size
}
console.log('-'.repeat(80))
console.log(`  Total DTS:`.padEnd(40) + formatBytes(totalDTS).padStart(10))

// Summary
console.log('\n📊 Summary')
console.log('='.repeat(80))
console.log(`  Total ESM:       ${formatBytes(totalESM)}`)
console.log(`  Total CJS:       ${formatBytes(totalCJS)}`)
console.log(`  Total DTS:       ${formatBytes(totalDTS)}`)
console.log(`  Grand Total:     ${formatBytes(totalESM + totalCJS + totalDTS)}`)
console.log()

// Module-specific analysis
console.log('📦 Module Analysis (ESM)')
console.log('='.repeat(80))

const modules = [
  { name: 'Full Package', file: 'index.js' },
  { name: 'Core', file: 'core/index.js' },
  { name: 'Blocks', file: 'blocks/index.js' },
  { name: 'Inline', file: 'inline/index.js' },
  { name: 'GFM Preset', file: 'presets/gfm.js' },
  { name: 'CommonMark Preset', file: 'presets/commonmark.js' },
]

for (const module of modules) {
  const file = esmFiles.find(f => f.file === module.file)
  if (file) {
    const size = formatBytes(file.size)
    console.log(`  ${module.name.padEnd(25)} ${size.padStart(10)}`)
  }
}

console.log('\n✅ Bundle analysis complete!')
