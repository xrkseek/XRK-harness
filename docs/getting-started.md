# 快速开始

能力边界见 [status.md](./status.md)。环境变量与落盘路径见 [configuration.md](./configuration.md)。

## 前置

| 项 | 要求 |
|----|------|
| Node.js | **≥ 26** |
| 用法 | **CLI**（`run`）或 **Web**（`web` / `serve`） |

```bash
node -v    # 应 ≥ v26
```

---

## 路径 A：零安装试用（终端用户）

不需要 clone 本仓。工作目录即 **workspace**（任意空文件夹）。

```bash
mkdir my-agent && cd my-agent
npx @xrkseek/harness-cli web
```

浏览器打开提示地址（默认 `http://127.0.0.1:8787`）。

| 步骤 | 说明 |
|------|------|
| 1 | 首次启动会在 **`~/.xrk/`**（可用 `XRK_HOME` 改）创建 `settings.yaml`、会话库等；`--workspace` 只钉项目根 |
| 2 | **无 LLM 密钥**也可打开壳；发话需接模型或 `--preset minimal` + replay |
| 3 | 接真模型：Settings → Models / Credentials，或见下文「接真模型」 |

Registry 安装见 [publishing.md](./publishing.md)（GitHub Packages 须 token）。

---

## 路径 B：从源码（贡献者 / 本仓开发）

```bash
git clone https://github.com/xrkseek/XRK-harness.git
cd XRK-harness
pnpm install
pnpm build
pnpm web:build && pnpm client:bundle && pnpm web:assemble
node apps/cli/dist/bin.js web --workspace .
```

`serve`/`web` 缺 `apps/web/dist` 时会自动跑上述三步组装；打发行版：`pnpm release:stage` / `pnpm release`。

**本仓开发注意**：仓库根下的 `.xrk/` 是**你的本地 workspace 数据**，已在 `.gitignore` 中忽略。示例模板见 `.xrk/*.example` 与根 `.env.example` — **勿把真实密钥提交进 git**（见 [security-checklist.md](./security-checklist.md)）。

无密钥 smoke：

```bash
node apps/cli/dist/bin.js run --preset minimal --prompt "ping"
```

示例工程：[examples/hello-agent](../examples/hello-agent)。

---

## 开发环境 vs 生产环境

| 维度 | 开发（本地） | 生产（对外 Host） |
|------|----------------|-------------------|
| Host 鉴权 | `XRK_API_KEY` **留空** → `/api/*` 免鉴权 | **必须**设非空 `XRK_API_KEY` |
| CORS | 默认 `*` 可接受 | 设 `XRK_CORS_ORIGIN` 为实际前端源 |
| 绑定 | `127.0.0.1:8787` | 反向代理 + TLS；CLI 拒绝 `0.0.0.0` |
| LLM 密钥 | Settings / `.xrk/.credentials.yaml` / env | 同上，密钥**仅运行时**；不入库 |
| Session | `~/.xrk/sessions/sessions.db` | 备份用户主目录；`XRK_HOME` 可改 |
| 源码仓 | `.xrk/` gitignored | 部署机单独 workspace，不带开发机 `.xrk` |

密钥落盘与 env 优先级：[configuration.md](./configuration.md#密钥与凭据)。

---

## 接真模型

三种等价方式（任选其一）：

**1 — 产品壳（推荐）**

启动 `web` 后：Settings → Models 选 provider/model → Credentials 填入 API key（写入 `~/.xrk/.credentials.yaml`）。

**2 — 工作区文件**

```bash
cp .xrk/.credentials.yaml.example .xrk/.credentials.yaml
cp .xrk/settings.yaml.example .xrk/settings.yaml   # 可选
# 编辑 .credentials.yaml，填入 DEEPSEEK_API_KEY 等
npx @xrkseek/harness-cli web --workspace .
```

**3 — 环境变量**

```bash
export DEEPSEEK_API_KEY=sk-...
export XRK_LLM_PRESET=deepseek   # CLI run 快捷路径；serve/web 仍读 settings
npx @xrkseek/harness-cli serve --preset harness --workspace .
```

Brand 与 `apiKeyEnv` 对照：[llm-provider-presets.md](./llm-provider-presets.md)。

---

## MCP（可选）

默认 **deny**。启用：`XRK_MCP_ALLOW=1`，或 Settings → Plugins → MCP。见 [modules/mcp.md](./modules/mcp.md)。

---

## 下一步

| 目标 | 文档 |
|------|------|
| 能力边界 | [status.md](./status.md) |
| 配置全集 | [configuration.md](./configuration.md) |
| HTTP / Face | [http-api.md](./http-api.md) · [host-face.md](./host-face.md) |
| 发布 | [publishing.md](./publishing.md) |
| 排障 | [troubleshooting.md](./troubleshooting.md) |
