---
name: event-loop-block-bench
description: "对 node:sqlite / 同步磁盘写路径做事件循环阻塞实机基准（P99 + 定时器迟到量），判定热路径是否可接受并产出可写入文档的量化结论。"
---

# event-loop-block-bench（同步写路径事件循环阻塞基准）

## When to Use

- 要判断某个**同步写路径**（node:sqlite `DatabaseSync`、`fs.writeFileSync`、同步压缩/打包）在高压下是否会阻塞事件循环、阻塞到什么量级。
- 要给「热路径契约」写量化文档（如 P50/P99/max 单次耗时、连续 N 次不让出的冻结时长）前。
- 新增同步 API 或改动批量写入节奏后回归验证。

## Procedure

1. **确认被测路径**：找到真实的同步调用点。例：`persistEvent` 对非 `assistant/chunk` 事件逐条 `BEGIN IMMEDIATE` + insert + `COMMIT`（全部同步）；`assistant/chunk` 只进批、`flush()` 才落库。先读实现再设计事件样本（凭猜会测错路径）。
2. **用已构建产物**：临时脚本 import 包 `dist/index.js`（绝对/相对路径）——走 `@scope/pkg` 包名会因 pnpm workspace 下裸 ESM 解析不到符号链接包而 `ERR_MODULE_NOT_FOUND`。
3. **三个测量**：
   - 单次调用耗时分布：N≈5000 次，排序后取 P50/P95/P99/max。
   - 连续同步块总阻塞：一次事件循环内连续 N 次调用，`setTimeout(0)` 实际被推迟多久。
   - 对比路径（若有）：如 chunk 批合并 vs 逐条 flush，证明「批路径几乎零阻塞、显式 flush 一次性付账」。
4. **事件样本必须通过协议校验**：构造真实事件（如 `tool/call` 需 `turnId`+`stepId`+`call`、`assistant/chunk` 需 `stepId`），校验失败会抛 `SessionEventParseError`，先查 `packages/protocol/src/session-events.ts` 的事件定义。
5. **结果落文档**：中英成对补进主题文档（如 `docs/session.md` 耐久屏障节），标注「（2026 实机压测）」与关键数（单次 P99、连续 N 次冻结 ms、批路径对比）。
6. **清理**：临时基准脚本跑完即删——留在 `scripts/` 或包内会进 `pnpm check`（任何 `tests/*.test.ts`）或被当垃圾误跑。

## Pitfalls

- **`setImmediate` 同步循环测法是坏的**：同步循环期间事件循环根本不转，observer 首次执行时循环已结束 → 0 个样本。要么用 async 让出节奏（每批 append 后 `await setImmediate`），要么直接测「同步块总耗时 + `setTimeout(0)` 推迟」。
- **PowerShell 重写文件会毁内容**：`(Get-Content -Raw) -replace ... | Set-Content` 会把 LF 压成一行、加 BOM、中文乱码。改脚本用 `apply_edit`/`write_file` 工具。
- **`.mjs` 不能有 TS 类型注解**，写纯 JS；`function pct(sorted, p)` 之类直接跑。
- **vitest filter 放错位置**：`pnpm --filter <pkg> exec vitest run <file>` 会把 file 当 include 过滤器且包内 spawn 可能炸；根工作区直接 `pnpm exec vitest run packages/<pkg>/tests/<file>.test.ts` 最稳。
- **结论要落到「设计内 vs 泄漏」**：同步 flush 阻塞本身可能是设计内行为（drain 边界落库），基准的价值是给数量级证据，不是「必须异步化」的结论。
