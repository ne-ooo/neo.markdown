# Contributing

Use LPM 0.76.5 and Node.js 22.12 or later.

## Local checks

Install the locked dependencies:

```sh
lpm install --frozen-lockfile --strict-integrity --no-skills --no-editor-setup --no-security-summary --policy=deny
```

Build a sibling neo.highlight 1.4.0 checkout with LPM before the integration checks.
Set `NEO_HIGHLIGHT_DIR` to select another checkout.
The integration suite checks the highlighter version and tests its built exports.

Run the release gate:

```sh
lpm run release:check
```

Check the local publication contents:

```sh
lpm publish --check --yes
```

The last command checks the package locally and does not upload it.
The release gate includes metadata, types, coverage, package consumers, integration, tree shaking, vulnerabilities, and registry signatures.

## Runtime and release checks

CI checks Node.js 22.12.0, 24, and 26.
Keep `package.json`, each skill version, and the changelog version in agreement.
The tag check requires `v` followed by the exact package version.

`test/integration/highlight-version.json` selects the highlighter release and checkout ref.
The selected highlighter ref must exist on GitHub before automatic Markdown CI can use it.
For an unreleased highlighter candidate, run manual CI with its commit in `highlight_ref`.
The candidate must declare the expected package version.
Complete highlighter checks before Markdown checks and eventual release.

When you update dependencies, keep lockfile integrity, registry signatures, and publication timestamps.
After each update, run both security audits.
Do not substitute a successful install for a successful audit.
The package file allowlist includes documentation, skills, license files, and built output.
