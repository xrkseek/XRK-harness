# xrk-phone-bridge（远程 phone_*）

> **读者**：维护者 · 在 Desktop / `xrkh serve` Host 上启用远程手机工具。

**装一个目录即可。** `kind: host`；首次接线 materialize：

- `xrk-phone-bridge-tools` / `xrk-phone-bridge-prompt`
- `$XRK_HOME/skills/xrk-phone`（与 guest 同一份 playbook）
- `web/plugins/xrk-phone-bridge/client.js` → Settings 侧栏 **远程手机桥**

不改 Host 源码。设备 Cookie 的 Path 仅 `/mobile-access/auth/renew`，Settings SPA 通常看不到 deviceKey——以待批准 / 在线列表为准；App 出站请求自行转发 Cookie。

## 浏览器 Face vs 手机 App

| 表面 | PIN 打开 Face | 进白名单 / 待批准 | phone_* 执行 |
|------|---------------|-------------------|--------------|
| 浏览器桌面 Face | 是（聊天/Settings） | **否**（不调 `register`） | 经已在线 App 执行 |
| 手机 App HTTP Face | 是 | **是**（App 出站 `ticket`→`register`） | 本机无障碍 poll |

浏览器与 App 可同时连同一 Host：Face 会话互不顶替；白名单只认 App `clientDeviceId`。

## 事件链

`ticket` → `register`（未白名单 → **pending**）→ Settings **允许**（`POST /whitelist`）→ `register` ok → App **`POST /poll`**（**online**）→ `invoke` / `result`

| 路由 | 用途 |
|------|------|
| `GET /status` | Settings 列表 |
| `POST /whitelist` | 允许 / 移除 |
| `POST /ticket` · `/register` · `/bind-session` · `/poll` · `/result` · `/offline` | App 桥 |

Ticket 只走 POST body。Host：一机一票；离线/吊销唤醒 long-poll 并失败在途 invoke；队列有上限。

## 截图回传

`phone_screen`（`image:true`）经 App → `POST /result` 带 `imageBase64` + `imageMime`（`/result` 体上限 **12 MiB**；其它路由仍 1 MiB）。工具插件把字节 `saveImage` 进 AttachmentStore，模型面拿到 `type:"image"` 块。Guest 本机环（`MobileApi` JSON 信封 → `xrk-mobile` admit）同契约。

## 安装

```bash
xrkh plugin add @xrkseek/xrk-phone-bridge
xrkh restart
```

手机 App：**HTTP Host + PIN** 即可进待批准；**操控 + 无障碍** 后进在线。浏览器 PIN **不会**进待批准。

## 测

```bash
pnpm exec vitest run extensions/xrk-phone-bridge/tests/runtime.test.mjs
```

---

# xrk-phone-bridge (remote `phone_*`)

> **Audience**: Maintainers enabling remote phone tools on Desktop / `xrkh serve`.

**One directory install.** `kind: host`; first wire materializes:

- `xrk-phone-bridge-tools` / `xrk-phone-bridge-prompt`
- `$XRK_HOME/skills/xrk-phone` (same playbook as guest)
- `web/plugins/xrk-phone-bridge/client.js` → Settings **Remote phone bridge**

No Host source edits. Device cookie Path is only `/mobile-access/auth/renew`; Settings SPA usually cannot see `deviceKey` — trust pending / online lists; the App forwards cookies on outbound calls.

## Browser Face vs phone App

| Surface | PIN opens Face | Whitelist / pending | `phone_*` runs |
|---------|----------------|---------------------|----------------|
| Desktop browser Face | Yes | **No** (no `register`) | Via an already-online App |
| Phone App HTTP Face | Yes | **Yes** (`ticket` → `register`) | Local accessibility poll |

Browser and App may share one Host: Face sessions do not kick each other; whitelist keys on App `clientDeviceId`.

## Event chain

`ticket` → `register` (pending if not whitelisted) → Settings **Allow** (`POST /whitelist`) → `register` ok → App **`POST /poll`** (online) → `invoke` / `result`

Ticket is POST body only. Host: one ticket per device; offline/revoke wakes long-poll and fails in-flight invokes; queues are capped.

## Screenshots

`phone_screen` (`image:true`) returns via App `POST /result` with `imageBase64` + `imageMime` (`/result` body limit **12 MiB**). The tools plugin `saveImage`s into AttachmentStore so the model sees `type:"image"` blocks.

## Install

```bash
xrkh plugin add @xrkseek/xrk-phone-bridge
xrkh restart
```

Phone App: **HTTP Host + PIN** reaches pending; **control + accessibility** reaches online. Browser PIN alone does **not** enter pending.

## Tests

```bash
pnpm exec vitest run extensions/xrk-phone-bridge/tests/runtime.test.mjs
```
