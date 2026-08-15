# DeepSeek Harness Web UI（深读 · lc17）

> **调研 · MIT · 未移植。** 许可：DeepSeek Harness 根 `LICENSE`（MIT，Copyright DeepSeek）。  
> **产品立场（用户锁定）：不要薄实现；要优越、最强轨；先学透再编码。**  
> 设计：[../design/2026-08-15-providers-and-web-ui.md](../design/2026-08-15-providers-and-web-ui.md)

---

## 0. 立场（已修订 · 废除薄壳）

| 原则 | 含义 |
|------|------|
| **废除** | 「短期自研薄 React 壳接 REST」——那是降级产品，不是过渡策略 |
| **最强轨** | 保留 DeepSeek **完整 client 壳**（boot · Cordis loader · slots · 全 ui-* 能力面）；本仓做 **Host 兼容面**，让浏览器仍说 DeepSeek RPC + 双 WS |
| 可合法使用 | MIT：NOTICE + 文件头；可 npm 依赖 `@deepseek-ai/*` |
| 完整学习 | boot / 最小花名册 / `RpcMethodMap` / mux 事件 / session.prompt 语义 —— 未勾选 §8 不开码 |
| ADR-0002 | Cordis **仅作浏览器 UI 组合运行时**（依赖上游包或归因移植）；**禁止**把 Cordis 并成本仓 agent/kernel |

---

## 1. 仓库地图（本地 deepseek-harness）

### 1.1 入口极薄（对 · 产品入口应保持薄）

`apps/web`：`new AppWebEntry(el).run()`；**不能**裸 Vite（无 `__DSH_BOOT__`）。主机 `dsh web` 注入 boot 图。

### 1.2 壳内核（必须学透）

`packages/client/web` · `AppWebEntry`（`boot.tsx`）：

1. `parseBootManifest(window.__DSH_BOOT__)`  
2. `ClientModuleSystem` + `registerStatic(app-shell)` + modules 自举  
3. 先渲染 loading（`AppRoot`）；**壳不 value-import 插件**（失败时加载页仍可用）  
4. 并行 prefetch `immediately` 层 + 挂 Cordis `Loader`，注入 `loader.internal = modules`  
5. 为每个插件行 + app-shell 建 entry → `loader.await()` → **全 fiber ACTIVE 扫表** → `settled` 一次切换真 UI  

精华：组合决策在 **主机 boot 图**，不在壳；settle 门禁 fail-loud。

`PLATFORM_MODULES`：react / cordis / ui-slots / web-react / primitives / attachment / schema-form —— seeding、external、vite alias 同一真源。

### 1.3 最小可亮对话的花名册（来自 `assembled-boot.ts`）

**Immediately（须先 factory 注册）：**

| id | 角色 |
|----|------|
| `dsh-typert-registry` | 类型/拦截登记 |
| `dsh-client-connection` | `/api` + 双 WS |
| `dsh-api-gateway` / `dsh-api-remotes` | RPC 路由面 |
| `dsh-client-ui-settings` | `settingsScope`（缺则 theme/locale pending → layout 永不亮） |
| `dsh-client-runtime` | 客户端运行时 |
| `dsh-client-ui-theme` / `dsh-client-locale` | 主题与文案 |

**随后（inject 等待）：** layout → sidebar → conversation → tool / workflow-run / workspace / trajectory / …

最强轨 = 以 **完整 web composition**（或与上游对齐的超集）为目标，不是砍到「一个 textarea」。

### 1.4 Host / Connection

| 包 | 角色 |
|----|------|
| `host/webserver` | 裸 HTTP + upgrade 表 |
| `host/frontend-static` | SPA + index tap |
| `client/connection` | unary HTTP + **只下行** `events.mux` / `events.host`；loopback/`trustedHosts` 栅栏 |
| `host/apiproxy` | **UI 契约真源**：`RpcMethodMap` |

---

## 2. UI 契约真源：`RpcMethodMap`（最强轨核心）

浏览器不直接调本仓 REST。完整壳假设这些 unary（摘自 `apiproxy/.../rpc-map.ts`）：

**Session：** `list` · `search` · `create` · `history` · `models` · `selectModel` · `rename` · `fork` · `prompt` · `attachment` · `updateQueue` · `cancel`  

**Subagent / Host / Workspace / Skill / AgentPreset / Goal / Settings / Credentials / LLM：** 见上游 map（`llm.providers` · `llm.models` · `llm.discoverModels` 等）

**下行：** mux（session 事件 + projection/view）· host 事件流；握手要两条 WS + `host.describe`。

`session.prompt` 携带 rpcId → 用户消息事件可回传以对齐乐观 UI——本仓适配必须尊重，不能「admit 完事」。

---

## 3. 与本仓的阻抗 → 最强解法

| DeepSeek Web | XRK 现状 | 最强轨动作 |
|--------------|----------|------------|
| Cordis 插件树 + slots | preset + ToolRegistry | **保留 UI 侧 Cordis**（npm）；agent 侧仍本仓 kernel |
| `session.*` RPC | REST admit/chat | 新包：**XRK Host Face** 实现 RpcMethodMap 子集→全集，内部调 session/LLM |
| 双 WS mux/host | HTTP 倾倒 | Face 提供同形 WS（或兼容帧），事件从 session_event 投影 |
| settings/credentials | env/host config | Face 映射；密钥仍不入库 |
| agentPreset | presets | `agentPreset.list/select` ↔ minimal/harness/server（+ 扩展） |
| `llm.*` | 单 adapter | Face ↔ **Provider Registry**（见 lc18） |

### 三条路（已裁决）

| 方案 | 评价 |
|------|------|
| A. 薄 React 壳接 REST | **否决** — 永远追不上壳能力 |
| B. 改每一个 ui-* 去调 XRK REST | **否决** — 分叉地狱，无法跟上游 |
| **C. Host Face 说 DeepSeek 协议，UI 尽量不改** | **最强轨** — 升级本仓 Host，保住完整壳 |

「直接拉 apps/web」在 **C** 下是对的：壳 + boot + ui-* 依赖上游；本仓写 Face + boot 图 + Logo/品牌 + NOTICE。

---

## 4. 实现分期（仍是最强轨，不是薄实现）

能力按 **契约覆盖度** 分期，UI 始终是完整壳：

| 阶段 | Face 必须能撑起的 UI |
|------|----------------------|
| **U0 契约深读** | 画完：prompt 往返、history 分页、mux 帧、projection、取消/队列 |
| **U1 对话主路径** | create/list/history/prompt/cancel + mux 最小帧 + host.describe；layout/sidebar/conversation/tool 可用 |
| **U2 工作区与设置** | workspace* · settings* · credentials* · models/selectModel |
| **U3 对等增强** | subagent · goal · skill · agentPreset 创作 · jobs · 附件上限 |
| **U4 打磨** | HMR 可选、E2E 抽样、品牌、信任栅栏 + `XRK_API_KEY` 并存 |

每一阶段：**完整壳启动** + Face 返回诚实错误（未实现方法显式失败），禁止假空壳 UI。

---

## 5. 品牌 / 许可

- [ ] `NOTICE`：DeepSeek MIT + 上游 URL  
- [ ] title / favicon / Logo → XRK（`xrkseek`）  
- [ ] 修改文件头保留 Copyright DeepSeek  
- [ ] README：UI 源自 deepseek-harness；协议经 XRK Host Face  

---

## 6. 精华 / 糟粕

**取：** 两阶段 boot · settle 扫表 · 壳自给加载页 · slots · PLATFORM_MODULES · 信任栅栏文档 · RpcMethodMap 单真源 · assembled 花名册  

**不取：** 薄壳当产品 · 无 Face 硬绑 REST · Cordis 当 agent kernel · 丢掉 API Key · 假装未实现 RPC 已通  

---

## 7. 供应商

完整壳的模型选择器走 `llm.providers` / `session.models` —— 必须对接 **最强 Provider Registry**（[provider-registry.md](./provider-registry.md) · [provider-matrix.md](./provider-matrix.md)），不是写死一家。

---

- [x] 画出：conversation 发消息 → RPC → mux → 本仓事件（lc19 + host-face）  
- [x] 规格：`docs/host-face.md`  
- [x] ADR-0002 附录已接受；design 方案 C  
- [ ] 本地 `dsh web` 跑通（环境许可时）  
- [ ] DeepSeek SessionEvent 字段同构表（U1 夹具）  
- [ ] Logo 资源  

---

## 9. 参考

- Upstream：`apps/web` · `packages/client/web` · `connection` · `host/apiproxy` · `apps/web/tests/assembled-boot.ts`  
- Agent Notes：websocket-downlink-carrier · api-browser-trust-boundary  
- 本仓：[../http-api.md](../http-api.md) · [../design/2026-08-15-providers-and-web-ui.md](../design/2026-08-15-providers-and-web-ui.md)
