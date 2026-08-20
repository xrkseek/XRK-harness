# Tool output bound

> **读者**：贡献者。

通用「给模型看的」输出封顶。  
**叶工具可返回完整域输出**；pipeline 在 `finalize` 之后统一 bound，再 freeze `tool/result`。

## 默认

| 限制 | 默认 |
|------|------|
| `maxLines` | 2000 |
| `maxBytes` | 50 × 1024 |

超出则 head/tail 预览 + marker；若提供 `persist(full) → path`，marker 含路径，完整内容进托管存储。

## API

```ts
boundToolOutput(text, { maxLines, maxBytes, persist? })
createToolPipeline({ outputBound: false | { … } }) // 默认开启（无 persist = 仅截断）
createMemoryToolOutputPersist() // 测试 / 无盘
createWorkspaceToolOutputPersist({ root }) // 宿主落盘：`.xrk/tool-outputs/`
```

`minimal` / `harness` preset 默认挂 workspace persist。  
`RunToolOutcome` 可带 `truncated` / `outputPaths`。

## 边界

- 不做执行授权（仍是 guards）
- 不替代叶内 capture 限额（如 shell stdout 自限）
- 会话日志存 **bound 后** 文本（模型可见 ≡ 日志）
- 完整正文在 workspace 相对路径（默认 `.xrk/tool-outputs/…`），不进 session 事件
