# Learn: `createTool` / `Tool.make` ↔ XRK `ToolDefinition`

> TODO: `lc9`  
> 源：
>
> - Cline：`XRKbar/cline/sdk/packages/shared/src/tools/create.ts`
> - OpenCode：`packages/core/src/tool/tool.ts`（`Tool.make`）
> - 本仓：`packages/core/tools/src/definition.ts` + pipeline
>
> 接 lc5 / lc8。态度：映射字段 · **不**强制 Zod/Effect Schema。

---

## 1. 字段映射

| 概念 | Cline `createTool` | OpenCode `Tool.make` | XRK 现状 | 建议 |
|------|--------------------|----------------------|----------|------|
| 名 | `name` | 注册 key | `name` | 同左；校验 `[A-Za-z][A-Za-z0-9_-]{0,63}` 可吸 |
| 描述 | `description` | `description` | `description` | 同 |
| 入参 schema | Zod **或** JSON object（须顶层 object） | Effect `input` Schema | `parameters: Record`（JSON Schema 约定） | 保持 JSON；可选 **适配器** `fromZod` 外置，不进核 |
| 出参 schema | 无强制 | `output` + optional structured | 无；`content: string` | 域对象由工具自己；给模型仍走 string / finalize |
| execute | `(input, AgentToolContext) => Promise` | Effect + `Context` | `(args, signal?) => Promise<ToolResultContent>` | 保留 Promise；context 可扩 sessionId/callId |
| 超时 | `timeoutMs` | 叶/进程 | pipeline `timeoutMs` | 已在 pipeline |
| 重试 | `retryable` / `maxRetries` | 叶自理 | pipeline transient retry | 已有 |
| 生命周期 | `lifecycle.completesRun` 等 | 无对等 | 无 | 可选 completion policy（lc1） |
| 权限 action | policies 外置 | `withPermission` / 默认=name | guards | **不**塞进 definition 必填 |
| toModelOutput | 弱 | `toModelOutput` → content parts | `finalizeContent` / 未来 output bound | 大输出走 bound，不改 execute 签名 |

---

## 2. Cline 值得吸的注册期校验

`normalizeToolInputSchema`：

- 剥 `$schema`
- 无 `type` 但有 `properties` → 补 `type: "object"`
- `oneOf`/`anyOf`：**每支**须为 object，否则 **注册期抛错**（避免推理期才爆）
- `allOf`：至少一支断言 object

**建议：** 在 `registry.register` 或薄封装 `defineTool` 里做同等 JSON Schema 卫兵；**不要**为了这点引入 Zod 为硬依赖（Cline 用 Zod 是可选路径）。

---

## 3. OpenCode 值得吸的「不透明值」

- `Tool.make` 返回 freeze 空对象 + WeakMap runtime → 防止调用方乱改内部。  
- 本仓可用：`Object.freeze({ name, description, parameters, execute })`；execute 已闭包捕获即可。  
- **不**复制 Effect decode/encode 链；需要校验时用 AJV/自研轻量，或信任 pipeline pre。

---

## 4. 推荐本仓外观（文档级，本条不实现）

```ts
// 理想 DX（未来 defineTool）
defineTool({
  name: "read_file",
  description: "...",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async execute(args, ctx) { /* ctx.signal, ctx.sessionId, ctx.callId */ },
  // 可选：timeoutMs, maxRetries → 由 composition 默认 pipeline 读取 metadata
});
```

与 pipeline 关系：

- **definition** = 叶能力  
- **pipeline** = 横切（guard/pre/post）  
- 禁止在 `execute` 里再实现一套 guard

---

## 5. 取 / 不取

**取：** 顶层 object schema 注册期校验；timeout/retry 元数据；可选 completesRun；freeze 定义；execute context 含 call/session。  
**不取：** Zod/Effect 强制；把 Permission 服务焊进 `make`；Hub tool proxy。

---

勾选：`lc9` 完成。
