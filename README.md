# @lpm.dev/neo.markdown

`@lpm.dev/neo.markdown` converts Markdown to HTML and supports GFM
features, sanitization, and plugins.

## Features

- **Markdown compatibility:** The [compatibility suite](./docs/compatibility.md)
  covers all 652 CommonMark 0.31.2 examples.
- **GFM features:** Supports tables, task lists, strikethrough, and autolinks.
- **HTML controls:** Escapes raw HTML by default and provides a structural
  sanitizer entry point.
- **Plugins:** Supports syntax highlighting, embeds, a table of contents, copy
  buttons, and application rules.
- **Resource controls:** Limits input length, token count, nesting depth, and
  inline work.
- **TypeScript support:** The package exports parser, token, renderer, rule, and
  plugin types.
- **Dependency surface:** One runtime dependency supplies the structural HTML
  sanitizer.

## Install

Install the package with LPM:

```bash
lpm install @lpm.dev/neo.markdown
```

React 18 or later is an optional peer dependency for the React embed entry
point.

## Quick start

```typescript
import { parse } from "@lpm.dev/neo.markdown";

const html = parse("# Hello\n\nWorld");
// => "<h1>Hello</h1>\n<p>World</p>\n"
```

## API

### `parse(markdown, options?): string`

`parse()` converts Markdown source to HTML. An optionless call reuses one lazy
parser.

A call with options creates a parser for that call. Use `createParser()` for
repeated work with the same options.

```typescript
import { parse } from "@lpm.dev/neo.markdown";

parse("# Hello");
// => "<h1>Hello</h1>\n"

parse('<script>alert("xss")</script>');
// => "<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>\n"

parse('<div class="box">content</div>', { allowHtml: true });
// => "<div class=\"box\">content</div>\n"
```

### `createParser(options?): Parser`

`createParser()` creates a parser with `parse()`, `tokenize()`, and `render()`
methods.

```typescript
import { createParser } from "@lpm.dev/neo.markdown";

const parser = createParser({
  allowHtml: false,
  gfm: true,
});

parser.parse("**bold** text");
const tokens = parser.tokenize("# Heading");
parser.render(tokens);
```

### Parser options

| Option              | Type                       | Default           | Description                                                  |
| ------------------- | -------------------------- | ----------------- | ------------------------------------------------------------ |
| `allowHtml`         | `boolean`                  | `false`           | Pass raw HTML to the output.                                 |
| `sanitize`          | `boolean`                  | `false`           | Sanitize raw HTML. This requires `allowHtml: true`.          |
| `sanitizer`         | `HtmlSanitizer`            | None              | Provide an HTML sanitizer for the main or `/core` entry.     |
| `allowedTags`       | `string[]`                 | Built-in list     | Add allowed tags during sanitization.                        |
| `allowedAttributes` | `Record<string, string[]>` | Built-in list     | Add allowed attributes for each tag.                         |
| `allowStyle`        | `boolean`                  | `false`           | Allow a restricted set of inline style properties.           |
| `gfm`               | `boolean`                  | `false`           | Enable GFM features.                                         |
| `breaks`            | `boolean`                  | `false`           | Convert bare newlines to `<br>`.                             |
| `maxNestingDepth`   | `number`                   | `100`             | Limit nested blockquotes and lists. The hard maximum is 100. |
| `maxInputLength`    | `number`                   | No general limit  | Reject longer input. UGC mode has a hard limit.              |
| `lazyImages`        | `boolean`                  | `true`            | Add `loading="lazy"` to rendered images.                     |
| `safeLinks`         | `boolean \| object`        | `false`           | Set attributes for external links.                           |
| `ugc`               | `boolean`                  | `false`           | Apply the user-generated-content controls.                   |
| `blocks`            | `BlockRule[]`              | Complete rule set | Select the block rules.                                      |
| `renderer`          | `Partial<Renderer>`        | HTML renderer     | Override renderer methods.                                   |
| `plugins`           | `MarkdownPlugin[]`         | `[]`              | Add parser plugins.                                          |

The `safeLinks` object accepts `externalRel`, `externalTarget`, and `baseUrl`.

### HTML sanitization

Import the `/sanitized` entry to use the built-in structural sanitizer.

```typescript
import { createParser } from "@lpm.dev/neo.markdown/sanitized";

const parser = createParser({
  allowHtml: true,
  sanitize: true,
});

parser.parse('<script>alert("xss")</script>');
// The script element is removed.

parser.parse('<img onerror="hack" src="x">');
// The onerror attribute is removed.

parser.parse('<a href="javascript:evil">click</a>');
// The href attribute is removed.
```

With `allowStyle: true`, the sanitizer permits these properties:

- `color`
- `background-color`
- `font-style`
- `font-weight`
- `text-align`
- `text-decoration`
- `white-space`

The sanitizer removes layout properties, CSS expressions, and URL values from
inline styles.

### User-generated-content mode

Use UGC mode for comments, READMEs, and other untrusted Markdown.

```typescript
import { createParser } from "@lpm.dev/neo.markdown";

const parser = createParser({ ugc: true });
const html = parser.parse(userMarkdown);
```

UGC mode disables raw HTML and applies safe-link defaults. It limits input to
1,000,000 UTF-16 code units and 50,000 tokens.

The parser also applies fixed inline nesting and work limits. These limits stop
deep formatting and repeated rescans after the budgets are exhausted.

### Select block rules

Use the `/core` entry and explicit `/blocks` imports to exclude unused block
rules.

```typescript
import { createParser } from "@lpm.dev/neo.markdown/core";
import { code, heading, list, paragraph } from "@lpm.dev/neo.markdown/blocks";

const parser = createParser({
  blocks: [heading, paragraph, code, list],
});
```

The main entry includes the complete default rule set.

## Plugins

Plugins can add rules, override renderer methods, transform tokens, and
transform final HTML.

```typescript
import { createParser } from "@lpm.dev/neo.markdown";
import { copyCodePlugin } from "@lpm.dev/neo.markdown/plugins/copy-code";
import { embedPlugin } from "@lpm.dev/neo.markdown/plugins/embeds";
import { tocPlugin } from "@lpm.dev/neo.markdown/plugins/toc";

const parser = createParser({
  gfm: true,
  plugins: [
    tocPlugin({ maxDepth: 3 }),
    embedPlugin({ youtube: true, twitter: true, autoEmbed: true }),
    copyCodePlugin(),
  ],
});
```

### Highlight plugin

The highlight plugin uses `@lpm.dev/neo.highlight` for fenced code blocks.

```bash
lpm install @lpm.dev/neo.highlight
```

```typescript
import { parse } from "@lpm.dev/neo.markdown";
import { highlightPlugin } from "@lpm.dev/neo.markdown/plugins/highlight";
import {
  getThemeStylesheet,
  renderToHTML,
  tokenize,
} from "@lpm.dev/neo.highlight";
import {
  javascript,
  python,
  typescript,
} from "@lpm.dev/neo.highlight/grammars";
import { githubDark } from "@lpm.dev/neo.highlight/themes/github-dark";

const html = parse(markdown, {
  plugins: [
    highlightPlugin({
      grammars: [javascript, typescript, python],
      tokenize,
      renderToHTML,
      getThemeStylesheet,
      theme: githubDark,
      lineNumbers: true,
      errorPolicy: "plain",
      maxInputLength: 100_000,
      onError: (error, context) => console.error(context.language, error),
    }),
  ],
});
```

Code metadata can select highlighted lines:

````markdown
```typescript {1,3-5} title="example.ts"
const a = 1;
const b = 2;
const c = 3;
```
````

The package separates the language and metadata before it calls the plugin.
Expanded highlight metadata has a hard limit of 10,000 lines.

Language names and aliases ignore case and surrounding whitespace. For example,
`js`, `JS`, and `JavaScript` select the same registered JavaScript grammar.
Unknown languages and fences without a language render as escaped plain text.

Direct `highlightPlugin()` calls infer callback types. For an explicitly typed
options object, use `HighlightOptions<Grammar, Token, Theme>` with the types
exported by `neo.highlight`.

| Option | Default | Behavior |
| --- | --- | --- |
| `errorPolicy` | `"throw"` | Throw highlighting errors, or use `"plain"` to preserve the failed block as escaped source. |
| `onError` | None | Receive the error and `{ stage, code, language, meta }` before the error policy applies. |
| `injectStyles` | `true` | Include theme CSS when `theme` and `getThemeStylesheet` are supplied. |
| `diffHighlight` | None | Supply `{ added, removed, modified }` line arrays, or a function that returns them for each code token. |
| `maxInputLength` | 250,000 | Limit source characters per highlighted block. |
| `maxMatchCount` | 100,000 | Limit tokenizer matches per block. |
| `maxTokenCount` | 100,000 | Limit created and rendered token nodes. |
| `maxTokenDepth` | 100 | Limit grammar and token nesting. |
| `maxRenderedLength` | 10,000,000 | Limit highlighted HTML characters per block. |
| `maxLines` | 10,000 | Limit rendered source lines per block. |

The resource defaults come from `neo.highlight`. Each limit accepts a
non-negative integer or `Infinity`. The plugin rejects invalid limits during
setup. Finite limits are appropriate for user-controlled source.

With `errorPolicy: "plain"`, the fallback preserves the complete code token.
Highlighting limits do not truncate this fallback. Set the parser's
`maxInputLength`, or use `ugc: true`, to limit the whole document.
An error from `onError` itself propagates to the caller.

For per-block diff lines, the callback receives the original code token:

```typescript
const plugin = highlightPlugin({
  grammars: [javascript],
  tokenize,
  renderToHTML,
  diffHighlight: (token) => token.meta === "added" ? { added: [1] } : undefined,
});
```

#### Theme CSS with sanitization and React

The structural sanitizer removes inline theme styles from highlighted HTML.
Token classes remain. Include the theme stylesheet to preserve colors, line
numbers, and diff styles. Keep the sanitizer's CSS restrictions active.

For React or server layouts, disable stylesheet insertion in the HTML fragment:

```typescript
import { createParser } from "@lpm.dev/neo.markdown/sanitized";

const themeCSS = getThemeStylesheet(githubDark);
const parser = createParser({
  allowHtml: true,
  sanitize: true,
  maxInputLength: 1_000_000,
  plugins: [highlightPlugin({
    grammars: [javascript],
    tokenize,
    renderToHTML,
    theme: githubDark,
    injectStyles: false,
    errorPolicy: "plain",
  })],
});
```

Serve `themeCSS` as an application stylesheet, or render it once through the
layout's `<style>` element. Do not place that element inside the Markdown
`dangerouslySetInnerHTML` fragment. `injectStyles: false` controls stylesheet
insertion. It does not remove the highlighter's inline style attributes.

### Embed plugin

The embed plugin supports YouTube, Vimeo, Twitter/X, CodeSandbox, CodePen,
GitHub Gist, and Loom.

```typescript
import { parse } from "@lpm.dev/neo.markdown";
import {
  embedPlugin,
  initializeEmbeds,
} from "@lpm.dev/neo.markdown/plugins/embeds";

const html = parse(markdown, {
  plugins: [
    embedPlugin({
      youtube: { privacyEnhanced: true },
      vimeo: { dnt: true },
      twitter: { dnt: true, theme: "dark" },
      codesandbox: true,
      codepen: true,
      gist: true,
      loom: true,
      autoEmbed: true,
      responsive: true,
      consent: false,
    }),
  ],
});

const cleanup = initializeEmbeds();
```

Call the initializer after the HTML mounts. It manages consent actions, Gist
frames, and Twitter widgets.

The initializer returns a no-operation cleanup function during server rendering.

Supported directives:

```markdown
::youtube[dQw4w9WgXcQ] ::vimeo[53373707]{title="My Video"} ::tweet[1234567890]
::codesandbox[my-sandbox-id] ::codepen[pen-id]{user="username"}
::gist[abc123def]{user="username" file="index.ts"} ::loom[video-hash]
```

With `autoEmbed: true`, a paragraph that contains only a supported URL becomes
an embed.

With `consent: true`, the plugin emits a consent control. External content loads
after the user activates that control.

React components are available from the optional React entry:

```tsx
import {
  CodePen,
  CodeSandbox,
  Loom,
  Tweet,
  Vimeo,
  YouTube,
} from "@lpm.dev/neo.markdown/plugins/embeds/react";

<YouTube id="dQw4w9WgXcQ" />;
<Vimeo id="53373707" />;
<Tweet id="1234567890" theme="dark" />;
```

These components use `IntersectionObserver` for lazy loading. The Tweet
component deduplicates its script and removes resources on unmount.

### Table-of-contents plugin

The TOC plugin adds heading IDs and can add anchor links.

```typescript
import { parse } from "@lpm.dev/neo.markdown";
import { tocPlugin } from "@lpm.dev/neo.markdown/plugins/toc";
import type { TocEntry } from "@lpm.dev/neo.markdown/plugins/toc";

let tableOfContents: TocEntry[] = [];

const html = parse(markdown, {
  plugins: [
    tocPlugin({
      maxDepth: 3,
      anchorLinks: true,
      anchorClass: "anchor",
      onToc: (entries) => {
        tableOfContents = entries;
      },
    }),
  ],
});
```

Duplicate heading IDs receive numeric suffixes such as `intro-1` and `intro-2`.

### Copy-code plugin

The copy-code plugin adds an inert button to each `<pre>` block. It does not
emit inline JavaScript.

```typescript
import { parse } from "@lpm.dev/neo.markdown";
import {
  copyCodePlugin,
  initializeCopyCode,
} from "@lpm.dev/neo.markdown/plugins/copy-code";

const html = parse(markdown, {
  plugins: [
    copyCodePlugin({
      buttonText: "Copy",
      buttonClass: "copy-code-button",
      wrapperClass: "code-block",
    }),
  ],
});

const cleanup = initializeCopyCode({
  root: document.getElementById("preview")!,
  onError: (error) => console.error("Copy failed", error),
});
```

Call the delegated initializer after the rendered HTML mounts. Call `cleanup()`
before unmounting or replacing the preview. Cleanup removes the listener and
label timers. Pending clipboard results cannot update the UI after cleanup.

The initializer copies source text without Neo line numbers or diff markers.
Line breaks use LF after Markdown normalization. Clipboard failures call
`onError` and leave the label unchanged.

## Custom plugins

A `MarkdownPlugin` receives a `PluginBuilder`.

| Method                    | Description                              |
| ------------------------- | ---------------------------------------- |
| `addBlockRule(rule)`      | Add a block tokenization rule.           |
| `addInlineRule(rule)`     | Add an inline tokenization rule.         |
| `setRenderer(method, fn)` | Override a renderer method.              |
| `addTokenTransform(fn)`   | Transform block tokens before rendering. |
| `addHtmlTransform(fn)`    | Transform final HTML.                    |
| `renderInline(tokens)`    | Render inline tokens.                    |
| `renderBlock(tokens)`     | Render block tokens.                     |
| `options`                 | Read the parser options.                 |

Renderer overrides, plugins, and HTML transforms are trusted application code.
Escape untrusted token text before insertion into HTML.

### Custom block rule

```typescript
import { escapeHtml } from "@lpm.dev/neo.markdown";
import type { MarkdownPlugin } from "@lpm.dev/neo.markdown";

const notePlugin: MarkdownPlugin = (builder) => {
  builder.addBlockRule({
    name: "note",
    priority: "before:paragraph",
    starts: (source) => source.startsWith(":::note\n"),
    tokenize(source) {
      const match = /^:::note\n([\s\S]*?)\n:::(?:\n|$)/.exec(source);
      if (!match) {
        return null;
      }

      return {
        token: {
          type: "html",
          raw: match[0],
          text: `<div class="note">${escapeHtml(match[1] ?? "")}</div>`,
        },
        raw: match[0],
      };
    },
  });
};
```

A rule can use numeric priority or a position such as `before:paragraph` or
`after:code`.

A successful rule must return a nonempty `raw` value that is an exact source
prefix. Invalid results throw an error.

### Custom inline rule

```typescript
import { escapeHtml } from "@lpm.dev/neo.markdown";
import type { MarkdownPlugin } from "@lpm.dev/neo.markdown";

const markPlugin: MarkdownPlugin = (builder) => {
  builder.addInlineRule({
    name: "mark",
    priority: "before:em",
    triggerChars: [61],
    tokenize(source) {
      const match = /^==(.*?)==/.exec(source);
      if (!match) {
        return null;
      }

      return {
        token: {
          type: "html",
          raw: match[0],
          text: `<mark>${escapeHtml(match[1] ?? "")}</mark>`,
        },
        raw: match[0],
      };
    },
  });
};
```

Inline priorities can target `escape`, `code`, `strong`, `em`, `del`, `link`,
`html`, `br`, `autolink`, or `text`.

## Supported syntax

The default parser supports these block elements:

- ATX and Setext headings
- Paragraphs and blockquotes
- Ordered and unordered lists
- Indented and fenced code blocks
- HTML blocks with raw HTML active
- Link definitions
- Horizontal rules
- GFM tables and task lists with GFM active

It supports these inline elements:

- Strong and emphasized text
- Strikethrough with GFM active
- Inline code
- Links and images
- Autolinks
- Raw inline HTML with raw HTML active
- Hard and optional soft line breaks

## Presets

```typescript
import { parse as parseCommonMark } from "@lpm.dev/neo.markdown/commonmark";
import { parse as parseGfm } from "@lpm.dev/neo.markdown/gfm";

parseCommonMark(markdown);
parseGfm(markdown);
```

The CommonMark preset disables GFM extensions. The GFM preset enables tables,
task lists, strikethrough, and autolinks.

## Conformance and limits

The mandatory CommonMark 0.31.2 suite matches 648 of 652 official examples.
The other four examples use autolink protocols that the URL policy blocks.
Every example has an explicit expected result in both the main and CommonMark entries.
The suite expands visible tab markers and normalizes void-tag style and quote entities.

The parser supports nested containers, delimiter runs, reference definitions,
character references, and the seven CommonMark HTML block forms.
Code tokens retain their trailing newline. Renderer and highlighting callbacks receive that newline.

The separate GFM suite covers selected official extension fixtures. It does not establish complete GFM conformance.
Resource limits and the default HTML and URL policies also apply.
See [compatibility and limits](./docs/compatibility.md) for the method, commands, and observable behavior changes.

## Security

Raw HTML is escaped by default. Set `allowHtml: true` only for trusted HTML or
with an appropriate sanitizer.

The main and `/core` entries require an application-provided sanitizer. The
`/sanitized` entry includes the structural sanitizer.

UGC mode disables raw HTML, applies safe links, and sets finite resource limits.
It does not make trusted plugins or renderer overrides safe.

Embed plugins load content from external services. Use consent mode and
application policy where privacy or external requests require user approval.

## Migration from version 2

Upgrade Node.js to 22.12 or later before installing version 3.
The existing string API remains available. Review changed code-token newlines and corrected Markdown output in [the migration guide](./docs/migration-v3.md).

## Migration from `marked`

The parser provides a `parse()` function. HTML defaults, URL restrictions, plugins,
and renderer options can differ from `marked`.

```diff
- import { marked } from "marked";
- const html = marked("# Hello");
+ import { parse } from "@lpm.dev/neo.markdown";
+ const html = parse("# Hello");
```

Run the application tests after the migration.

## Migration from `markdown-it`

If the application reuses options, create one parser.

```diff
- import MarkdownIt from "markdown-it";
- const parser = new MarkdownIt();
- const html = parser.render("# Hello");
+ import { createParser } from "@lpm.dev/neo.markdown";
+ const parser = createParser();
+ const html = parser.parse("# Hello");
```

Run the application tests after the migration.

## Migration from the remark and rehype stack

Use focused plugins for highlighting, heading anchors, embeds, and sanitization.

| Existing plugin                    | Package equivalent                                            |
| ---------------------------------- | ------------------------------------------------------------- |
| `rehype-pretty-code`               | `highlightPlugin()` with `@lpm.dev/neo.highlight`.            |
| `rehype-slug`                      | `tocPlugin({ anchorLinks: false })`.                          |
| `rehype-autolink-headings`         | `tocPlugin({ anchorLinks: true })`.                           |
| Application embed components       | `embedPlugin()`.                                              |
| `rehype-raw` and `rehype-sanitize` | The `/sanitized` entry with raw HTML and sanitization active. |

The pipelines do not have identical syntax or plugin semantics. Run conformance
and application tests after migration.

## Performance

The repository measures basic Markdown, GFM, large documents, and adversarial
inputs.

See [BENCHMARKS.md](./BENCHMARKS.md) for the environment, method, results, and
limits.

Run the benchmark suite:

```bash
lpm run bench
```

Benchmark results depend on the runtime, computer, options, plugins, and input
data.

## Runtime support

- **Node.js:** 22.12 or later
- **Browsers:** Modern browsers
- **Module formats:** ESM and CommonJS
- **TypeScript:** Declaration files for all entry points
- **React:** 18 or later for `plugins/embeds/react`

## Package entry points

The optional [experimental incremental session](./docs/incremental.md) resumes built-in block parsing and reuses inline tokens across document updates.
It continues open fences, tables, lists, and blockquotes when their saved dependencies remain unchanged.
Each update renders the complete document.
Declared highlight, presentation, copy-code, and TOC plugins can opt into reuse with `pluginReuse: "declared"`.
[Pure inline plugins](./docs/incremental.md#pure-inline-rules) can also declare static dependencies or a revision getter for cache invalidation.
The [incremental guide](./docs/incremental.md#declared-render-plugins) covers declarations, token isolation, registration checks, and fallback behavior.

| Import                                       | Purpose                                             |
| -------------------------------------------- | --------------------------------------------------- |
| `@lpm.dev/neo.markdown`                      | Main parser, complete rules, utilities, and types.  |
| `@lpm.dev/neo.markdown/sanitized`            | Main parser with the built-in structural sanitizer. |
| `@lpm.dev/neo.markdown/core`                 | Parser classes and an explicit-rules factory.       |
| `@lpm.dev/neo.markdown/experimental`         | Experimental reuse across structured document updates. |
| `@lpm.dev/neo.markdown/blocks`               | Individual block rules.                             |
| `@lpm.dev/neo.markdown/inline`               | Inline tokenizer exports.                           |
| `@lpm.dev/neo.markdown/commonmark`           | CommonMark preset without GFM extensions.           |
| `@lpm.dev/neo.markdown/gfm`                  | Preset with GFM extensions.                         |
| `@lpm.dev/neo.markdown/plugins/highlight`    | Syntax-highlighting plugin.                         |
| `@lpm.dev/neo.markdown/plugins/embeds`       | Embed plugin and client initializer.                |
| `@lpm.dev/neo.markdown/plugins/embeds/react` | React embed components.                             |
| `@lpm.dev/neo.markdown/plugins/toc`          | Table-of-contents plugin.                           |
| `@lpm.dev/neo.markdown/plugins/copy-code`    | Copy-button plugin and client initializer.          |

## Development

Install dependencies with `lpm install`. Build a sibling `neo.highlight` checkout
with `lpm install` and `lpm run build`. The integration suite tests its built
exports against this package. Set `NEO_HIGHLIGHT_DIR` to use another checkout.
The integration contract selects highlighter 1.4.0. See [CONTRIBUTING.md](./CONTRIBUTING.md) for release checks.

```bash
lpm run release:check
```

The release gate includes unit tests, coverage, package exports, strict TypeScript
consumers, ESM and CommonJS integration tests, tree shaking, dependency audits, and registry-signature audits.

## License

MIT. See [LICENSE](./LICENSE).
