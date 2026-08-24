# 兼容器发包边界 / Adapter Package Boundary

> **读者 / Audience**：维护者 / Maintainers  
> （抽出 `@xrkseek/dsh-compat` 时的检查单 / Checklist for extracting `@xrkseek/dsh-compat`）

实现现位于 `@xrkseek/server-http` 的 `src/dsh-compat/`，经 **`@xrkseek/server-http/dsh-compat`** 与根入口再导出。目标：目录可 **整夹迁出** 为独立包而不重写业务模块。

Implementation currently lives under `@xrkseek/server-http` at `src/dsh-compat/`, re-exported via **`@xrkseek/server-http/dsh-compat`** and the package root. The goal is **whole-folder extraction** into a standalone package without rewriting feature modules.

## 已自包含 / Self-Contained (zero edits on extract)

| 模块 / Module | 说明 / Notes |
|------|------|
| `underlying/` | http-json · http-kit · json-store · doc-store · mobile-gate-kit · public-handler — **must not** import `server-http` root |
| `xrk-json-store` · `honest-envelope` · `meta` | Persistence and honest responses |
| `adapter-*` · registry · capability table · matrix | Composition |
| `mobile-access*` · `pocket*` | Mobile-access Host contract (generic) |

## 迁出时改为 peer / 注入 / Convert to peers or injection

| 当前 / Current | 策略 / Strategy |
|------|------|
| `../xrk/plugin-services` · `plugin-mutate` | Inject inventory / mutate ports, or peer the `server-http` xrk surface |
| `create-host-plugin` → `server-loader` | `peerDependency` |
| Face bridges（wallet · tokenledger · sidebar） | Optional injection; Host-side `create*FromFace` |

## 迁出步骤 / Extraction Steps

1. Create `packages/dsh-compat`; move this directory and the `extensions/dsh-compat` entry.  
2. Set `name: @xrkseek/dsh-compat`; peer `server-loader` (and optionally the xrk surface).  
3. Update Host / CLI imports; deprecate root re-exports if needed.  
4. Point the extension dependency at the new package; drop `private` when publishing.  
5. Run `dsh-compat` / mobile-gate / gateway tests and `pnpm check`.

## 红线 / Hard Rules

- Do not import `apps/`, Face runtime, or per-package forks into `underlying/`.  
- New capabilities extend the capability table plus named modules; do not stack adapters for a single community package.  
- Community clients install on the user’s machine; this package only provides the **XRK Host contract**.
