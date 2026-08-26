# 测试

> **读者**：贡献者 · 维护者

## 门禁

根脚本 `pnpm check` → `scripts/check.mjs`：

| 步 | 命令 | 耗时量级 | 失败含义 |
| --- | -------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| 1   | `tsc -b --pretty false`                                  | ~2s                  | 类型 / 项目引用断裂 |
| 2   | `eslint <kernel paths>`                                  | ~30s 冷 / ~5s 缓存   | 风格与不安全模式（**不含** 产品壳 `packages/client`、打包 `product-web`） |
| 3   | `vitest run`                                             | ~10s                 | 行为回归 |
| 4   | `vitest run --config vitest.kernel.config.ts --coverage` | ~15s                 | `@xrkseek/kernel` 行/分支/函数/语句 **≥ 90%** |

**勿**在本仓根目录跑 `eslint .`：会把 `apps/cli/product-web/` 里整包 Vite 产物和 `packages/client` fixture 丢进 TypeScript project service，Windows 上 CPU 拉满、IDE 卡死。

日常开发快环（不等 eslint）：

```bash
pnpm exec tsc -b && pnpm test
```

单独命令：

```bash
pnpm build                # tsc -b (required before CLI / Node runs dist)
pnpm test                 # vitest run
pnpm test:web             # Host-serve product-shell hard refresh (needs dist + Chromium)
pnpm test:kernel-coverage
pnpm lint
pnpm format:check
```

## 测例布局

```text
packages/<area>/tests/**/*.test.ts
apps/**/tests/**/*.test.ts          # in pnpm check
apps/web/tests/product-shell-*.e2e.ts        # only pnpm test:web
```

Vitest 别名把 `@xrkseek/*` 指到各包 **src**（见根 `vitest.config.ts`），测试直接打源码。

## 约定

1. **无密钥**：模型面用 `createReplayAdapter([...])`。  
2. **Session 真源**：断言优先对 `deriveMessages(events)` / 事件类型。导入 JSONL 用 `fromJSONL`。非 assemble 路径：每步 LLM request 的 durable history ≡ 派发时日志前缀的 `deriveMessages`（见 `packages/core/agent-loop/tests/request-reconstruction.test.ts`）。  
3. **Protocol**：跨边界未知值用 `parseSessionEvent`，勿只靠宽松的 `isSessionEvent`。  
4. **Exec**：临时目录 `mkdtemp`；测完清理；测路径逃逸与 stub Provider。  
5. **HTTP**：`createHostManager` + `XRK_PORT=0`；测后 `stopAll`。产品壳首屏测在有 `apps/web/dist` 时跑。  
6. **产品壳浏览器硬刷**（不进 `pnpm check`）：`pnpm test:web` → `vitest.web.config.ts` 只收 `product-shell-*.e2e.ts`。Playwright 在 `@xrkseek/web-frontend` 的 devDependency；`pnpm install` **不**下浏览器。要跑时：`pnpm --filter @xrkseek/web-frontend exec playwright install chromium`。  
   **Stream aria golden**（`product-shell-stream-aria.e2e.ts`）：快照在 `apps/web/tests/snapshots/product-shell-stream/settled.expected.md`。有意改聊天区可访问性树时刷新：`XRK_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/product-shell-stream-aria.e2e.ts`（勿带 `refresh` 做 CI 断言）。  
   **社区 client 审计**（`scripts/dsh-community-audit.mjs`）：对照 client 扫描路径与 `dsh-compat` 能力表；先 `pnpm exec tsc -b packages/server/http`。  
   **Cordis fiber**（`packages/server/http/tests/cordis-fiber-runner.test.ts`）：先 `pnpm exec tsc -b packages/server/http`，测试从 **dist** 导入 runner。  
   **遗留 HMR soak**（`apps/web/tests/hmr-live.e2e.ts`）：DSH Cordis scaffold；不进 `pnpm test:web`。产品路径用 `pnpm dev:web` + 硬刷新（[getting-started](./getting-started.md)）。  
7. **Preset**：`@xrkseek/testkit` 的 `makeHarness` 或直接 `createMinimalComposition`。  
8. **Face 闲置 runtime**：共用 `tests/helpers/bare-runtime.ts`。  
9. **Node**：本地/CI 用系统 Node ≥26；勿让 IDE 自带的旧 Node 抢 PATH。

Vitest：一律 `import { describe, expect, it } from "vitest"`（`globals: false`）。

## 扩展覆盖率

目前仅 **kernel** 强制阈值。其他核包可后续仿 `vitest.kernel.config.ts` 加门，勿在未立项时一次抬全仓阈值。

## CI

`.github/workflows/ci.yml`：install + `pnpm check`（无密钥）。与本地门禁一致。

---

# Testing

> **Audience**: Contributors · Maintainers

## Gate

Root script `pnpm check` → `scripts/check.mjs`:

| Step | Command | Rough duration | On failure |
| --- | -------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| 1   | `tsc -b --pretty false`                                  | ~2s                  | Types or project refs broken |
| 2   | `eslint <kernel paths>`                                  | ~30s cold / ~5s cached | Style and unsafe patterns (**excludes** product shell `packages/client` and bundled `product-web`) |
| 3   | `vitest run`                                             | ~10s                 | Behavior regressions |
| 4   | `vitest run --config vitest.kernel.config.ts --coverage` | ~15s                 | `@xrkseek/kernel` lines/branches/functions/statements **≥ 90%** |

**Do not** run `eslint .` at the repo root: it pulls the full Vite product-web bundle and large client fixtures into the TypeScript project service and can peg CPU / freeze the IDE on Windows.

Fast local loop (skip eslint):

```bash
pnpm exec tsc -b && pnpm test
```

Individual commands:

```bash
pnpm build                # tsc -b (required before CLI / Node runs dist)
pnpm test                 # vitest run
pnpm test:web             # Host-serve product-shell hard refresh (needs dist + Chromium)
pnpm test:kernel-coverage
pnpm lint
pnpm format:check
```

## Test layout

```text
packages/<area>/tests/**/*.test.ts
apps/**/tests/**/*.test.ts          # in pnpm check
apps/web/tests/product-shell-*.e2e.ts        # only pnpm test:web
```

Vitest aliases map `@xrkseek/*` to each package **src** (see root `vitest.config.ts`); tests hit source directly.

## Conventions

1. **No secrets**: model surface uses `createReplayAdapter([...])`.  
2. **Session source of truth**: assert on `deriveMessages(events)` / event types first. Import JSONL with `fromJSONL`. Non-assemble path: each step’s LLM request durable history ≡ `deriveMessages` of the log prefix at dispatch (see `packages/core/agent-loop/tests/request-reconstruction.test.ts`).  
3. **Protocol**: parse unknown cross-boundary values with `parseSessionEvent`; do not rely only on loose `isSessionEvent`.  
4. **Exec**: `mkdtemp` temp dirs; clean up; test path escape and stub Providers.  
5. **HTTP**: `createHostManager` + `XRK_PORT=0`; `stopAll` after. Product-shell first-paint tests run when `apps/web/dist` exists.  
6. **Product-shell browser hard refresh** (not in `pnpm check`): `pnpm test:web` → `vitest.web.config.ts` only collects `product-shell-*.e2e.ts`. Playwright is a `@xrkseek/web-frontend` devDependency; `pnpm install` does **not** download browsers. To run: `pnpm --filter @xrkseek/web-frontend exec playwright install chromium`.  
   **Stream aria golden** (`product-shell-stream-aria.e2e.ts`): snapshot at `apps/web/tests/snapshots/product-shell-stream/settled.expected.md`. After intentional chat-region a11y changes, refresh with `XRK_SNAPSHOT=refresh pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/product-shell-stream-aria.e2e.ts` (CI must run without `refresh`).  
   **Community client audit** (`scripts/dsh-community-audit.mjs`): compare scanned client paths with the `dsh-compat` capability table; run `pnpm exec tsc -b packages/server/http` first.  
   **Cordis fiber** (`packages/server/http/tests/cordis-fiber-runner.test.ts`): run `pnpm exec tsc -b packages/server/http` first; tests import the runner from **dist**.  
   **Legacy HMR soak** (`apps/web/tests/hmr-live.e2e.ts`): DSH Cordis scaffold; not in `pnpm test:web`. Product path: `pnpm dev:web` + hard refresh ([getting-started](./getting-started.md)).    
7. **Preset**: `@xrkseek/testkit` `makeHarness` or direct `createMinimalComposition`.  
8. **Face idle runtime**: shared `tests/helpers/bare-runtime.ts`.  
9. **Node**: local/CI use system Node ≥26; do not let an IDE-bundled older Node win PATH.

Vitest: always `import { describe, expect, it } from "vitest"` (`globals: false`).

## Coverage expansion

Only **kernel** has a forced threshold today. Other core packages may later mirror `vitest.kernel.config.ts`; do not raise a monorepo-wide bar without an explicit plan.

## CI

`.github/workflows/ci.yml`: install + `pnpm check` (no secrets). Matches the local gate.
