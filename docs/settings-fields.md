# Settings fields（由 schema 生成）

> 本文由 `node scripts/dump-settings-fields.mjs` 从 `packages/server/face/src/settings-schemas.ts` 生成，不要手改。
> 增删字段先改 schema，再重跑脚本；文档与 `settings_get` / `settings_mutate` / Settings 卡片读的是同一份定义。

共 32 个 namespace。`applies=live` 保存即生效；`restart` 需重启 Host。

## 快速地图

| 想做什么 | namespace | 关键字段 |
| --- | --- | --- |
| 接一个 OpenAI 兼容网关 | `llm-pi-ai` | `providers.<id>.baseURL` · `credentialRef` · `models` |
| 换默认模型 / 思考档 | `agent-default-model` | `provider` · `model` · `reasoningEffort` |
| 语音听写 / 朗读 | `asr` · `tts` | `enabled` · `engine` · `baseUrl` · `downloadProxy` · `voice` |
| 浏览器自动化 | `browser` | `mode`（http / cdp）· `cdpUrl` |
| 桌面 GUI | `computer-use` | `mode`（off / uia / background） |
| 沙箱 / 权限 | `sandbox` · `permission` | `backend` · `defaultPreset` · `extraWritableRoots` |
| 外部 MCP | `mcp` | `servers[]` · `allowConnect` |
| 定时任务 | `cron` | `enabled` |
| 生图 / 生视频 / 看视频 | `image-gen` · `video-gen` · `video-analyze` | `mode` · `baseUrl` · `model` |
| 联网搜索 | `web-search` | `provider` + 各家的 key |
| 界面语言 / 主题 | `locale` · `ui-theme` | `preference` · `fontSize` |

## `ui-onboarding`

默认值：`{}`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| — | — | — | 见 schema 源码（非 `Schema.object` 平铺） |

## `locale`

默认值：`{ preference: "en" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| — | — | — | 见 schema 源码（非 `Schema.object` 平铺） |

## `ui-theme`

默认值：`{ preference: "system", fontSize: FACE_FONT_SIZE_DEFAULT }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| — | — | — | 见 schema 源码（非 `Schema.object` 平铺） |

## `ui-presence`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | When false, hide the ball; chat / Status / tools keep working. |
| `shape` | ...MEMBER_SHAPES | `"blob"` |  |
| `color` | ...MEMBER_COLORS | `"cream"` |  |
| `kit` | ...MEMBER_KITS | `"none"` |  |
| `kitHat` | string | `"none"` |  |
| `kitGlasses` | string | `"none"` |  |
| `kitHeld` | string | `"none"` |  |
| `overlayHat` | string | `""` |  |
| `overlayGlasses` | string | `""` |  |
| `overlayHeld` | string | `""` |  |
| `stickers` | string | `"[]"` |  |
| `moodId` | string | `"16"` | Operator (Boss) work mood — emotion-ball id shown on Overview left seat. |
| `statusLine` | string | `""` | Free-text status under the Boss ball (e.g. 摸鱼中). |
| `bossNickname` | string | `""` | Optional Boss call-name for `<seat_identity>` (e.g. 阿凯). |
| `moodAt` | number | `0` |  |
| `statusPresets` | string | `DEFAULT_BOSS_STATUS_PRESETS_JSON` | JSON string[] of tip chips; edited in Plugins → 表情球. |
| `titleScheme` | unknown | — | Seat titles (独立于表情球外观开关). Preset id + three editable strings; empty custom fields fall back to the preset. |
| `titleBoss` | string | `""` | Empty = follow titleScheme × UI locale; non-empty = free-form any language. |
| `titleManager` | string | `""` |  |
| `titleAgent` | string | `""` |  |

## `permission`

默认值：`permissionSettingsBase()`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| — | — | — | 见 schema 源码（非 `Schema.object` 平铺） |

## `agent-default-model`

默认值：`{}`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | — |  |
| `model` | string | — |  |
| `reasoningEffort` | unknown | — |  |

## `sunflower-free`

默认值：`{ openCodeProxy: "", kiloProxy: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `openCodeProxy` | string | — |  |
| `kiloProxy` | string | — |  |

## `agent-presets`

默认值：`{ default: "harness" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `default` | ...HOST_CLI_PRESET_IDS | — |  |

## `llm-deepseek`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `apiKeyEnv` | string | — |  |
| `baseURL` | string | — |  |
| `proxy` | string | — | Optional HTTP(S) proxy for every model on this provider (model `proxy` wins). |
| `reasoningEffort` | off \| low \| high \| max | — |  |
| `defaultContextWindow` | number | — |  |
| `maxTokens` | number | — |  |
| `models` | array | — |  |

## `llm-pi-ai`

默认值：`buildPiAiCatalogBase()`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `providers` | object (map) | — |  |
| `providerOrder` | string | — | Settings → Models list order (`llm.providers` ids, including brands like `deepseek-official` that are not under `providers.*`). Unknown ids ignored; missing ids append in discovery order. |

`providers.<id>`（接一个 OpenAI 兼容网关就填这张表）：

| 子字段 | 类型 | 说明 |
| --- | --- | --- |
| `baseURL` | string | 网关根地址，例如 `http://127.0.0.1:8788/v1` |
| `apiKeyEnv` | string | 凭据槽名，例如 `WORKBUDDY_API_KEY`（值存在 `.credentials.yaml`，不在 `settings.yaml`） |
| `api` | enum | 协议：`openai-chat` / `openai-responses` / `anthropic` 等 `PI_AI_PROTOCOLS` |
| `displayName` | string | Settings → Models 里显示的名字 |
| `proxy` | string | 该 provider 的出口代理；模型级 `proxy` 优先 |
| `models[]` | array | 每项 `{ id, name, contextWindow, maxTokens, … }`；`id` 必填 |

顺序：先 `settings_mutate` 声明 provider + `apiKeyEnv`，再经 Settings 密钥框（或 credentials 工具）写该槽的值。手改 `.credentials.yaml` 运行期不重载 —— Host 只在启动时把文件名映射到 provider。

## `bash`

默认值：`{ maxOutputBytes: 64_000, foregroundYieldMs: 30_000 }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `timeoutMs` | number | — |  |
| `maxOutputBytes` | number | `64_000` | Per-stream capture cap (DSH bash-local default 64_000). |
| `foregroundYieldMs` | number | `30_000` | Foreground bash yield (ms): return early with job id while the process keeps running. Codex unified_exec clamps 250–30_000. |

## `agent-loop`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `maxParallelToolCalls` | number | `5` | Cap parallel tool settles in one step. Product default 5. |
| `maxSteps` | number | `200` | Max LLM steps per user turn (tool rounds). Harness/server default 200. |
| `autoContinueOnMaxTokens` | boolean | `true` | Resume automatically when a model stops at its output token cap. Product default on: a truncated mid-task reply should keep going without a manual nudge (Settings can still turn it off). |
| `autoContinueMaxRounds` | number | `10` | Maximum automatic continuations per turn (independent of maxSteps). |
| `toolOrder` | string | — | DSH toolOrder: tool name list with exactly one `' '` rest marker. Empty / omit → lexicographic wire order. Editable via Settings → Plugins. |
| `toolSettle` | parallel \| serial | `"parallel"` | Tool settle mode. `parallel` (default) uses `isConcurrencySafe` barriers; `serial` forces exclusive execution for every call. |
| `llmRetryMaxRetries` | number | `30` | Max provider retries within one LLM step (`0` disables). Omit → kernel default (30). |
| `compactionStrategy` | unknown | — | Soft-budget strategy family (DSH prune→summary posture). Soft ceiling numbers live on Models catalog (`softBudgetMaxTokens`). `prune-summary` (default) · `prune-only` · `summary-only` · `off`. |
| `softBudgetTriggerPercent` | number | `90` | Soft-budget pre-trigger as percent of softMax (Codex ~90%). Soft ceiling numbers stay on Models; this only advances when auto-compact starts. |
| `compactRecentMaxTokens` | number | `20_000` | Cap for post-compact `recent` tokens (Codex user-tail budget). Default 20_000. |
| `softBudgetPeelAttempts` | number | `3` | Extra keep-halving passes after the standard two soft-budget summaries. |
| `toolResultMaxInlineBytes` | number | `64_000` | Spill plain-text tool results over this UTF-8 byte ceiling (DSH spill-policy). `0` disables spill (not recommended). Default 64_000. |
| `maxConcurrentModelSessions` | number | `5` | Default max live sessions per provider/model route (parent + subagent count equally). Per-model `maxConcurrentSessions` in the Models catalog overrides this. Routes are independent (A/x ≠ B/x). |

## `web-search`

默认值：`{ provider: "auto" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `provider` | unknown | — |  |
| `region` | string | — |  |

## `session-telemetry` （需重启）

默认值：`{ mode: "off" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | off \| memory \| otlp | `"off"` |  |
| `endpoint` | string | — | OTLP/HTTP logs endpoint when mode is `otlp`. |

## `sandbox`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `backend` | workspace \| docker \| bwrap \| windows | — |  |
| `dockerImage` | string | — |  |
| `dockerNetwork` | none \| bridge | `"none"` |  |
| `windowsMode` | unknown | — |  |

## `computer-use`

默认值：`{ mode: "off" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | off \| uia \| background | `"off"` |  |

## `browser`

默认值：`{ mode: "http", cdpUrl: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | http \| cdp | `"http"` |  |
| `cdpUrl` | string | `""` |  |

## `cron`

默认值：`{ enabled: true }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` |  |

## `asr`

默认值：`{ enabled: false, engine: "local", baseUrl: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` |  |
| `engine` | local \| openai | `"local"` |  |
| `baseUrl` | string | `""` |  |
| `downloadProxy` | string | `""` | Optional HTTP(S) proxy for asset downloads, e.g. `http://127.0.0.1:7897`. Empty means direct. This key must stay declared here: `Schema.object` strips undeclared keys, so a field the card saves but the schema omits is silently dropped on write — and the downloader then reads `undefined` and goes direct while the UI still shows the address the user typed. |

## `tts`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` |  |
| `engine` | edge \| local \| openai | `"edge"` |  |
| `baseUrl` | string | `""` |  |
| `voice` | string | `""` | Chinese (or default) voice id: an Edge short name, an OS voice name, or a provider voice id. `text_to_speech` uses this row for `zh` clips. |
| `voiceEn` | string | `"en-US-AriaNeural"` | English voice id, used for `en` clips and for `auto` calls whose text reads as English. Defaults to an Edge English voice so an out-of-the-box Host never reads English with a Chinese mouth; `local` users point it at an installed English voice instead. |
| `language` | auto \| zh \| en | `"auto"` | Spoken language for `text_to_speech`: `auto` sniffs the text. |
| `model` | string | `""` | OpenAI-compatible TTS model; ignored by edge / local. |

## `image-gen`

默认值：`{ mode: "off", baseUrl: "", model: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | unknown | — |  |
| `baseUrl` | string | `""` |  |
| `model` | string | `""` |  |

## `video-gen`

默认值：`{ mode: "off", baseUrl: "", model: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | unknown | — |  |
| `baseUrl` | string | `""` |  |
| `model` | string | `""` |  |

## `video-analyze`

默认值：`{ mode: "off", baseUrl: "", model: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | off \| openai | `"off"` |  |
| `baseUrl` | string | `""` |  |
| `model` | string | `""` |  |

## `curated-memory`

默认值：`{ enabled: true, phase2Llm: false }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` |  |
| `phase2Llm` | boolean | `false` | Session-end Phase2 LLM extract into MEMORY.md (needs a resolvable session LLM). Env `XRK_CURATED_MEMORY_PHASE2=1` also enables. |

## `a2a-inbound`

默认值：`{ enabled: false, sessionId: "", timeoutMs: 0 }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Enable Agent Card + POST /a2a message/send (Face session inject). |
| `sessionId` | string | `""` | Pin Face session id; empty → a2a-<contextId>. |
| `timeoutMs` | number | `0` | Wait for assistant body (ms); 0 = default 120000. |

## `auto-review`

默认值：`{ enabled: false, classifierUrl: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | When true, classify each tool call before execute (ask → Face approval). |
| `classifierUrl` | string | `""` | POST endpoint for verdict JSON; empty = heuristic. |

## `memory-embed`

默认值：`{ url: "", collection: "", embeddingsUrl: "", embeddingsModel: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `url` | string | `""` | HTTP base for sidecar /search · /health; empty = embedded host only. |
| `collection` | string | `""` | Optional collection / index name passed to sidecar /search. |
| `embeddingsUrl` | string | `""` | OpenAI-compatible embeddings base (…/v1 or …/v1/embeddings). |
| `embeddingsModel` | string | `""` | Embeddings model id (default text-embedding-3-small when URL set via env). |

## `external-agent`

默认值：`{ acpAgent: "", codexAppServer: "", claudeCode: "" }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `acpAgent` | string | `""` | Spawn command for `runtime=acp` (e.g. `xrkh acp`). Empty = require env. |
| `codexAppServer` | string | `""` | Spawn command for `runtime=app-server` (default `codex app-server` when empty). |
| `claudeCode` | string | `""` | Spawn command for `runtime=claude-code` (default `claude` when empty; Host adds `-p`). |

## `ssh-remote` （需重启）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `host` | string | `""` |  |
| `workspace` | string | `""` | Absolute remote cwd (POSIX `/…`). |
| `user` | string | `""` |  |
| `port` | number | `22` |  |
| `keyPath` | string | `""` | Local path to OpenSSH identity file (not the key material). |

## `workspace-inject`

默认值：`{ injectMaxChars: DEFAULT_WORKSPACE_INJECT_MAX_CHARS }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `injectMaxChars` | number | — | Total character budget for rules + skills catalog inject (per turn). |

## `ui-conversation`

默认值：`{ busyEnter: "queue", toolsDefaultExpanded: false }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `busyEnter` | queue \| steer | — |  |
| `toolsDefaultExpanded` | boolean | `false` |  |

## `mcp`

默认值：`{ servers: [], allowConnect: false }`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `servers` | array | `[]` | MCP server 列表：`{ serverName, command?, url?, args?, cwd?, cwdAllowWorkspace?, env? }`（与 `host-settings.json` 同形） |
| `allowConnect` | boolean | `false` | 允许 Host 主动连接新声明的 server |

## 不在 settings.yaml 里的配置

| 位置 | 内容 | 用什么改 | 注意 |
| --- | --- | --- | --- |
| `{XRK_HOME}/host-settings.json` | LLM provider 定义（`llm.providers`）、MCP server SoT、默认模型 | Settings 卡片 / `settings_mutate` ns `llm-pi-ai` · `mcp` | 与 `settings.yaml` 双源，别手改错文件 |
| `{XRK_HOME}/.credentials.yaml` | 密钥槽（`XRK_VOICE_OPENAI_KEY`、`<PROVIDER>_API_KEY`…） | Settings 的密钥框 / credentials 工具 | **Host 只在启动时映射文件名到 provider**：先声明 provider，再保存密钥；手改文件运行期不重载 |
| `{XRK_HOME}/settings.yaml` | 上述 namespace 的用户层 | `settings_mutate`（推荐）或 Settings UI | 手改后需重载；未知字段会被 schema 丢弃 |
| 环境变量 `XRK_*` | CI / 旁路开关（`XRK_VOICE`、`XRK_HOME`、`XRK_IMAGE_GEN`…） | 启动命令 | 不写盘；与 settings 冲突时按各模块注释的优先级 |

