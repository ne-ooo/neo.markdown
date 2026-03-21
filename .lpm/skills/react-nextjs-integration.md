---
name: react-nextjs-integration
description: Using @lpm.dev/neo.markdown in React and Next.js — SSR, hydration, module-scope parser, and serverless patterns
version: "1.1.0"
globs:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/next.config.*"
  - "**/app/**/*.ts"
  - "**/pages/**/*.ts"
---

# React & Next.js Integration

## Module-Scope Parser

Create the parser at module scope. It holds no request-specific state — `Tokenizer`, `InlineTokenizer`, and `HtmlRenderer` store only the options object and class methods. No caches, no WeakMaps, no accumulated state. A single instance is safe to share across concurrent requests.

```typescript
// lib/markdown.ts
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()

export function renderMarkdown(md: string): string {
  return parser.parse(md)
}
```

Do **not** create the parser inside a React component or hook — there is no per-component state to manage, and you'd be recreating 4 class instances on every render for no benefit.

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

If you use `allowHtml: true` and the markdown contains browser-dependent HTML (e.g., `<details open>` that browsers auto-close, or elements browsers auto-correct like unclosed `<p>` tags), server-rendered HTML and client DOM will diverge, causing React hydration errors.

```tsx
// ⚠️ Risk of hydration mismatch with allowHtml
const html = parse(md, { allowHtml: true })
<div dangerouslySetInnerHTML={{ __html: html }} />

// Safe — HTML is escaped, output is deterministic
const html = parse(md)
<div dangerouslySetInnerHTML={{ __html: html }} />
```

If you must allow HTML and face hydration issues, suppress the warning on that specific element:

```tsx
<div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
```

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
- No internal cache grows over time
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

## Security with User-Generated Markdown

In apps where users submit markdown (comments, forum posts, CMS), never use `allowHtml: true`:

```tsx
// Safe for user content — default behavior escapes all HTML
export function UserComment({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
```

The `sanitize` option is not implemented — if you need to allow some HTML in trusted contexts, use an external sanitizer like DOMPurify after parsing.
