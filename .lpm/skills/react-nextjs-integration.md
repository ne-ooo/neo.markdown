---
name: react-nextjs-integration
description: Using @lpm.dev/neo.markdown in React and Next.js — SSR, hydration, module-scope parser, serverless patterns, and React embed components
version: "3.0.0"
globs:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/next.config.*"
  - "**/app/**/*.ts"
  - "**/pages/**/*.ts"
---

# React & Next.js Integration

## Module-Scope Parser

An ordinary parser can serve independent synchronous calls from module scope.
Its plugins and callbacks must also support shared use.
Incremental sessions retain document state and require separate ownership.

```typescript
// lib/markdown.ts
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()

export function renderMarkdown(md: string): string {
  return parser.parse(md)
}
```

For fixed configuration, reuse the ordinary parser instead of creating it during every render.
The incremental session pattern differs because each session retains its document and caches.

## Editor sessions

Use `useMarkdownDocument(source, options)` from `@lpm.dev/neo.markdown/application/react` for package-owned editor lifecycle.
Memoize the options. Configure worker-local plugins in the application worker entry.
Use `createMarkdownApplication()` from `application` for framework-neutral ownership.
Select `createFallback` only without `createWorker`. Worker failures never switch automatically to a synchronous fallback.
Keep DOM initialization and stylesheet installation in the view component.
Read [application ownership](../../docs/application-adapter.md) for cancellation, configuration changes, recovery, and limits.

The following rules apply to direct incremental integration as well:

Create each `createIncrementalMarkdown()` session in an effect, outside React rendering and state initializers.
Keep its configuration stable across source edits.
Dispose the session on unmount and before plugin, parser configuration, or document changes that require separate ownership.
Cancel pending scheduled updates during cleanup, including StrictMode effect replay.
Accept completed results only for the current source, configuration, and update attempt.

If the application coalesces incoming chunks, call `update()` with the complete source.
Keep the last preview visibly pending until the new result arrives.
Hide old results immediately after configuration changes or parsing errors.
Run scoped copy-code and embed cleanup before replacing HTML or unmounting its container.

Rotate sessions between updates with finite budgets.
`IncrementalMarkdownLimitError` identifies session limits but does not promise safe retries.
Work exhaustion can occur after callbacks. Other `RangeError` instances can indicate plugin errors.
After an error, allow a later edit or explicit refresh to create a new session.
Do not automatically repeat the failed parse. Require shorter input after an input-limit error.

The demo uses the same pending shell for server rendering and initial client rendering.
Applications that need server-rendered document HTML can retain their ordinary `parseDocument()` flow.
Sessions cannot cross the server/client boundary. Frame scheduling does not interrupt synchronous parsing.

See [incremental documents](../../docs/incremental.md#application-lifecycle) for lifecycle, declarations, and recovery details.

### DOM ownership

The `dom` entry exports `createMarkdownView()` for DOM patches inside code blocks and containers.
Give the view an HTML `div` with no React-managed children or `dangerouslySetInnerHTML` prop.
Create, update, and dispose the view in layout effects.
Keep React ownership limited to the root attributes and surrounding assets.

Register scoped initializers for copy-code and embeds through the view's `initialize` option.
Retained regions preserve their state. Cleanup runs before changed regions are removed.
For nested patches in an initialized scope, return a lifecycle object with `dispose` and `update` functions.
The update hook reconciles listeners and transient state after the view patches descendants.
Copy-code exposes `refresh()` for this hook. Embed scopes keep complete replacement.
Ordinary initializer callbacks keep complete replacement for changed regions.
Unsupported HTML and exceeded patch limits use complete replacement.
Lifecycle errors close the view without an automatic retry.

Dispose the currently owned view on unmount, including any view created during recovery.
Keep the server and initial client output identical before effects run.
See [DOM patches](../../docs/dom-patches.md) for limits and callback rules.

## Server Components (Next.js App Router)

The parser is a pure synchronous function with no DOM access, no `window`/`document` usage, and no side effects. It works identically in server and client components:

```tsx
// app/blog/[slug]/page.tsx (Server Component)
import { renderMarkdown } from '@/lib/markdown'

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug)

  return (
    <article
      className="prose"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
    />
  )
}
```

## Client Components

```tsx
'use client'

import { renderMarkdown } from '@/lib/markdown'
import { useMemo } from 'react'

export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source])

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
```

Use `useMemo` to avoid re-parsing on unrelated re-renders — `renderMarkdown` is deterministic, so memoization by input is safe.

## Hydration Mismatch Risk

For the highlight plugin, set `injectStyles: false`. Generate `getThemeStylesheet(theme)` once and include that CSS through the application layout.
For the copy-code plugin, use `injectStyles: false` with `getCopyCodeStyles()` in the same layout.
Keep these styles outside the HTML fragment passed to `dangerouslySetInnerHTML`.

After the fragment mounts, call `initializeCopyCode({ root: element })` and `initializeEmbeds({ root: element })` for the active plugins.
Run both cleanup functions before replacing the fragment or unmounting the component.
The copy initializer excludes Neo line numbers and diff gutters from copied text.
Its optional `onError` callback receives clipboard failures.

If you use `allowHtml: true` and the markdown contains browser-dependent HTML (e.g., `<details open>` that browsers auto-close, or elements browsers auto-correct like unclosed `<p>` tags), server-rendered HTML and client DOM will diverge, causing React hydration errors.

```tsx
// ⚠️ Risk of hydration mismatch with allowHtml
const html = parse(md, { allowHtml: true })
<div dangerouslySetInnerHTML={{ __html: html }} />

// Safe — HTML is escaped, output is deterministic
const html = parse(md)
<div dangerouslySetInnerHTML={{ __html: html }} />
```

If hydration differs, fix the generated HTML structure and keep server and client options identical. Use the `/sanitized` entry for untrusted raw HTML. Sanitization and HTML validity are separate concerns; verify the resulting fragment in a browser. Suppressing the hydration warning does not repair the DOM.

## Streaming SSR

`parse()` is synchronous and processes the entire input at once. For large documents in React 18+ streaming SSR, parsing blocks the stream until complete. There is no `parseStream()` or async iterator API.

For very large documents (100KB+ of markdown), consider parsing in a server action or API route and streaming the pre-rendered HTML:

```tsx
// app/api/render/route.ts
import { renderMarkdown } from '@/lib/markdown'

export async function POST(request: Request) {
  const { markdown } = await request.json()
  const html = renderMarkdown(markdown)
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}
```

## Serverless & Edge Runtime

Module-scope is safe for serverless environments (Lambda, Edge Runtime, Vercel Functions):

- The parser instance is tiny — just the options object + class methods
- Cold starts are not affected
- Regex patterns are module-level constants (`PATTERNS` in both tokenizer files), already shared across all instances
- The optionless convenience API keeps one fixed parser cache per entry
- No input-dependent cache grows over time
- Fully stateless per `.parse()` call — `parser.parse(a)` then `parser.parse(b)` are independent with no state leakage between requests

```typescript
// Works in Edge Runtime
export const runtime = 'edge'

import { renderMarkdown } from '@/lib/markdown'

export async function GET(request: Request) {
  const md = await getContent()
  return new Response(renderMarkdown(md))
}
```

## Extracting Headings for Table of Contents

A common pattern in blog/docs sites — extract headings from the AST without parsing twice:

```tsx
import { createParser } from '@lpm.dev/neo.markdown'
import type { BlockToken, HeadingToken } from '@lpm.dev/neo.markdown'

const parser = createParser()

interface TocEntry {
  level: number
  text: string
  id: string
}

export function renderWithToc(md: string): { html: string; toc: TocEntry[] } {
  const tokens = parser.tokenize(md)

  const toc = tokens
    .filter((t): t is HeadingToken => t.type === 'heading')
    .map(t => ({
      level: t.level,
      text: t.text,
      id: t.text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, ''),
    }))

  const html = parser.render(tokens)
  return { html, toc }
}
```

## React Embed Components

Pre-built React components for embedding YouTube, Vimeo, Twitter/X, CodeSandbox, CodePen, and Loom. Import from `@lpm.dev/neo.markdown/plugins/embeds/react`:

```tsx
import { YouTube, Vimeo, Tweet, CodeSandbox, CodePen, Loom } from '@lpm.dev/neo.markdown/plugins/embeds/react'

export function BlogPost({ content }: { content: string }) {
  return (
    <article>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      <YouTube id="dQw4w9WgXcQ" privacyEnhanced />
      <Tweet id="2034382182353871105" />
      <CodeSandbox id="abc123" />
    </article>
  )
}
```

Vimeo and Tweet defer content with IntersectionObserver. YouTube, CodeSandbox, CodePen, and Loom render their iframe immediately and use native `loading="lazy"`.

## Security with User-Generated Markdown

For user-generated content, use the `ugc` shorthand for safe defaults:

```tsx
// UGC mode enables safe links, disables raw HTML, and limits the input size
export function UserComment({ markdown }: { markdown: string }) {
  const html = useMemo(() => parse(markdown, { ugc: true }), [markdown])
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
```

If a CMS requires HTML, use `sanitize: true` with `allowHtml: true`:

```tsx
import { parse as parseSanitized } from '@lpm.dev/neo.markdown/sanitized'

const html = parseSanitized(cmsContent, {
  allowHtml: true,
  sanitize: true,
  allowedTags: ['details', 'summary'],
})
```
