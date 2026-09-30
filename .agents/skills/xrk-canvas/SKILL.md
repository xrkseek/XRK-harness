---
name: xrk-canvas
description: >-
  Build durable workspace Canvas boards with canvas_* tools for the Overview →
  画布 tab. Prefer this over pasting large markdown tables into chat when the
  user wants a board, KPI wall, chart, dashboard, 「画布」「看板」「概况 Canvas」.
  Not for Cursor IDE .canvas.tsx.
---

# Workspace Canvas

> Monorepo overlay：工作区为 harness 源码仓时读本文件；产品默认种子在 `apps/cli/seeds/skills/xrk-canvas`（装到任意用户的 `~/.xrk/skills/`）。

Canvas = 工作区级、可跨会话保留的声明式看板，在右侧 **概况 → 画布** 里用 chip 切换多份。  
**触发看用户意图**，不是看「回复像不像表」。该进画布的交付物，不要用聊天 markdown 顶替。

## 1. 要不要开画布

先问：用户是否需要**离开聊天、可回看、可再点选**的独立产物？

**必须用 Canvas：**
- 量化结论 / KPI / 对照表 / 简易趋势，且会再看或给别人看
- 用户明确说画布、看板、概况 Canvas、dashboard
- 多块结构（说明 + KPI + 表 + 序列）要一起呈现
- 同一工作区要挂多份看板（不同 `id`）

**不要用 Canvas：**
- 修代码、写 PR、短答、澄清问题
- 聊天里一两行小表就够说明
- 用户要的是别的产品物（外部看板、导出文件）— 做那个，不硬塞画布
- Cursor IDE 旁路 `.canvas.tsx`（那是另一条产品线）

拿不准 → 先 `canvas_list`；已有合适 id 则 `canvas_patch` / `canvas_upsert`，没有再新建。

## 2. 工作流

```
- [ ] 1. Intent：对照上一节的「必须 / 不要」
- [ ] 2. `canvas_list`：复用已有 id，或选新 kebab-case id（例：`latency-board`）
- [ ] 3. 只写入有数据的 sections；空块省略
- [ ] 4. 新建 / 整页替换 → `canvas_upsert`；小改 → `canvas_patch`
- [ ] 5. 聊天里用一句话指路：打开 **概况 → 画布**，用顶栏 chip 切换
```

多看板 = **多个 id**（`overview` · `cost-board` · `qa-matrix`），不要把无关内容塞进同一份。

## 3. 工具（禁止手写磁盘 JSON）

| 工具 | 何时 |
|------|------|
| `canvas_list` | 动手前看已有 |
| `canvas_read` | 改前读全量 |
| `canvas_upsert` | 创建或整份替换（`id` · `title` · `sections`） |
| `canvas_patch` | 只改 title 和/或 sections |
| `canvas_delete` | 用户明确要删 |

磁盘（只读了解，勿用 Write 碰）：`~/.xrk/canvases/<workspaceId>/<id>.json`（`XRK_HOME` 可覆盖）。  
删会话**不**删画布。

### `id` 规则

`[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}` — 短、稳定、可猜。

## 4. sections（最多 64；有数据才写）

| kind | 字段 | 用途 |
|------|------|------|
| `markdown` | `body` | 结论、说明（简洁，别把整段聊天贴进去） |
| `kpi` | `items[{label,value}]` | 少而醒目的指标 |
| `table` | `columns` · `rows` | 对照 / inventory |
| `series` | `title` · `points[{x,y}]` | 简易趋势（y 为有限数字） |

最小 upsert 形状：

```json
{
  "id": "overview",
  "title": "Overview",
  "sections": [
    { "kind": "markdown", "body": "## Status\n…" },
    { "kind": "kpi", "items": [{ "label": "p99", "value": "42ms" }] },
    { "kind": "table", "columns": ["id", "status"], "rows": [["a", "ok"]] },
    { "kind": "series", "title": "Daily", "points": [{ "x": "Mon", "y": 3 }] }
  ]
}
```

### 内容质量

- KPI：`label` 短、`value` 自解释（含单位）
- 表：列名稳定；单元格字符串；别塞超宽自然语言
- series：点按时间/类别有序；勿造假数据
- 禁止：`eval`、模型吐 React、播放器内 `fetch`、`.canvas.tsx` / `cursor/canvas`

## 5. 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 聊天贴大 markdown 表当交付 | `canvas_upsert` + 指路画布页签 |
| Write 手写 `~/.xrk/canvases/...` | 只用 `canvas_*` |
| 绑死 sessionId | 工作区级；id 稳定即可 |
| 多主题挤一个 id | 多 id + chip 切换 |
| 空 sections / 占位「TODO」 | 没数据就别建这块 |
| 改完不告诉用户去哪看 | 明确说 **概况 → 画布** |
