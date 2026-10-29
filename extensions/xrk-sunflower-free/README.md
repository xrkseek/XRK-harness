# xrk-sunflower-free

产品自带的**免费 LLM** 插件（`kind: "llm"`）。一条 brand：**向日葵免费**
（`sunflower-free`）。

| 来源 | 条件 | 目录 |
| --- | --- | --- |
| OpenCode 匿名池 | Bun sidecar + **本机轻量 ping 通过** | 仅 `available`；`FreeUsageLimit` / 不可用 **本机不显示** |
| Kilo 免费池 | `GET …/models` 且 `isFree` | 显示名带 Kilo；含图标多模态；**不探单模** |

探测形状对齐 OFM：`ping` + `max_tokens: 16` + 流式首包、每模型独立 session、并发 2。  
产品比 OFM 更严：**不能用就不进列表**（OFM 默认仍广告 throttled 项）。

## 结构

| 文件 | 作用 |
| --- | --- |
| `plugin.mjs` | sidecar + OpenCode 探针过滤 + Kilo listing → brand |
| `free-models.mjs` | OpenCode 候选 id + `contextWindow` |
| `kilo.mjs` | Kilo listing → catalog 行 |
| `probe.mjs` | OFM 形 ping；只返回 usable ids |
| `sidecar.ts` | Bun：OpenCode（恒 `public`）+ Kilo 分流 |
| `fingerprint.ts` | OpenCode 请求形状；模型清单只改 `free-models.mjs` |

## 密钥

- sidecar ↔ Host：一次性 `XRK_SUNFLOWER_SIDECAR_KEY`（进程内）
- OpenCode：永远 `public`（不读用户 Go / `OPENCODE_*`）
- Kilo：无密钥
