# CodeGraph 检索（上下文细则）

> skill 正文在 `.agents/skills/codegraph-retrieval/SKILL.md`；本文件放常驻心智模型。

## 为什么值得先查

本仓 2,954 个源文件、37k 符号。`grep` 只能匹配文本命中，**跟不动**这些链路：

- cordis `Service` tracker 的属性访问（`ctx.conversation.send(...)` 真实调用点在别处）；
- React `renderSlot('conversation.chat.node', ...)` 的动态渲染分派；
- 通过字符串/注册表间接注册的 Conversation Node Definition 与 View Builder。

CodeGraph 的 extract 层把这些边也建了出来（`dynamic-boundaries`），所以 `explore` 一次就能给出
跨过这些动态边界的调用链。

## 什么时候**不要**用

| 场景 | 原因 |
|------|------|
| 查 `docs/` · `*.md` · `*.json` · `*.yaml` | 未索引，去了也查不到 |
| 刚写完的文件 | 索引比写入慢约 1s，先 `codegraph sync` |
| 「这个函数一共多少行」 | `read_file` / `grep` 更直接 |

## 一次典型流程

```
codegraph explore "composer 发送消息到 prompt 的链路" --max-files 4
  → 拿到 service.ts / hub.ts / facade.ts 的相关符号原文 + 调用链
  → 直接在这几处读上下文，改动，不另行 grep
  → 改完 codegraph sync，再用 codegraph affected <files> 看哪些测试要跑
```