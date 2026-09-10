# Stable document APIs

Version 3.0 stabilizes the document ownership, incremental parsing, worker, and DOM view APIs.
The release remains unpublished during local preparation.
Existing string-returning APIs and structured document APIs retain their behavior.

| Stable entry | Public purpose | Compatible legacy entry |
| --- | --- | --- |
| `incremental` | Incremental documents and plugin declarations | `experimental` |
| `dom` | Owned DOM regions and descendant patches | `experimental/dom` |
| `worker` | Worker handler and installation | `experimental/worker` |
| `worker-client` | Dedicated worker transport and revisions | `experimental/worker-client` |
| `application` | Framework-neutral document ownership and recovery | None |
| `application/sync` | Bounded synchronous fallback sessions | None |
| `application/react` | React ownership hook | None |

All entries use the `@lpm.dev/neo.markdown/` prefix.
The stable and legacy entries resolve to identical runtime files within each module format.
They share function identities, error classes, and plugin declarations.
Legacy paths remain supported aliases in version 3. No migration is required for existing consumers.
New applications can use the stable paths.

ESM and CommonJS expose equivalent public types and behavior.
They remain distinct module instances. Declarations from one instance cannot authorize plugin reuse in another instance.
Mixed instances retain the existing safe fallback. Applications must use one format and package instance for declarations and sessions.
The worker handler and its worker-local declarations obey the same rule.

## Compatibility contract

Semantic versioning applies to these public entries.
Breaking changes to signatures, required options, result shapes, closed status unions, or error-code unions require a major release.
New optional capabilities require compatibility review before a minor release.
Corrections can change HTML for previously incorrect Markdown or grammar cases, subject to documented compatibility and security policies.

The contract includes complete structured results, lifecycle ownership, cancellation categories, explicit resource limits, and recovery without automatic callback retries.
The string API remains separate from mutable document ownership.
Worker messages retain protocol identifier `neo.markdown/1`.
Applications must deploy compatible worker and client assets together.

Exact metric counts, timing values, cache hits, checkpoint placement, and automatic rotation timing are implementation details.
Cache limits and lifecycle guarantees remain supported behavior.
DOM node identity is conditional on ownership checks, supported structure, configured limits, and lifecycle hooks.
The DOM view can select complete replacement. It does not guarantee preservation of every node across arbitrary edits.
Worker startup, message costs, and browser layout depend on the application and runtime.

Plugin declarations remain explicit trust contracts.
Registration checks and token isolation do not make arbitrary callbacks pure or safely interrupt synchronous JavaScript.
Rendering callbacks and sanitizers still run on each processed update.
Worker termination provides interruption for blocking worker callbacks.
Main-thread fallbacks and asynchronous factories require cooperative application code.

The release retains Node 22.12 or later for Markdown and the existing optional React peer range.
The highlighter retains its separate Node 18 compatibility policy.

## Compatibility checks

The package suite compares stable and legacy runtime identities in ESM and CommonJS.
It also checks strict TypeScript consumers and a reviewed snapshot of public declarations.
`test/package/api-surface.json` records the stable entry signatures, interface members, unions, and error constructors.
The snapshot compares both module formats. It detects surface changes but does not prove behavioral compatibility.
Grammar, sanitizer, resource-limit, native-worker, mounted-application, and DOM checks supply behavioral evidence.

```sh
lpm run build
lpm run test:package
lpm run test:integration
```

For an intentional public API change, review compatibility before updating the snapshot.
The snapshot command is a maintainer action, not part of ordinary checks.

```sh
node test/package/api-surface.mjs --update
```

The unpublished 3.0 candidate now includes optional HTML delta transport and bounded code-block staging.
The raw worker response union adds the negotiated `html-delta` variant.
Consumers with exhaustive raw-message switches must account for this new union member.
The worker sends this variant only after capability negotiation.
The ordinary client result and application outcome unions remain unchanged.
Render-output caching, shared workers, and other framework adapters remain separate work.
These features do not inherit a stability promise before they become documented public APIs.
