# Host OOM vs DSH / Codex（笔记）

> 2026-08-25 · 维护者笔记，不是教科书。

## 他们对齐的事

| 层 | DSH / 成熟 Agent | XRK 曾缺 |
|----|------------------|----------|
| 捕获 | bash `maxOutputBytes` **默认 64KiB** | 长期无默认上限 |
| 进日志前 | spill-policy：超预算 → 落盘 + TextTail 预览 | 只事后 prune（全文已进堆） |
| 软压 | 消息面压缩；**envelope（system/tools）压不动** 写进规格 | 软预算长期不算 tools，超了还出站 |
| 设置 | 不是靠用户拧旋钮防 OOM | 曾想加 Face 选项 — **错** |

## 结论

OOM 是内核边界问题：大工具正文不得以全文进 session 堆。  
做法：捕获截断 + spill，默认永远开，不进 Settings。

## 已落地

- `bash` 默认 64KiB
- `boundToolResultContent`：64KiB headTail spill → `~/.xrk/spill/`
- 软预算含 tools；仍超 fail-closed
