# 测试 / Testing

> **读者 / Audience**：贡献者 · 维护者 / Contributors · Maintainers

## 门禁 / Gate

根脚本 `pnpm check` → `scripts/check.mjs`：

| 步 / Step | 命令 / Command | 耗时量级 / Rough duration | 失败含义 / On failure |
| --- | -------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| 1   | `tsc -b --pretty false`                                  | ~2s                  | 类型 / 项目引用断裂 / Types or project refs broken |
| 2   | `eslint <kernel paths>`                                  | ~30s 冷 / ~5s 缓存   | 风格与不安全模式（**不含** 产品壳 `packages/client`、打包 `product-web`） |
| 3   | `vitest run`                                             | ~10s                 | 行为回归 / Behavior regressions |
| 4   | `vitest run --config vitest.kernel.config.ts --coverage` | ~15s                 | `@xrkseek/kernel` 行/分支/函数/语句 **≥ 90%** |

**勿**在本仓根目录跑 `eslint .`：会把 `apps/cli/product-web/` 里整包 Vite 产物和 `packages/client` fixture 丢进 TypeScript project service，Windows 上 CPU 拉满、IDE 卡死。

**Do not** run `eslint .` at the repo root: it pulls the full Vite product-web bundle and large client fixtures into the TypeScript project service and can peg CPU / freeze the IDE on Windows.

日常开发快环（不等 eslint） / Fast local loop：

```bash
pnpm exec tsc -b && pnpm test
```

单独命令 / Individual commands：

```bash
pnpm build                # tsc -b (required before CLI / Node runs dist)
pnpm test                 # vitest run
pnpm test:web             # Host-serve product-shell hard refresh (needs dist + Chromium)
pnpm test:kernel-coverage
pnpm lint
pnpm format:check
```

## 测例布局 / Test layout

```text
packages/<area>/tests/**/*.test.ts
apps/**/tests/**/*.test.ts          # in pnpm check
apps/web/tests/product-shell-*.e2e.ts        # only pnpm test:web
```

Vitest 别名把 `@xrkseek/*` 指到各包 **src**（见根 `vitest.config.ts`），测试直接打源码。

Vitest aliases map `@xrkseek/*` to each package **src** (see root `vitest.config.ts`); tests hit source directly.

## 约定 / Conventions

1. **无密钥 / No secrets**：模型面用 `createReplayAdapter([...])`。  
2. **Session 真源**：断言优先对 `deriveMessages(events)` / 事件类型。导入 JSONL 用 `fromJSONL`。非 assemble 路径：每步 LLM request 的 durable history ≡ 派发时日志前缀的 `deriveMessages`（见 `packages/core/agent-loop/tests/request-reconstruction.test.ts`）。  
3. **Protocol**：跨边界未知值用 `parseSessionEvent`，勿只靠宽松的 `isSessionEvent`。  
4. **Exec**：临时目录 `mkdtemp`；测完清理；测路径逃逸与 stub Provider。  
5. **HTTP**：`createHostManager` + `XRK_PORT=0`；测后 `stopAll`。产品壳首屏测在有 `apps/web/dist` 时跑。  
6. **产品壳浏览器硬刷**（不进 `pnpm check`）：`pnpm test:web` → `vitest.web.config.ts` 只收 `product-shell-*.e2e.ts`。Playwright 在 `@xrkseek/web-frontend` 的 devDependency；`pnpm install` **不**下浏览器。要跑时：`pnpm --filter @xrkseek/web-frontend exec playwright install chromium`。  
7. **Preset**：`@xrkseek/testkit` 的 `makeHarness` 或直接 `createMinimalComposition`。  
8. **Face 闲置 runtime**：共用 `tests/helpers/bare-runtime.ts`。  
9. **Node**：本地/CI 用系统 Node ≥26；勿让 IDE 自带的旧 Node 抢 PATH。

Vitest：一律 `import { describe, expect, it } from "vitest"`（`globals: false`）。

## 扩展覆盖率 / Coverage expansion

目前仅 **kernel** 强制阈值。其他核包可后续仿 `vitest.kernel.config.ts` 加门，勿在未立项时一次抬全仓阈值。

Only **kernel** has a forced threshold today. Do not raise a monorepo-wide bar without an explicit plan.

## CI

`.github/workflows/ci.yml`：install + `pnpm check`（无密钥）。与本地门禁一致。

`.github/workflows/ci.yml`: install + `pnpm check` (no secrets). Matches the local gate.
