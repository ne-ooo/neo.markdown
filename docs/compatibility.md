# Markdown compatibility and limits

The main and CommonMark entries match 648 of the 652 official CommonMark 0.31.2 examples.
The remaining four examples use autolink protocols outside the allowed URL protocols.
The tests specify exact text output for these four cases. They do not skip them.

## Method

The fixture source is `commonmark-spec@0.31.2`.
Its extractor retains visible arrow characters that represent tabs in the specification.
The tests replace those markers with tabs in both Markdown input and expected HTML.
They normalize optional slashes on void elements and equivalent quote entities.
Other whitespace, content, and structure must match.

The earlier harness reported 313 matching examples. The corrected baseline contains 314 matches.
The current suite preserves every example from both baselines and checks the exact set of 648 matches.
It runs every fixture through the main and CommonMark entries.

| Official section | Matches |
|---|---:|
| Tabs | 11 / 11 |
| Backslash escapes | 13 / 13 |
| Entity and numeric character references | 17 / 17 |
| Precedence | 1 / 1 |
| Thematic breaks | 19 / 19 |
| ATX headings | 18 / 18 |
| Setext headings | 27 / 27 |
| Indented code blocks | 12 / 12 |
| Fenced code blocks | 29 / 29 |
| HTML blocks | 44 / 44 |
| Link reference definitions | 27 / 27 |
| Paragraphs | 8 / 8 |
| Blank lines | 1 / 1 |
| Block quotes | 25 / 25 |
| List items | 48 / 48 |
| Lists | 26 / 26 |
| Inlines | 1 / 1 |
| Code spans | 22 / 22 |
| Emphasis and strong emphasis | 132 / 132 |
| Links | 90 / 90 |
| Images | 22 / 22 |
| Autolinks | 15 / 19 |
| Raw HTML | 20 / 20 |
| Hard line breaks | 15 / 15 |
| Soft line breaks | 2 / 2 |
| Textual content | 3 / 3 |

Examples 596, 598, 599, and 601 render their labels as text.
Their respective protocols are `irc:`, `a+b+c:`, `made-up-scheme:`, and `localhost:`.
The default renderer also blocks dangerous protocols in ordinary links and images.
Raw HTML requires `allowHtml: true`. The conformance suite enables this option and disables lazy image attributes.
Default output therefore differs from unrestricted CommonMark output on some inputs.

## GFM results

The separate GFM suite contains all 28 normative extension examples from the GFM 0.29-gfm specification.
These cover tables, task lists, strikethrough, extended autolinks, and the raw HTML tag filter.
The suite normalizes equivalent quote entities and the two exact checkbox serializations used by these fixtures.

Twenty-five examples match the specification. Examples 633, 634, and 635 retain XMPP links as text under the existing URL policy.
Each policy case has an explicit output expectation. No example is skipped.
The suite exercises both the main entry and the GFM preset with `breaks: false`.
The GFM preset retains its existing `breaks: true` default.
This extension corpus does not establish complete GFM conformance or equivalence with GitHub rendering.

Table bodies accept rows without pipes and stop at blank lines or interrupting blocks.
Empty tables omit `tbody`. One or two tildes delimit strikethrough, with matching run lengths.
Bare email addresses and explicit `mailto:` links receive autolinks. Explicit Markdown link labels retain their destination.

With GFM enabled, the default renderer escapes the opening `<` in the nine disallowed raw HTML tag names.
The GFM tag filter is syntax behavior, not a structural sanitizer. It does not remove event-handler attributes.
Use the sanitized entry for untrusted HTML. Custom HTML renderers remain trusted code.

## Observable changes

- Parsed code tokens retain the final newline. Empty fenced blocks still have empty `text`.
- Renderer callbacks, highlighting callbacks, error diagnostics, and clipboard output receive the same code source.
- Line highlights exclude the empty position after the final newline. A highlighter can still render that position as an empty line.
- Tight lists omit paragraph wrappers around each direct paragraph. Loose lists retain those wrappers for every item.
- Delimiter rules determine emphasis nesting. For example, triple asterisks produce an outer `em` token and an inner `strong` token.
- Link destinations receive entity decoding, escape decoding, and URL encoding. Unsafe destinations still pass through the renderer's restrictions.
- Image descriptions use the plain text of their inline content.
- HTML block tokens preserve their original line boundaries.

Named character references use the WHATWG entity table. Code spans, code blocks, and raw HTML retain literal entity text.
Entity decoding occurs after syntax recognition, so a decoded asterisk cannot create emphasis.
The language identifier in a code fence receives escape and entity decoding. The `meta` field retains raw fence metadata.

## Resource limits

Existing input, token, block-depth, inline-depth, and inline-work limits still apply.
At the nesting or inline-work limit, the parser leaves additional inline syntax as text.
UGC mode can reject input that exceeds its input or token limits.
Resource-limited parsing does not guarantee unrestricted CommonMark output for arbitrarily large or deeply nested input.

Custom block rules receive optional lazy-line metadata for nested tokenization.
A lazy continuation line cannot introduce a setext underline.
Custom rules and renderer callbacks remain trusted code.

## Reproduction

Run the normative checks:

```bash
lpm run test:conformance
```

Run the complete tests and consumer checks:

```bash
lpm run typecheck
lpm run test:coverage
lpm run build
lpm run test:package
lpm run test:integration
lpm run check:tree-shaking
```

The adversarial suite runs parser cases in subprocesses with a two-second limit.
It includes incomplete syntax, nested delimiters, references, entities, GFM email candidates, table rows, tilde runs, raw tags, and plugin directives.
