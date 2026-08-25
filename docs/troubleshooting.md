# 排障

> **读者**：终端用户 · 集成者 · 贡献者

按症状定位。仍不通时对照 [status.md](./status.md) 是否落在「未稳 / 未做」，以及 [testing.md](./testing.md) 门禁是否绿。

## Node · pnpm

| 症状 | 处理 |
|------|------|
| `engines` / `Unsupported environment`，Node 过旧 | 换系统 Node **≥26**；勿让 IDE 自带 Node 抢 PATH（Windows：`where node`） |
| 本机没有 pnpm / 版本不对 | `npm install -g pnpm@11.22.0`（与根 `packageManager` 对齐）；**不要用 Corepack** |
| 误装 yarn / 用 npm 装本仓依赖 | 删掉误装的 `node_modules`，改用上面同版 pnpm 再 `pnpm install` |
| `ERR_PNPM_IGNORED_BUILDS`（esbuild / node-pty 等） | 根 `pnpm-workspace.yaml` → `allowBuilds` 已放行；缺项就补 `true` 后重装 |
| `pnpm check` 第一步 `tsc` 失败 | 先 `pnpm install`；看项目引用断裂包 |

## CLI / Host

| 症状 | 处理 |
|------|------|
| `serve` 无产品壳 / `GET /` 404 | 发行包应有 `product-web/`。源码：`pnpm web:build && pnpm client:bundle && pnpm web:assemble`。`XRK_WEB_DIST` 指错则报错 |
| 绑定失败 / 拒绝 `0.0.0.0` | CLI 故意拒绝全网卡；用 `127.0.0.1` 或本机局域网地址 |
| `/api/*` 401 | 设置了 `XRK_API_KEY` 但请求未带 Bearer / `x-api-key` |
| session busy `409` | 同 session 已有 turn 在飞；等结束或换 sessionId |
| 无 LLM 回复 / 适配器错 | `minimal` 用 replay；真模型检查 **Settings → Models / Credentials**（或 `.xrk/.credentials.yaml` / brand `apiKeyEnv`；[configuration.md](./configuration.md)） |

## 密钥 / 凭据

| 症状 | 处理 |
|------|------|
| `unknown credential ref: <ROUTE>_API_KEY` | 自定义提供方写入密钥时，Face 须先有该路由的 `apiKeyEnv`（创建提供方会写进 `llm-pi-ai`）。升级到含此修复的版本后，对已存在的提供方再点一次保存密钥即可 |
| 误把 `.xrk/.credentials.yaml` 提交进 git | 立刻在 provider 控制台**轮换**已泄漏 key；`git rm --cached .xrk/.credentials.yaml`；确认 `.gitignore` 含该路径；未推送时用 `git reset --soft origin/main` 去掉含密钥的提交 |
| 克隆仓后没有 `.xrk/` | 正常。首次 `web`/`serve` 自动创建；或 `cp .xrk/.credentials.yaml.example .xrk/.credentials.yaml` |
| Settings 写了 key 仍无回复 | 看 `agent-default-model` 是否与凭据 brand 匹配；同名 env 是否覆盖为空 |

## 产品壳 / 浏览器

| 症状 | 处理 |
|------|------|
| `pnpm test:web` skip | 无完整 `apps/web/dist`（缺 index / boot / plugins） |
| `test:web` 失败且提到 Chromium | `pnpm --filter @xrkseek/web-frontend exec playwright install chromium` |
| 浏览器打不开本机 Host / 请求走代理 | 清掉 `HTTP_PROXY` · `HTTPS_PROXY` · `ALL_PROXY`（或设 `NO_PROXY=localhost,127.0.0.1`）后再测 |
| Vite 直接 `serve`/`dev` 被拒 | 产品入口是 `xrkh web`（亦 `xrk-harness web`）/ Host serve，不是裸 Vite |
| `EADDRINUSE` / 端口占用 | 先 `xrkh restart`（只停本机 XRK Host）。若是其它程序占端口：自行结束该进程，或换 `--port`。`--force` 同样**拒绝**杀掉非 XRK 进程 |
| serve 终端几乎没输出 | 默认只打启动横幅；加 `--verbose` 或 `XRK_LOG=debug` 看 `/api` 与 MCP 挂载 |

## MCP

| 症状 | 处理 |
|------|------|
| 启动打 `mcp parked …`（info） | 正常：未开「允许连接」。**Settings → Plugins → MCP** 打开 Allow connect 并保存 |
| connect 被拒 / `connectFailures` | 已 allow 仍失败 → 在 Settings MCP 卡核对 `command` / PATH / `args` / `cwd` |
| mutate 后不热挂载 | 若设了 `XRK_MCP_SERVERS`（Host/CI 旁路），env 赢过文件 → `applies: restart`，需重启 Host；日常改服务器列表用 Settings 即可热挂载 |
| 工具消失 / gave-up | 进程重连帽满或 `reconnect.enabled: false`；看 Face `connectFailures` / `connected[].status` |
| stdio 命令找不到 | 在 Settings → Plugins → MCP 检查 PATH 与 `command`/`args`/`cwd` |

见：[modules/mcp.md](./modules/mcp.md) · [policy.md](./policy.md)。

## 工具诚实失败（不是 bug）

| 症状 | 处理 |
|------|------|
| 工具表只有 fs、没有 `web_search` | 会话徽章是 **Minimal** 时工具面就是 fs。改选 **Harness**（或新建 Harness 会话）。Host `--preset server` 与 harness 工具相同，不会单独出「Server」工具面。见 [profiles.md](./profiles.md) |
| Agent 改不了 `~/.xrk` / Settings | 正常：harness home 不在会话 workspace 内。改设置用产品 Settings；要让 Agent 改某目录，把该目录加成工作区 |
| `web_search` 执行失败 | Settings → Plugins → Web search 钉了无效提供方，或钉了 Tavily/Brave 却无密钥；默认无 key 走 parallel-free，失败回退 DuckDuckGo |
| `lsp` 失败 | 无 `XRK_LSP_COMMAND` |
| `terminal_open` 失败 | 无可用 `node-pty` native |
| 要交互式浏览器（`browser_*`） | **未做**；用 `web_fetch` 读静态页 |

下列在**未配置**时仍可能出现在工具表，execute 回明文错误（见上表）。

## 社区 client 插件

| 症状 | 处理 |
|------|------|
| `plugin add` 后壳无变化 | 须 **`xrkh restart`**（或停再起 `web`）；`xrkh plugin list` 确认包在 `~/.xrk/plugins` |
| 点插件设置项内容报错 / 像「消失」 | 对话框应仍打开；内容区若见 `[data-slot-error]` 是插件渲染崩溃（短错误文案 + `window.__XRK_DIAG__.recent`；`?xrkLog=debug` 打栈）。壳保留导航项。`dsh-cost-meter` / `dsh-mnemon` 依赖的 Face / mnemon RPC（单层 `getState`、`provider-services` 返回 catalog） |
| 浏览器诊断偏少 | 控制台看 `HH:mm:ss.sss level  ns  msg`；或 `window.__XRK_DIAG__.recent`。级别：`?xrkLog=debug` / `localStorage.XRK_LOG=debug` / `window.__XRK_LOG__` |
| 面板 `incomplete` / `*-host` | 对照 [community-plugins.md](./community-plugins.md)；多数 wire 已由 Host 适配层桥接，少数大规模外部发行版见「**待补 / Planned**」 |
| IM OAuth 后仍无厂商推送 | 本地 `message.send` / webhook 已可用；云端长连接网关见 status「**未做 / Not done**」与 [community-plugins.md](./community-plugins.md)「待补」 |
| TongFlow 任务立刻完成 | 内置节点已执行；复杂 Python 独占节点见 status「**未做 / Not done**」 |
| Cordis 面板 `fiber-unavailable` | 包需 `host.mjs` 或 staged `client.js`；见 `dynamicCordisRunner/runHostHalf` 与 [community-plugins.md](./community-plugins.md) |

本机审计：`node scripts/dsh-community-audit.mjs`。安装步骤：[getting-started.md](./getting-started.md#社区-client-插件可选--community-client-plugins-optional)。

## Session / 仓

| 症状 | 处理 |
|------|------|
| 重启丢会话 | Host 未设 `XRK_SESSIONS_DIR` 且非 CLI serve 默认路径 → 内存仓 |
| 会话库损坏 / 打不开 | 看 `~/.xrk/sessions/sessions.db`（或 `XRK_SESSIONS_DIR`）；Host 须 `stop`/`close` 后再删文件（Windows） |

见：[session.md](./session.md)。

## 打包 / 发布

| 症状 | 处理 |
|------|------|
| `npx` 找不到包 | 确认 npmjs 上已发 `@xrkseek/harness-cli`；或下 GitHub Release tarball。见 [publishing.md](./publishing.md) |
| `pnpm release:stage` 失败 | 先 `pnpm build`；确认 `apps/web/dist/index.html`；deploy 需能解析 CLI workspace 依赖 |

## 仍需深入

- 架构与依赖边：[architecture.md](./architecture.md)
- Face 能力面：[host-face.md](./host-face.md)
- 社区 client：[community-plugins.md](./community-plugins.md)
- 安全清单：[security-checklist.md](./security-checklist.md)
- 包内文件地图：[modules/](./modules/README.md)

---

# Troubleshooting

> **Audience**: End users · Integrators · Contributors

Diagnose by symptom. If it still fails, check whether [status.md](./status.md) marks the surface **unstable / not done**, and whether [testing.md](./testing.md) gates are green.

## Node · pnpm

| Symptom | Remedy |
|------|------|
| `engines` / `Unsupported environment`, Node too old | Use system Node **≥26**; do not let an IDE-bundled Node preempt PATH (Windows: `where node`) |
| Missing or wrong pnpm | `npm install -g pnpm@11.22.0` (align with root `packageManager`); **do not use Corepack** |
| Installed with yarn or npm by mistake | Remove the mistaken `node_modules`, then `pnpm install` with the pinned pnpm |
| `ERR_PNPM_IGNORED_BUILDS` (esbuild / node-pty, etc.) | Root `pnpm-workspace.yaml` → `allowBuilds` already allows these; add missing `true` entries and reinstall |
| First `tsc` step of `pnpm check` fails | Run `pnpm install` first; check broken project references |

## CLI / Host

| Symptom | Remedy |
|------|------|
| `serve` has no product shell / `GET /` 404 | Release packages should include `product-web/`. From source: `pnpm web:build && pnpm client:bundle && pnpm web:assemble`. A wrong `XRK_WEB_DIST` errors |
| Bind failure / rejects `0.0.0.0` | CLI intentionally rejects all-interfaces bind; use `127.0.0.1` or a LAN address |
| `/api/*` 401 | `XRK_API_KEY` is set but the request lacks Bearer / `x-api-key` |
| session busy `409` | Another turn is in flight on the same session; wait or use another sessionId |
| No LLM reply / adapter error | Use replay for `minimal`; for live models check **Settings → Models / Credentials** (or `.xrk/.credentials.yaml` / brand `apiKeyEnv`; [configuration.md](./configuration.md)) |

## Secrets / credentials

| Symptom | Remedy |
|------|------|
| `unknown credential ref: <ROUTE>_API_KEY` | When saving a custom-provider key, Face must already have that route’s `apiKeyEnv` (creating the provider writes it into `llm-pi-ai`). After upgrading to a build with this fix, save the key again for existing providers |
| Accidentally committed `.xrk/.credentials.yaml` | Immediately **rotate** leaked keys at the provider console; `git rm --cached .xrk/.credentials.yaml`; confirm `.gitignore` covers the path; if not pushed, `git reset --soft origin/main` to drop the secret commit |
| No `.xrk/` after clone | Expected. First `web`/`serve` creates it; or copy from the `.example` template |
| Key saved in Settings but no reply | Check that `agent-default-model` matches the credential brand; check whether a same-named env var overrides to empty |

## Product shell / browser

| Symptom | Remedy |
|------|------|
| `pnpm test:web` skip | Incomplete `apps/web/dist` (missing index / boot / plugins) |
| `test:web` fails mentioning Chromium | `pnpm --filter @xrkseek/web-frontend exec playwright install chromium` |
| Browser cannot reach local Host / traffic via proxy | Clear `HTTP_PROXY` · `HTTPS_PROXY` · `ALL_PROXY` (or set `NO_PROXY=localhost,127.0.0.1`) and retry |
| Bare Vite `serve`/`dev` rejected | Product entry is `xrkh web` (also `xrk-harness web`) / Host serve, not bare Vite |
| `EADDRINUSE` / port in use | Try `xrkh restart` first (stops only the local XRK Host). For other holders: stop that process yourself or change `--port`. `--force` also **refuses** to kill non-XRK processes |
| Almost no serve terminal output | Default prints only the startup banner; use `--verbose` or `XRK_LOG=debug` for `/api` and MCP mount logs |

## MCP

| Symptom | Remedy |
|------|------|
| Startup logs `mcp parked …` (info) | Expected when Allow connect is off. Enable Allow connect under **Settings → Plugins → MCP** and save |
| Connect rejected / `connectFailures` | If already allowed, check `command` / PATH / `args` / `cwd` in the Settings MCP card |
| No hot-mount after mutate | If `XRK_MCP_SERVERS` is set (Host/CI bypass), env wins over file → `applies: restart`; restart Host. Day-to-day server edits via Settings hot-mount |
| Tools disappear / gave-up | Process reconnect cap exhausted or `reconnect.enabled: false`; inspect Face `connectFailures` / `connected[].status` |
| stdio command not found | Check PATH and `command`/`args`/`cwd` under Settings → Plugins → MCP |

See: [modules/mcp.md](./modules/mcp.md) · [policy.md](./policy.md).

## Honest tool failures (not bugs)

| Symptom | Remedy |
|------|------|
| Tool table is fs-only, no `web_search` | A **Minimal** session badge exposes fs only. Switch to **Harness** (or create a Harness session). Host `--preset server` shares the harness tool surface and does not expose a separate “Server” tool set. See [profiles.md](./profiles.md) |
| Agent cannot edit `~/.xrk` / Settings | Expected: harness home is outside the session workspace. Change settings in the product Settings UI; to let the Agent edit a directory, add that directory as a workspace |
| `web_search` execute fails | Settings → Plugins → Web search pinned an invalid provider, or Tavily/Brave without keys; default without keys is parallel-free, then DuckDuckGo fallback |
| `lsp` fails | Missing `XRK_LSP_COMMAND` |
| `terminal_open` fails | No usable `node-pty` native |
| Need interactive browser (`browser_*`) | **Not done**; use `web_fetch` for static pages |

The tools below may still appear in the tool table when **unconfigured**; execute returns a plain-text error (see table above).

## Community client plugins

| Symptom | Remedy |
|------|------|
| Shell unchanged after `plugin add` | Must **`xrkh restart`** (or stop/restart `web`); confirm the package with `xrkh plugin list` under `~/.xrk/plugins` |
| Plugin settings content errors / appears to “vanish” | The dialog should stay open; `[data-slot-error]` in the content pane means plugin render crash (short error + `window.__XRK_DIAG__.recent`; `?xrkLog=debug` for stacks). The shell keeps the nav item. Face / mnemon RPC used by `dsh-cost-meter` / `dsh-mnemon` (single-layer `getState`; `provider-services` returns catalog) |
| Sparse browser diagnostics | Console format `HH:mm:ss.sss level  ns  msg`, or `window.__XRK_DIAG__.recent`. Level: `?xrkLog=debug` / `localStorage.XRK_LOG=debug` / `window.__XRK_LOG__` |
| Panel `incomplete` / `*-host` | See [community-plugins.md](./community-plugins.md); most wires are bridged by the Host adapter layer; a few large external distributions are **Planned** |
| No vendor push after IM OAuth | Local `message.send` / webhook work; cloud long-lived IM gateway is **Not done** / **Planned** |
| TongFlow tasks finish immediately | Built-in nodes run; complex Python-exclusive nodes are **Not done** |
| Cordis panel `fiber-unavailable` | Package needs `host.mjs` or staged `client.js`; see `dynamicCordisRunner/runHostHalf` and [community-plugins.md](./community-plugins.md) |

Local audit: `node scripts/dsh-community-audit.mjs`. Install steps: [getting-started.md](./getting-started.md#社区-client-插件可选--community-client-plugins-optional).

## Session / store

| Symptom | Remedy |
|------|------|
| Sessions lost on restart | Host has no `XRK_SESSIONS_DIR` and is not on the CLI serve default path → in-memory store |
| Session DB corrupt / will not open | Inspect `~/.xrk/sessions/sessions.db` (or `XRK_SESSIONS_DIR`); on Windows, `stop`/`close` Host before deleting the file |

See: [session.md](./session.md).

## Packaging / publishing

| Symptom | Remedy |
|------|------|
| `npx` cannot find the package | Confirm `@xrkseek/harness-cli` is published on npmjs, or download the GitHub Release tarball. See [publishing.md](./publishing.md) |
| `pnpm release:stage` fails | Run `pnpm build` first; confirm `apps/web/dist/index.html`; deploy must resolve CLI workspace dependencies |

## Dig deeper

- Architecture and dependency edges: [architecture.md](./architecture.md)
- Face capability surface: [host-face.md](./host-face.md)
- Community clients: [community-plugins.md](./community-plugins.md)
- Security checklist: [security-checklist.md](./security-checklist.md)
- In-package file map: [modules/](./modules/README.md)
