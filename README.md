# @lpm.dev/neo.markdown

`@lpm.dev/neo.markdown` converts a Markdown subset to HTML and supports GFM
features, sanitization, and plugins.

## Features

- **Markdown subset:** The conformance suite measures behavior against
  CommonMark 0.31.2 fixtures.
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

const cleanup = initializeCopyCode();
```

Call the delegated initializer after the rendered HTML mounts.

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

The package implements a Markdown subset. It does not claim complete CommonMark
or GFM compliance.

The mandatory CommonMark 0.31.2 test records 313 passing examples from 652
official examples. It normalizes void-tag style and quote entities.

Selected official GFM 0.29 extension fixtures are also mandatory. Structural
containers and complete delimiter-stack parsing remain outside the current
subset.

## Security

Raw HTML is escaped by default. Set `allowHtml: true` only for trusted HTML or
with an appropriate sanitizer.

The main and `/core` entries require an application-provided sanitizer. The
`/sanitized` entry includes the structural sanitizer.

UGC mode disables raw HTML, applies safe links, and sets finite resource limits.
It does not make trusted plugins or renderer overrides safe.

Embed plugins load content from external services. Use consent mode and
application policy where privacy or external requests require user approval.

## Migration from `marked`

The parser uses a `parse()` function, but it implements a Markdown subset.
Compare the supported syntax before migration.

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

- **Node.js:** 18 or later
- **Browsers:** Modern browsers
- **Module formats:** ESM and CommonJS
- **TypeScript:** Declaration files for all entry points
- **React:** 18 or later for `plugins/embeds/react`

## Package entry points

| Import                                       | Purpose                                             |
| -------------------------------------------- | --------------------------------------------------- |
| `@lpm.dev/neo.markdown`                      | Main parser, complete rules, utilities, and types.  |
| `@lpm.dev/neo.markdown/sanitized`            | Main parser with the built-in structural sanitizer. |
| `@lpm.dev/neo.markdown/core`                 | Parser classes and an explicit-rules factory.       |
| `@lpm.dev/neo.markdown/blocks`               | Individual block rules.                             |
| `@lpm.dev/neo.markdown/inline`               | Inline tokenizer exports.                           |
| `@lpm.dev/neo.markdown/commonmark`           | Markdown-subset preset without GFM extensions.      |
| `@lpm.dev/neo.markdown/gfm`                  | Preset with GFM extensions.                         |
| `@lpm.dev/neo.markdown/plugins/highlight`    | Syntax-highlighting plugin.                         |
| `@lpm.dev/neo.markdown/plugins/embeds`       | Embed plugin and client initializer.                |
| `@lpm.dev/neo.markdown/plugins/embeds/react` | React embed components.                             |
| `@lpm.dev/neo.markdown/plugins/toc`          | Table-of-contents plugin.                           |
| `@lpm.dev/neo.markdown/plugins/copy-code`    | Copy-button plugin and client initializer.          |

## License

MIT. See [LICENSE](./LICENSE).
