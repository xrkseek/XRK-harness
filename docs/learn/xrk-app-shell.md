# XRK AppShell（BootComposition · SlotRegistry chrome · lc22）

> **调研 · 取精华 · 自研。** 不是 Cordis Loader，不是 DeepSeek `ui-*` npm 花名册复刻。  
> 产品入口：`apps/web` 默认 `AppShellEntry`；`?console=1` 仍挂 Face console 验证器。

---

## 0. 立场

| 不做 | 要做 |
|------|------|
| Cordis / `ClientModuleSystem` / 远程 plugin URL 加载 | 本地 factories + `BootGate` 全有或全无 |
| 假 DeepSeek `dsh-client-ui-*` 包名冒充壳 | XRK 自有 roster：`connection` · `face-client` · `layout-slots` |
| 未 settle 就画 chrome | settle 前失败 → fail-loud 报告，不挂面板 |
| 薄单列 console 当产品壳 | `chrome.sidebar` / `chrome.main` / `chrome.status` 三栏 |

上游精华（DeepSeek AppWebEntry）：prefetch → 全 fiber ACTIVE → `settled` → 一次切真 UI。  
XRK 转换：`activateBootComposition` + `BootGate`（见 [web-client-algorithms.md](./web-client-algorithms.md)）。

---

## 1. BootComposition 花名册

Wire 形状兼容 DeepSeek：`window.__DSH_BOOT__` / `__XRK_BOOT__`（`XRK_APP_SHELL_BOOT`）。

| BootGate id | 职责 |
|-------------|------|
| `connection` | 构造 `FaceClient`（不要求 Host 在线） |
| `face-client` | `FaceSessionView` + mux 桥就绪 |
| `layout-slots` | 在 `SlotRegistry` 声明 `chrome.*` |

任一 entry `failed` / throw → phase `failed`，`AppShellEntry` **不** `mountShell`。

---

## 2. SlotRegistry chrome

```text
root
  chrome.sidebar  (list)   → sessions
  chrome.main     (keyed)  → conversation
  chrome.status   (list)   → boot | connection | queue
```

- Sidebar：`session.list`；选中 → mux + `session.history` → `FaceSessionView`；标题优先 live projection。  
- Main：trajectory（含 optimism）· prompt / rename / agentPreset。  
- Status：gate phase · mux 状态 · queue 长度。

---

## 3. 与 Face console

| 路径 | 角色 |
|------|------|
| `/`（默认） | AppShell |
| `/?console=1` | Face U1 验证器（单列） |

Host `XRK_WEB_DIST` 默认注入 `XRK_APP_SHELL_BOOT`。

---

## 4. 非目标（本切片）

- Logo / 主题 / locale / workspace 面板  
- 远程 entry URL 动态加载  
- 声称 DeepSeek Cordis 壳对等  

下一轨：settings/credentials（密钥仍不入库）或品牌资源。
