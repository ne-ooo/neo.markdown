# Benchmark results

These results are a reproducible development snapshot, not a general performance guarantee. The benchmark files first compare canonicalized HTML from every parser. Timing does not start if the enabled features or rendered semantics differ.

## Method

- Package: `@lpm.dev/neo.markdown` 1.2.1
- Date: August 8, 2026
- Runtime: Node.js 26.5.0
- Platform: macOS 26.5.2, arm64
- Runner: Vitest 3.2.7 benchmark mode
- Comparisons: marked 12.0.2 and markdown-it 14.3.0
- Lifecycle: one configured parser instance is reused by each benchmark
- GFM: enabled for all three parsers; markdown-it uses `linkify` and `markdown-it-task-lists`

The parsers intentionally emit small presentation differences, such as `<s>` versus `<del>`, table-alignment attributes, checkbox attribute order, and insignificant whitespace. The preflight guard canonicalizes only those differences before requiring equal output.

## Observed throughput

Values are operations per second from one local run. Higher is better.

### Basic Markdown

| Sample | neo.markdown | marked | markdown-it |
|---|---:|---:|---:|
| Simple text | 782,641 | 458,493 | 819,828 |
| Paragraph and inline elements | 283,574 | 213,300 | 274,419 |
| Headings | 626,105 | 492,098 | 687,680 |
| Nested lists | 201,314 | 133,144 | 358,647 |
| Fenced code | 242,411 | 239,391 | 238,869 |
| Mixed document | 73,094 | 43,579 | 66,185 |

### GFM features

| Sample | neo.markdown | marked | markdown-it |
|---|---:|---:|---:|
| Strikethrough | 399,189 | 234,460 | 213,691 |
| Task lists | 99,436 | 80,764 | 94,422 |
| Tables | 107,633 | 68,527 | 103,078 |
| Aligned tables | 133,481 | 83,138 | 135,017 |
| Extended autolinks | 90,731 | 110,926 | 35,275 |
| Mixed GFM document | 43,365 | 29,748 | 33,308 |

### Generated documents

| Input | Bytes | neo.markdown | marked | markdown-it |
|---|---:|---:|---:|---:|
| Small | 3,976 | 5,631 | 4,830 | 7,419 |
| Medium | 20,221 | 1,057 | 933 | 1,503 |
| Large | 82,111 | 266 | 210 | 341 |

## Interpretation

This corrected run does not support the previous percentage claims or the claim that neo.markdown scales better on large documents. Neo was fastest on seven of twelve basic/GFM samples, although several margins were small, and it remained materially slower on lists and generated documents. Results can vary with runtime, CPU state, parser versions, and benchmark duration.

## Selective bundle check

The automated bundle check externalizes third-party runtime dependencies and compares minified ESM output. The default parser measured 8,829 bytes gzipped. A `/core` parser containing only heading and paragraph rules measured 6,805 bytes gzipped, a 23% reduction.

```bash
lpm run build
lpm run check:tree-shaking
```

## Run the benchmarks

```bash
lpm run bench -- --run
```

Run one suite:

```bash
lpm run bench -- --run test/benchmarks/gfm.bench.ts
```

The tracked suites are:

- `test/benchmarks/basic.bench.ts`
- `test/benchmarks/gfm.bench.ts`
- `test/benchmarks/large-documents.bench.ts`
