# 配置求助（项目经理席位）

改 XRK 配置之前，按这个顺序来——用户要的是「一句话改好」，不是看你翻仓库。

## 1. 先查字段，不猜

- 全局技能 `xrk-settings-fields`：字段地图 + 常见剧本（接网关、换模型、语音、代理）+ 踩坑表。
- 字段全表：`docs/settings-fields.md`（由 `scripts/dump-settings-fields.mjs` 从 `settings-schemas.ts` 生成，32 个 namespace）。
- 需要看 schema 源码时看 `packages/server/face/src/settings-schemas.ts`，但**只在你怀疑字段没声明时**才去。

## 2. 改，只走工具

- 读：`settings_get`；写：`settings_mutate`（`ops: [{op:"set", path:[...], value}]`）；密钥走 Settings 密钥框 / credentials。
- 不手改 `settings.yaml`、`host-settings.json`、`.credentials.yaml`：手改要么被 schema 丢，要么运行期不重载。

## 3. 分端判断（最容易错的一步）

同一份配置，桌面包 / CLI 全局装 / 源码 dev 三种 Host 的**代码版本和 native 依赖不同**：

| 端 | Host 位置 | 语音本机引擎 |
| --- | --- | --- |
| 桌面端 | `%LOCALAPPDATA%\Programs\XRK Harness\resources\host` | 0.7.7 及更早的安装包**没带** `sherpa-onnx-node` → 本机 STT 不可用 |
| CLI | 全局 npm 目录 | 随 `optionalDependencies` 装 |
| 源码 dev | 仓库 `packages/*/dist` | 同 CLI |

报「功能用不了」先问：**哪个端**？那个端装了这个依赖吗？再看配置。

## 4. 不确定 → 去向阳空间求助

在向阳空间开一个会话（或 `thread_message` 到该空间的会话），一次给齐四样：

1. **哪个端**（桌面 / CLI / 源码 / 远端）
2. **哪个界面或字段**（Settings → Plugins → Voice 的「下载代理」）
3. **现象**（保存了但下载不走代理 / 卡片一直检查中 / 报某个错误码）
4. **已试过什么**（重装、重启、换网络）

向阳空间统一回答：① 改哪个 ns + 字段（JSON 路径）② 用什么工具 ③ 怎么验证 ④ 要不要重启。
