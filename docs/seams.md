# Exec seams

> **读者**：贡献者 · 能力叶作者

### 三元：Definition / Provider / Consumer

| 层 | 职责 | 示例（fs） |
|----|------|------------|
| **Definition** | 稳定接口 | `FsService`（read/write/edit/stat/mkdir/**glob/grep**） |
| **Provider** | 具体后端 | `createFsLocalProvider({ root })` |
| **Consumer** | 工具 / Agent | `createFsTools(fs)` — 不直接 `import "node:fs"` |

```ts
const tools = createFsTools(stubFs); // Swap Provider; tool schema stays unchanged
```

例外（对齐 Hermes `dynamic_schema_overrides`）：生成类 Consumer（`image_generate` · `video_generate`）可按 Provider `capabilities()` 门控参数面。工具登记 `ToolDefinition.dynamicSchema`；`materializeTools` 在每步 LLM catalog 快照时合并覆盖（抛错则保留静态字段）。Host 在 Settings / Credentials 变更时 `invalidateAgents` 重建 composition；同一 Agent 生命周期内 live `capabilities()` 变化也会在下一次 materialize 反映到 schema。

内置搜索（无 shell `rg`）：`fs.glob` / `fs.grep` → 工具名 `glob` / `grep`。`read_file` 对 `.pdf` / `.docx` / `.xlsx` / `.ipynb` 在 `read` 内转成文本（扫描版 PDF 无文本层时明确说明），不另开工具名。Office→PDF 是侧栏预览的独立 Provider（`/sidebar/file?preview=pdf`），不走 `read`。

Web：`@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`；Provider 匿名 HTTP + Tavily/Brave（有密钥）或 **parallel-free → duckduckgo**；Consumer `createWebTools` + `createBrowserTools`。规格：[web-tools.md](./web-tools.md)。

桌面 computer-use：`@xrkseek/exec-computer-use` — Definition `ComputerUseService`；Provider memory / Windows UIA（`XRK_COMPUTER_USE=1`）；Consumer `createComputerUseTools`。与 `browser_*` 分开。规格：[computer-use.md](./computer-use.md)。

策展记忆：`@xrkseek/exec-memory` — Definition `CuratedMemoryStore`（别名缝 `MemoryProvider`）；默认 `file`，可选 `http` / `sqlite` 样板；Consumer `createCuratedMemoryTools` → `memory`。系统提示带策略段与会话开始冻结快照。回合后启发式写入；会话结束 Phase1 巩固 + 可选 Phase2 LLM（`phase2Llm`）。与 Mnemon / memory-embed 分开。规格：[curated-memory.md](./curated-memory.md)。

语音 Host：`@xrkseek/exec-voice` — Definition `VoiceService`；Provider memory / OpenAI HTTP（`XRK_VOICE`）；Consumer `createVoiceTools`（TTS · STT · live broker）。mic/WebRTC 在客户端，浏览器传输 `@xrkseek/exec-voice/browser`。规格：[voice.md](./voice.md)。

图像生成：`@xrkseek/exec-image-gen` — Definition `ImageGenService`（含可选 `capabilities()`）；Provider memory / OpenAI Images / FAL / xAI（`XRK_IMAGE_GEN`）；Consumer `createImageGenTools` → `image_generate`（`dynamicSchema` ← caps）。规格：[image-gen.md](./image-gen.md)。

视频生成：`@xrkseek/exec-video-gen` — Definition `VideoGenService`（`create` · `get` · `content` 异步作业 + 可选 `capabilities()`）；Provider memory / OpenAI Videos / FAL / xAI（`XRK_VIDEO_GEN`）；Consumer `createVideoGenTools` → `video_generate`（`dynamicSchema` ← caps）。规格：[video-gen.md](./video-gen.md)。

视频理解：`@xrkseek/exec-video-analyze` — Definition `VideoAnalyzeService`（整段 `video_url` → 文本）；Provider memory / OpenAI-compatible chat（`XRK_VIDEO_ANALYZE`）；Consumer `createVideoAnalyzeTools` → `video_analyze`。与 `browser_vision`（页截图）分界。规格：[video-analyze.md](./video-analyze.md)。

会话遥测：`@xrkseek/session-telemetry` — Definition `SessionTelemetrySink`；Provider memory / OTLP HTTP logs；Consumer `wrapStoreForSessionTelemetry`。规格：[session-telemetry.md](./session-telemetry.md)。

密钥 / OS keyring：`@xrkseek/secrets` — Definition `SecretStore`；Provider memory / OS keyring（可选 `keytar`）；`redactSecrets` / `wrapLoggerForSecrets` 统一日志脱敏。Face 默认仍写 `~/.xrk/.credentials.yaml`；`XRK_SECRETS_BACKEND=keyring` 时双写并启动时补水。规格见本页依赖图与 [configuration.md](./configuration.md)。

LSP：`@xrkseek/exec-lsp` — Definition `LspService`；Provider stdio JSON-RPC；Consumer `createLspTools`。规格：[lsp-tools.md](./lsp-tools.md)。

PTY：`@xrkseek/exec-pty` — Definition `TerminalSessionService`；Provider `node-pty@1.2.0-beta.15`（NAPI prebuild）+ bash + process-inspector；Consumer `createPtyTools`（六件套）。规格：[pty-tools.md](./pty-tools.md)。

SSH（本地 Host、远端 cwd）：`@xrkseek/exec-ssh` — Settings 通用「远程」或 `XRK_SSH_HOST` + `XRK_SSH_WORKSPACE`（env 旁路）时换接 `FsService` / `SubprocessService`（及可选 `run_code`）；无模型侧 `ssh_*` 工具。Hermes 式 `ssh … bash -lc`；路径为远端 POSIX 坐标。启用时 Host 走 `createSshExecutionWorldReady`（BatchMode `true` 预检，失败拒启；`XRK_SSH_SKIP_PROBE=1` 可跳过）；`xrkh doctor` 有 `ssh-remote`。Web `host.listDirectory` / `host.createDirectory` 走同一 SSH 会话；Agent / 侧栏交互式 PTY、`host.openPath` / OS 选目录在远端模式下关闭（`host.describe.remoteExecution` · `canPty: false` · `canOpenPath: false`）。改 Settings 后需重启 Host。云任务 / Codex Noise `exec-server` **未做**。

### 依赖图

```text
exec-fs  (independent)
exec-web (independent)
exec-computer-use (independent; Windows UIA opt-in)
exec-memory (independent; MEMORY.md / USER.md under XRK_HOME/memories)
exec-voice (independent; XRK_VOICE memory|1)
exec-image-gen (independent; XRK_IMAGE_GEN memory|1)
exec-video-gen (independent; XRK_VIDEO_GEN memory|1)
exec-video-analyze (independent; XRK_VIDEO_ANALYZE memory|1)
exec-lsp (independent)
exec-pty (optional node-pty@1.2.0-beta.15 prebuild)
exec-subprocess
    └── exec-shell   → createBashTools
exec-ssh → exec-fs · exec-subprocess · code-runtime（可选 run_code）
exec-sandbox         → createSandboxWrapGuard → pipeline guards
@xrkseek/secrets     (independent; redact + optional OS keyring)
```

### Sandbox / jobs

`wrapArgv(argv) → argv'`（同步）；spawn 路径用可取消的 `confine(argv, cwd?, signal?)`。  
`createSandboxStack`：`workspace`（默认 DenyList+cwd 狱）· `docker` · `bwrap` — 同一 `SandboxService` Definition。规格：[sandbox.md](./sandbox.md)。

ExecEnvironment（换整套 fs/subprocess，对标 Hermes terminal environments / MemoryProvider 缝）：`@xrkseek/exec-environment` — `local` 默认；HTTP serverless 样板 `createHttpExecEnvironment`（`GET /health` · `POST /v1/exec` · `POST /v1/fs`）；`resolveExecEnvironment` / `XRK_EXEC_ENVIRONMENT`。**Host 已接线**：SSH 优先（`createSshExecutionWorldReady`），否则 `XRK_EXEC_ENVIRONMENT=http` 时用 HTTP world 的 `fs`+`subprocess`（`xrkh doctor` 探测 `/health`）。**不是** `createSandboxStack` 后端，也不替代 SSH。
Shell `startJob` 在 prepare（confine）之前武装超时，准备时间计入同一 deadline（DSH）。  
后台：`startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md)。

扩展纪律：先 Definition → Provider → Consumer；单测 stub Provider + 逃逸用例。

---

# Exec Seams

> **Audience**: Contributors · Capability-leaf authors

### Triad: Definition / Provider / Consumer

| Layer | Role | Example (fs) |
|-------|------|--------------|
| **Definition** | Stable interface | `FsService` (read/write/edit/stat/mkdir/**glob/grep**) |
| **Provider** | Concrete backend | `createFsLocalProvider({ root })` |
| **Consumer** | Tools / agents | `createFsTools(fs)` — do not import `node:fs` directly |

```ts
const tools = createFsTools(stubFs); // Swap Provider; tool schema stays unchanged
```

Exception (Hermes `dynamic_schema_overrides`): generation Consumers (`image_generate` · `video_generate`) may gate parameters from Provider `capabilities()`. Tools register `ToolDefinition.dynamicSchema`; `materializeTools` merges overrides into each LLM catalog snapshot (throws → keep static fields). Host `invalidateAgents` on Settings / Credentials rebuilds composition; live `capabilities()` changes also surface on the next materialize within the same Agent lifetime.

Built-in search (no shell `rg`): `fs.glob` / `fs.grep` → tool names `glob` / `grep`. `read_file` converts `.pdf` / `.docx` / `.xlsx` / `.ipynb` to text inside `read` (scanned PDFs with no text layer say so); no extra tool name. Office→PDF is a separate sidebar preview Provider (`/sidebar/file?preview=pdf`), not `read`.

Web: `@xrkseek/exec-web` — Definition `WebSearch`/`WebFetch`; Provider anonymous HTTP + Tavily/Brave (when keyed) or **parallel-free → duckduckgo**; Consumer `createWebTools` + `createBrowserTools` + optional `createBrowserVaultTools` (opaque Face credential handles). Spec: [web-tools.md](./web-tools.md).

Desktop computer-use: `@xrkseek/exec-computer-use` — Definition `ComputerUseService`; Provider memory / Windows UIA (`XRK_COMPUTER_USE=1`); Consumer `createComputerUseTools`. Capture text includes `mode:` + `elementToken=` (SOM honesty without screenshot overlay yet). Separate from `browser_*`. Spec: [computer-use.md](./computer-use.md).

Curated memory: `@xrkseek/exec-memory` — Definition `CuratedMemoryStore` (seam alias `MemoryProvider`); default `file`, optional `http` / `sqlite` samples; Consumer `createCuratedMemoryTools` → `memory`. System prompt carries policy + session-start freeze. After-turn heuristics; session-end Phase1 + optional Phase2 LLM (`phase2Llm`). Separate from Mnemon / memory-embed. Spec: [curated-memory.md](./curated-memory.md).

Voice Host: `@xrkseek/exec-voice` — Definition `VoiceService`; Provider memory / OpenAI HTTP (`XRK_VOICE`); Consumer `createVoiceTools` (TTS · STT · live broker). Mic/WebRTC on the client, browser transport `@xrkseek/exec-voice/browser`. Spec: [voice.md](./voice.md).

Image generation: `@xrkseek/exec-image-gen` — Definition `ImageGenService` (optional `capabilities()`); Provider memory / OpenAI Images / FAL / xAI (`XRK_IMAGE_GEN`); Consumer `createImageGenTools` → `image_generate` (`dynamicSchema` ← caps). Spec: [image-gen.md](./image-gen.md).

Video generation: `@xrkseek/exec-video-gen` — Definition `VideoGenService` (`create` · `get` · `content` async job + optional `capabilities()`); Provider memory / OpenAI Videos / FAL / xAI (`XRK_VIDEO_GEN`); Consumer `createVideoGenTools` → `video_generate` (`dynamicSchema` ← caps). Spec: [video-gen.md](./video-gen.md).

Video analysis: `@xrkseek/exec-video-analyze` — Definition `VideoAnalyzeService` (whole-clip `video_url` → text); Provider memory / OpenAI-compatible chat (`XRK_VIDEO_ANALYZE`); Consumer `createVideoAnalyzeTools` → `video_analyze`. Distinct from `browser_vision` (page screenshot). Spec: [video-analyze.md](./video-analyze.md).

Session telemetry: `@xrkseek/session-telemetry` — Definition `SessionTelemetrySink`; Provider memory / OTLP HTTP logs; Consumer `wrapStoreForSessionTelemetry`. Spec: [session-telemetry.md](./session-telemetry.md).

Secrets / OS keyring: `@xrkseek/secrets` — Definition `SecretStore`; Provider memory / OS keyring (optional `keytar`); `redactSecrets` / `wrapLoggerForSecrets` for unified log redaction. Face still defaults to `~/.xrk/.credentials.yaml`; `XRK_SECRETS_BACKEND=keyring` dual-writes and hydrates on boot. See [configuration.md](./configuration.md).

LSP: `@xrkseek/exec-lsp` — Definition `LspService`; Provider stdio JSON-RPC; Consumer `createLspTools`. Spec: [lsp-tools.md](./lsp-tools.md).

PTY: `@xrkseek/exec-pty` — Definition `TerminalSessionService`; Provider `node-pty@1.2.0-beta.15` (NAPI prebuild) + bash + process-inspector; Consumer `createPtyTools` (six-tool set). Spec: [pty-tools.md](./pty-tools.md).

SSH (local Host, remote cwd): `@xrkseek/exec-ssh` — when Settings General → Remote or `XRK_SSH_HOST` + `XRK_SSH_WORKSPACE` (env bypass) are set, swaps `FsService` / `SubprocessService` (and optional `run_code`); no model-facing `ssh_*` tools. Hermes-style `ssh … bash -lc`; paths are remote POSIX coordinates. When enabled, Host uses `createSshExecutionWorldReady` (BatchMode `true` probe, fail-closed; `XRK_SSH_SKIP_PROBE=1` skips); `xrkh doctor` reports `ssh-remote`. Web `host.listDirectory` / `host.createDirectory` ride the same SSH session; Agent / sidebar interactive PTY and `host.openPath` / OS folder picker are off in remote mode (`host.describe.remoteExecution` · `canPty: false` · `canOpenPath: false`). Host restart required after Settings changes. Cloud tasks / Codex Noise `exec-server` are **not done**.

### Dependency graph

```text
exec-fs  (independent)
exec-web (independent)
exec-computer-use (independent; Windows UIA opt-in)
exec-memory (independent; MEMORY.md / USER.md under XRK_HOME/memories)
exec-voice (independent; XRK_VOICE memory|1)
exec-image-gen (independent; XRK_IMAGE_GEN memory|1)
exec-video-gen (independent; XRK_VIDEO_GEN memory|1)
exec-video-analyze (independent; XRK_VIDEO_ANALYZE memory|1)
exec-lsp (independent)
exec-pty (optional node-pty@1.2.0-beta.15 prebuild)
exec-subprocess
    └── exec-shell   → createBashTools
exec-ssh → exec-fs · exec-subprocess · code-runtime (optional run_code)
exec-sandbox         → createSandboxWrapGuard → pipeline guards
@xrkseek/secrets     (independent; redact + optional OS keyring)
```

### Sandbox / jobs

`wrapArgv(argv) → argv'` (sync); spawn paths use cancellable `confine(argv, cwd?, signal?)`.  
`createSandboxStack`: `workspace` (default DenyList+cwd jail) · `docker` · `bwrap` — same `SandboxService` Definition. Spec: [sandbox.md](./sandbox.md).

ExecEnvironment (swap fs/subprocess world; Hermes terminal environments / MemoryProvider-style seam): `@xrkseek/exec-environment` — `local` default; HTTP serverless sample `createHttpExecEnvironment` (`GET /health` · `POST /v1/exec` · `POST /v1/fs`); `resolveExecEnvironment` / `XRK_EXEC_ENVIRONMENT`. **Host-wired**: SSH first (`createSshExecutionWorldReady`), else `XRK_EXEC_ENVIRONMENT=http` swaps world fs/subprocess (`xrkh doctor` probes `/health`). **Not** a `createSandboxStack` backend and **not** a replacement for SSH.
Shell `startJob` arms timeout before prepare (confine); preparation counts toward the same deadline (DSH).  
Background: `startJob` / `listJobs` / `killJob` — [shell-jobs.md](./shell-jobs.md).

Extension discipline: Definition → Provider → Consumer first; unit-test with a stub Provider plus escape cases.
