# xrk-sunflower-free

产品自带的**免费 LLM** 插件（`kind: "llm"`）。一条 brand：**向日葵免费**（`sunflower-free`）。

| 来源 | 条件 | 目录 |
| --- | --- | --- |
| OpenCode 匿名池 | 本机有 **Bun** + sidecar 探针通过 | 仅可用项；额度用尽不显示 |
| Kilo 免费池 | listing `isFree` | 无密钥；无 Bun 时也可直连 |

无 Bun 时：OpenCode 省略；Kilo 仍进目录（不要求 `XRK_SUNFLOWER_SIDECAR_KEY`）。

## Bun 装在哪

查找顺序（`resolveBunBinary`）：

1. env **`XRK_SUNFLOWER_BUN`**（绝对路径）
2. 插件旁 **`vendor/bun.exe`**（Windows）或 **`vendor/bun`**
3. 官方安装默认位 **`~/.bun/bin/bun`**（Windows 为 `bun.exe`）
4. **`PATH`** 上的 `bun`（`which` / `where`）

| 平台 | 产品策略 |
| --- | --- |
| **Windows Desktop** | 安装包随带 `vendor/bun.exe`，空机可开 OpenCode |
| **macOS / Linux** | **不**随包带 Bun；本机装好即可。官方：`curl -fsSL https://bun.sh/install \| bash` → 默认进 `~/.bun/bin`，或 `brew install bun`，保证 `bun --version` 在 PATH |

探测形状对齐 OFM：`ping` + `max_tokens: 16` + 流式首包。不能用就不进列表。

## 结构

| 文件 | 作用 |
| --- | --- |
| `plugin.mjs` | sidecar + OpenCode 过滤 + Kilo listing → brand |
| `free-models.mjs` | OpenCode 候选 |
| `kilo.mjs` | Kilo listing |
| `probe.mjs` | OFM 形 ping |
| `sidecar.ts` | Bun：OpenCode（`public`）+ Kilo 分流 |
| `fingerprint.ts` | OpenCode 请求形状 |

## 密钥

- sidecar ↔ Host：进程内一次性 `XRK_SUNFLOWER_SIDECAR_KEY`（仅 sidecar 路径）
- OpenCode：恒 `public`
- Kilo：无密钥
