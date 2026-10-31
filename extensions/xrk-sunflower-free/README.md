# xrk-sunflower-free

产品自带的**免费 LLM** 插件（`kind: "llm"`）。对齐 OFM 双车道：

| Brand | 来源 | Bun | 目录 |
| --- | --- | --- | --- |
| `sunflower-free` | OpenCode 匿名池 | **需要**（sidecar） | 仅探针 `available`；额度用尽不显示 |
| `sunflower-kilo`（仅 Kilo 时并入 `sunflower-free`） | Kilo `isFree` listing | **不需要** | Host → `api.kilo.ai` 直连 |

无 Bun：OpenCode 静默省略；Kilo 仍进目录（OFM：`egressFetch` 仅对 `opencode.ai/inference/*` 走 Bun）。

## Bun（用户自装，仅 OpenCode）

产品包**不**随带 Bun。查找顺序（`resolveBunBinary`）：

1. env **`XRK_SUNFLOWER_BUN`**
2. 可选插件旁 **`vendor/bun*`**（本机 `pnpm vendor:bun`）
3. **`~/.bun/bin/bun`**
4. **`PATH`**

## OpenCode 线缆（OFM `upstream.js` / `oc-free-transport.md`）

- 路径：`/inference/v1/chat/completions`
- UA：`opencode/latest/2.0.26/cli`（整串）
- 头：`Bearer public` + 双 session + `x-session-*` + `x-opencode-project: global`；**无** `x-opencode-request`
- 工具：官方 `read`/`shell`（Linux bash 文案）；`tool_choice: none` 清除
- system：**不**粘贴 OC persona；补 `<env>` + placeholder note
- Host 名别名：`working_directory` → `workspace_directory`（OFM 429 修复）

OpenCode **出口级联**（不挡听口）：

1. 先直连；有可用 → 粘住直连
2. 直连 0 可用且 Settings `openCodeProxy` 允许 → 候选代理
3. `openCodeProxy=off` → 只直连

## 结构

| 文件 | 作用 |
| --- | --- |
| `plugin.mjs` | OpenCode sidecar brand + Kilo 直连 brand |
| `free-models.mjs` | OpenCode 候选 |
| `kilo.mjs` | Kilo listing |
| `probe.mjs` / `probe-cascade.mjs` | OFM 形 ping + 出口级联 |
| `sidecar.ts` | Bun：仅 OpenCode |
| `fingerprint.ts` | OFM v2.0.26 指纹素材 |

## 密钥

- sidecar ↔ Host：进程内 `XRK_SUNFLOWER_SIDECAR_KEY`
- OpenCode：恒 `public`
- Kilo：无密钥
