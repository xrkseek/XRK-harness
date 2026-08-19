# Publishing

## Scope

- npm scope: **`@xrkseek`**
- GitHub: `https://github.com/xrkseek/...`
- Packages stay `"private": true` until an explicit release cut

## Strategy

| Phase | State | Notes |
|-------|-------|-------|
| **0 — monorepo** | **当前** | 全 workspace `"private": true`；clone + `pnpm check` 为真源 |
| **1 — first public cut** | 未做 | `@xrkseek/harness` + `@xrkseek/harness-cli` + 依赖叶 `private: false`；changesets；CI tag |

| Track | Packages | Notes |
|-------|----------|-------|
| Core public | `@xrkseek/harness`, `@xrkseek/protocol`, `@xrkseek/kernel` | Stable SDK surface |
| Capability | `exec-*`, `llm-*`, `mcp`, `code-runtime` | Semver; optional peers |
| Apps | `harness-cli` | bin `xrk-harness` |
| Presets | `preset-*` | Composition only |
| **不发布** | `apps/web`, `packages/client/*`, `@xrkseek/cordis*`, stubs | 产品壳与对照薄栈留在 monorepo |

### Phase 1 blockers（诚实）

- [ ] `@changesets/cli` + 版本策略（workspace 内 ~50 包，首批发子集）
- [ ] 逐包 `files` / `exports` 审计（无 `src/` 泄漏、无 `.env`）
- [ ] `private: false` 仅对明确公开的包；presets + leaf deps 同步版本
- [ ] CHANGELOG / GitHub Release 与 `pnpm check` 门禁
- [ ] 文档声明：**npm 用户拿不到** `apps/web/dist`（需 clone 后 `web:build` 组装，或后续单独发 `@xrkseek/web-frontend`）

## Rules

1. Only export through package `exports` — no deep-path public API.
2. Secrets never in published tarballs (`.npmignore` / `files` whitelist).
3. Use changesets (to be added) for version bumps; changelog per package.
4. `pnpm check` must be green before tag.
5. Do not publish incomplete packages as complete (browser settings-shell E2E is Host-serve only — see [status.md](./status.md)).

## Local pack smoke

抽样 pack 三件套（不发布、不改 `private`）：

```bash
pnpm pack:smoke
# 等价：tsc -b + pnpm pack @xrkseek/harness @xrkseek/harness-cli @xrkseek/mcp
# 断言 tarball 含 dist/、无 .env / credentials / host-settings
```

手动 import 烟测：

```bash
pnpm check
pnpm --filter @xrkseek/harness exec node -e "import('@xrkseek/harness').then(console.log)"
```
