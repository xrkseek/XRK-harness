# 沙箱后端

> **读者**：集成者 · 贡献者

`@xrkseek/exec-sandbox`：进程 argv 隔离缝。工具仍走同一 `SandboxService` Definition（`wrapArgv` / `confine`）；换 Provider 不改 bash / PTY 接线。

## 内置 Provider

| Kind | 行为 |
|------|------|
| `workspace`（默认） | `WorkspaceSandbox(DenyList(Permissive))` — cwd 狱 + 危险 argv deny |
| `docker` | DenyList → `docker run --rm -i -v <root>:/workspace`（默认 `--network none`） |
| `bwrap` | DenyList → Linux `bwrap --bind` 工作区（非 Linux 失败关闭） |
| `windows` | DenyList → Codex 式 helper 二进制（写隔离）；缺 helper 失败关闭 |

## 启用 Docker

| 项 | 值 |
|----|-----|
| `XRK_SANDBOX_BACKEND` | `docker` |
| `XRK_SANDBOX_DOCKER_IMAGE` | 必填，如 `node:22-bookworm` |
| `XRK_SANDBOX_DOCKER_NETWORK` | `none`（默认）或 `bridge` |
| `XRK_SANDBOX_DOCKER_BIN` | 可选，默认 `docker` |

Harness 也可传 `sandboxBackend: "docker"` · `sandboxDockerImage`，或直接注入 `sandbox: SandboxService`。

本机需可用 Docker CLI；confine 只改写 argv，不代为 `docker pull`。Windows 路径会映射为 Docker Desktop 风格（`C:\a\b` → `/c/a/b`）。

## 启用 bubblewrap

| 项 | 值 |
|----|-----|
| `XRK_SANDBOX_BACKEND` | `bwrap` |
| `XRK_SANDBOX_BWRAP_BIN` | 可选，默认 `bwrap` |

仅 Linux；缺二进制时 spawn 失败（fail closed，不退回裸 argv）。

## 启用 Windows 写隔离

| 项 | 值 |
|----|-----|
| `XRK_SANDBOX_BACKEND` | `windows` |
| `XRK_SANDBOX_WINDOWS_HELPER` | **必填**，Codex 式 helper 二进制 |
| `XRK_SANDBOX_WINDOWS_MODE` | `workspace-write`（默认）· `read-only` · `danger-full-access` |
| `XRK_SANDBOX_WINDOWS_NETWORK` | `none`（默认）或 `bridge` / `on` |

权限模型对照 Codex `codex-rs/windows-sandbox-rs`（AppContainer + 受限令牌 · 只读/可写根 · 默认禁网），但**不移植那棵 Rust 服务**：本仓只做 TS 侧桥接，把权限模型映射成 helper argv：

```
<helper> --mode <mode> --cwd <hostCwd> [--network|--no-network]
         --writable-root <p>... --read-only-root <p>... -- <argv...>
```

- `read-only` → 工作区只读、无可写根
- `workspace-write` → 工作区可写（+ 额外 `writableRoots`）
- `danger-full-access` → 工作区可写（preset 本就不套 confine）
- cwd 越出工作区根 → `SANDBOX_CWD`
- 非 Windows 主机 → `SANDBOX_PLATFORM`；**无 helper** → `SANDBOX_UNAVAILABLE`

**没有运行时一律诚实失败**，绝不静默退回裸 argv。可用 `windowsSandboxCapability()` 在不抛错的前提下探测可用性（供状态/诊断文本使用）。

## 与 permission preset

`sandbox/mode` 仍由 session 事件控制是否套 confine（`workspace-write` 套、`danger-full-access` 不套）。Docker / bwrap / windows 是 **confine 的实现**，不是第四档 permission。

---

# Sandbox backends

> **Audience**: Integrators · Contributors

`@xrkseek/exec-sandbox` is the process-argv confinement seam. Tools keep the same `SandboxService` Definition (`wrapArgv` / `confine`); swapping Providers does not change bash / PTY wiring.

## Built-in Providers

| Kind | Behavior |
|------|----------|
| `workspace` (default) | `WorkspaceSandbox(DenyList(Permissive))` — cwd jail + dangerous argv deny |
| `docker` | DenyList → `docker run --rm -i -v <root>:/workspace` (default `--network none`) |
| `bwrap` | DenyList → Linux `bwrap --bind` of the workspace (fail closed off Linux) |
| `windows` | DenyList → Codex-style helper binary (write isolation); fail closed without it |

## Enable Docker

| Item | Value |
|------|-------|
| `XRK_SANDBOX_BACKEND` | `docker` |
| `XRK_SANDBOX_DOCKER_IMAGE` | required, e.g. `node:22-bookworm` |
| `XRK_SANDBOX_DOCKER_NETWORK` | `none` (default) or `bridge` |
| `XRK_SANDBOX_DOCKER_BIN` | optional, default `docker` |

Harness may pass `sandboxBackend: "docker"` · `sandboxDockerImage`, or inject `sandbox: SandboxService`.

A working Docker CLI is required; confine only rewrites argv and does not `docker pull`. Windows host paths map to Docker Desktop form (`C:\a\b` → `/c/a/b`).

## Enable bubblewrap

| Item | Value |
|------|-------|
| `XRK_SANDBOX_BACKEND` | `bwrap` |
| `XRK_SANDBOX_BWRAP_BIN` | optional, default `bwrap` |

Linux only; missing binary fails at spawn (fail closed — no bare argv fallback).

## Enable Windows write isolation

| Item | Value |
|------|-------|
| `XRK_SANDBOX_BACKEND` | `windows` |
| `XRK_SANDBOX_WINDOWS_HELPER` | **required**, Codex-style helper binary |
| `XRK_SANDBOX_WINDOWS_MODE` | `workspace-write` (default) · `read-only` · `danger-full-access` |
| `XRK_SANDBOX_WINDOWS_NETWORK` | `none` (default) or `bridge` / `on` |

The permission model mirrors Codex `codex-rs/windows-sandbox-rs` (AppContainer + restricted token · read-only vs writable roots · network off by default), but we deliberately **do not port that Rust service**. This repository only ships the TS-side bridge that maps the model onto helper argv:

```
<helper> --mode <mode> --cwd <hostCwd> [--network|--no-network]
         --writable-root <p>... --read-only-root <p>... -- <argv...>
```

- `read-only` → workspace read-only, no writable roots
- `workspace-write` → workspace writable (+ extra `writableRoots`)
- `danger-full-access` → workspace writable (the preset already skips confine)
- cwd outside the workspace root → `SANDBOX_CWD`
- non-Windows host → `SANDBOX_PLATFORM`; **no helper** → `SANDBOX_UNAVAILABLE`

**No runtime means honest failure** — never a silent fallback to bare argv. Use `windowsSandboxCapability()` to probe availability without throwing (for status / diagnostics text).

## vs permission presets

`sandbox/mode` still decides whether confine runs (`workspace-write` yes, `danger-full-access` no). Docker / bwrap / windows are **confine implementations**, not a fourth permission tier.
