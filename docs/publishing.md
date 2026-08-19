# Publishing

## Scope

- npm scope: **`@xrkseek`**
- GitHub: `https://github.com/xrkseek/...`
- Packages stay `"private": true` until an explicit release cut

## Strategy

| Track | Packages | Notes |
|-------|----------|-------|
| Core public | `@xrkseek/harness`, `@xrkseek/protocol`, `@xrkseek/kernel` | Stable SDK surface |
| Capability | `exec-*`, `llm-*`, `code-runtime` | Semver; optional peers |
| Apps | `harness-cli` | bin `xrk-harness` |
| Presets | `preset-*` | Composition only |

## Rules

1. Only export through package `exports` — no deep-path public API.
2. Secrets never in published tarballs (`.npmignore` / `files` whitelist).
3. Use changesets (to be added) for version bumps; changelog per package.
4. `pnpm check` must be green before tag.
5. Do not publish incomplete packages as complete (browser settings-shell E2E is Host-serve only — see [status.md](./status.md)).

## Local pack smoke

```bash
pnpm check
pnpm --filter @xrkseek/harness exec node -e "import('@xrkseek/harness').then(console.log)"
```
