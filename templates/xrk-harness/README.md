# xrk-harness（工作区种子）

> **读者**：在本产品里开发进程插件 / 扩展的集成者与贡献者。

注入到 `{workspace}/.xrk`，配合会话徽章 **XRK Harness**（id `harness`），把「怎么写插件」喂给模型。

| 文件 | 作用 |
|------|------|
| `SOUL.md` | 短人格：插件教练 |
| `IDENTITY.md` | 显示名 / 自称 |
| `USER.md` | 默认用户偏好 |
| `assistant.md` | 持久 inject：开发步骤与边界 |
| `AGENTS.md` | 工作区读写与办事规则 |
| `TOOLS.md` | 本产品工具面速查 |
| `rules.md` | 硬约束摘要 |
| `recipes/*.yaml` | 斜杠配方（可选） |

同步：

```ts
import { createWorkspaceInjector } from "@xrkseek/workspace";
import path from "node:path";

const inj = createWorkspaceInjector({
  root: process.cwd(),
  productDir: path.join(process.cwd(), ".xrk"),
});
await inj.syncSeeds(path.join("templates", "xrk-harness"));
```

| 预设层 | 名字 | 说明 |
|--------|------|------|
| Session | `harness` → UI **XRK Harness** | 完整工具面 |
| Host | `web`/`serve` 默认 harness；`server` 仅工厂名 | 非第三套工具 |
| 种子 | 本模板 vs `office-agent` | 插件开发 vs 办公办事 |

教科书：[docs/plugin-development.md](../../docs/plugin-development.md) · [docs/profiles.md](../../docs/profiles.md)。  
金样：[extensions/example-tools](../../extensions/example-tools/)。
