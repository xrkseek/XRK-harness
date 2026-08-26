# ADR-0007: 任务流外部运行时

> **读者**：维护者 · 贡献者

- **Status:** Accepted
- **Date:** 2026-08-26
- **Tags:** tongflow, community-plugins, dsh-compat

## 背景

TongFlow 社区画布期望 Host 提供节点 scan · 持久化 · **可选外部分发运行时**（常见为 Python 节点包）。XRK 今日在 `tongflow-node-runtime.ts` 内置 TS 节点（echo · template · json.* · delay），`/tongflow/scan` 可 enrich Python inventory stub，但**不**嵌入厂商 Python 发行版。

[ADR-0001](./0001-typescript-only-host.md) 要求 Host 核心仅 TypeScript；外置 **子进程** 可接受（同 cordis-fiber · MCP）。

## 决策（提议）

### 边界

| 层 | 职责 |
| --- | --- |
| **TS 内置** | `node.echo` 等 · 默认 `engine: "typescript"` |
| **External kind** | `node.external.*` 或 `config.kind === "external"` → 子进程 spawn · JSON stdin/stdout |
| **Python 发行版** | 用户 PATH 上的解释器 + 用户提供的 command；Host 不 vendoring |

### 节点注册

- `/tongflow/scan` 合并 `xrk-tongflow-runtime`（TS）与 `external` slot 声明（诚实 stub 直至 command 配置）。  
- `executeTongflowNode`：`external` 节点读取 `config.command` · `config.args` · `config.timeoutMs`（默认 30s）。  
- 无 command → `incomplete: ["taskflow-external-runtime"]` + TS 不回退 silently。

### 安全

- 子进程 cwd 限制在 workspace / `~/.xrk/tongflow`；env 不注入 Host 密钥。  
- 生产应配合 policy / 人工审批（未来）；当前 bridge 仅本地联调。

## 后果

- Matrix `taskflow-external-runtime` → `full`；`external` 子进程 + 用户 Python bridge（`tongflow-python-bridge.ts`）已能跑。  
- troubleshooting 区分「TS 节点立刻完成」与「external 需 command」。

## 相关

[tongflow-node-runtime.ts](../../packages/server/http/src/dsh-compat/tongflow-node-runtime.ts) · [status.md](../status.md) · [community-plugins.md](../community-plugins.md)

---

# ADR-0007: Task flow external runtime

> **Audience**: Maintainers · Contributors

- **Status:** Accepted
- **Date:** 2026-08-26
- **Tags:** tongflow, community-plugins, dsh-compat

## Context

The TongFlow community canvas expects Host scan · persistence · **optional external node runtimes** (often Python distributions). XRK today ships built-in TS nodes in `tongflow-node-runtime.ts`; `/tongflow/scan` may enrich a Python inventory stub but **does not** embed vendor Python packages.

[ADR-0001](./0001-typescript-only-host.md) keeps the Host core TypeScript-only; external **subprocesses** are acceptable (like cordis-fiber · MCP).

## Decision (proposed)

### Boundary

| Layer | Role |
| --- | --- |
| **Built-in TS** | `node.echo` etc. · default `engine: "typescript"` |
| **External kind** | `node.external.*` or `config.kind === "external"` → subprocess spawn · JSON stdin/stdout |
| **Python distribution** | User PATH interpreter + user-provided command; no vendoring in Host |

### Registration

- `/tongflow/scan` merges `xrk-tongflow-runtime` (TS) with `external` slot declarations (honest stub until command is configured).  
- `executeTongflowNode`: external nodes read `config.command` · `config.args` · `config.timeoutMs` (default 30s).  
- Missing command → `incomplete: ["taskflow-external-runtime"]` without silent TS fallback.

### Security

- Subprocess cwd limited to workspace / `~/.xrk/tongflow`; env must not inject Host secrets.  
- Production should pair with policy / approval (later); bridge is for local integration today.

## Consequences

- Matrix row `taskflow-external-runtime` is `full`; external subprocess + user Python bridge (`tongflow-python-bridge.ts`) work today.  
- Troubleshooting distinguishes “TS nodes finish immediately” vs “external needs command”.

## Related

[tongflow-node-runtime.ts](../../packages/server/http/src/dsh-compat/tongflow-node-runtime.ts) · [status.md](../status.md) · [community-plugins.md](../community-plugins.md)
