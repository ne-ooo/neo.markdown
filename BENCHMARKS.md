# Benchmark results

These measurements are local development snapshots. Results depend on the runtime, hardware, input, and options.

## Inline indexes: September 22, 2026

Version 3.0.0 now skips syntax indexes for inline input that needs none, including emphasis and escaped punctuation.
The tokenizer shares empty indexes and still creates independent output tokens. Custom rules run on every call.
Inputs with indexed syntax retain the existing scan.

The baseline is commit `155b3cc78adc5b706ffe74cdd645b62c538ed1bb`. Both versions use identical esbuild settings and reused GFM parser instances.
The harness checks exact token or HTML equality before timing each fixture.
Each version receives three 100 ms warmups and seven samples of at least 150 ms. Sample order alternates between versions.
The table shows median microseconds per operation. Lower times are better.

Environment: Node.js 26.5.0, macOS arm64, Apple M5 Pro, 48 GiB RAM.
Raw samples and system metadata are in [inline-indexes-results.json](test/benchmarks/inline-indexes-results.json).

| Workload | Before (µs) | After (µs) | Speedup |
|---|---:|---:|---:|
| Inline plain text control | 0.172 | 0.170 | 1.01× |
| Inline emphasis | 2.245 | 1.999 | 1.12× |
| Inline sparse emphasis | 27.263 | 14.643 | 1.86× |
| Inline unmatched emphasis | 35.909 | 34.081 | 1.05× |
| Inline escaped punctuation | 1.009 | 0.801 | 1.26× |
| Inline code spans | 1.218 | 1.282 | 0.95× |
| Inline links | 2.203 | 2.126 | 1.04× |
| Inline GFM email | 1.675 | 1.658 | 1.01× |
| Inline GFM deletion | 1.569 | 1.571 | 1.00× |
| Parse short emphasis | 3.663 | 3.310 | 1.11× |
| Parse sparse emphasis | 40.673 | 29.562 | 1.38× |
| Parse 100 emphasized paragraphs | 358.205 | 326.499 | 1.10× |
| Parse mixed document | 1375.194 | 1300.010 | 1.06× |

Sparse emphasis uses 2,827 bytes of prose with one strong span. The mixed document repeats headings, emphasis, lists, code, links, and blockquotes.
The largest improvement occurs when long paragraphs need emphasis parsing but no syntax indexes.
Indexed inputs gain little from this change. The code-span fixture was about 5% slower in this run.
The eligibility check adds a scan before building indexes for these inputs.
These measurements cover parsing and tokenization after warmup. They exclude rendering plugins, sanitizer work, browser layout, and cold imports.

Run from the package directory:

```sh
lpm run bench:inline-indexes -- 155b3cc78adc5b706ffe74cdd645b62c538ed1bb /tmp/inline-indexes-results.json
```

The harness reads the baseline from Git into a temporary directory and removes that directory after the run.
It leaves the checkout unchanged. The following sections retain the August 8 measurements for version 2.0.0.

## Method: August 8, 2026

- Package: `@lpm.dev/neo.markdown` 2.0.0
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

The automated bundle check includes production dependencies and compares minified ESM output. The default parser measured 10,170 bytes gzipped. A selective `/core` parser measured 8,109 bytes gzipped, a 20% reduction. The `/sanitized` entry measured 106,009 bytes gzipped.

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
