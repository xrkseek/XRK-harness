# Testing

## 门禁

根脚本 `pnpm check` → `scripts/check.mjs`：

| 步 | 命令 | 失败含义 |
|----|------|----------|
| 1 | `tsc -b --pretty false` | 类型 / 项目引用断裂 |
| 2 | `eslint .` | 风格与不安全模式（含 no-explicit-any、floating promises） |
| 3 | `vitest run` | 行为回归 |
| 4 | `vitest run --config vitest.kernel.config.ts --coverage` | `@xrkseek/kernel` 行/分支/函数/语句 **≥ 90%** |

单独命令：

```bash
pnpm build                # tsc -b（CLI / Node 跑 dist 前需要）
pnpm test                 # vitest run
pnpm test:kernel-coverage
pnpm lint
pnpm format:check
```

## 测例布局

```text
packages/<area>/tests/**/*.test.ts
apps/**/tests/**/*.test.ts
```

Vitest 别名把 `@xrkseek/*` 指到各包 **src**（见根 `vitest.config.ts`），测试直接打源码。

## 约定

1. **无密钥**：模型面用 `createReplayAdapter([...])`。  
2. **Session 真源**：断言优先对 `deriveMessages(events)` / 事件类型，而非内部可变数组。导入 JSONL 用 `fromJSONL`（内部 `assertSessionEvent`）。  
3. **Protocol**：跨边界未知值用 `parseSessionEvent`，勿只靠宽松的 `isSessionEvent`。  
4. **Exec**：临时目录 `mkdtemp`；测路径逃逸与 stub Provider「换实现零改工具」。  
5. **HTTP**：`createHostManager` + `XRK_PORT=0`；测后 `stopAll`。  
6. **Preset**：`@xrkseek/testkit` 的 `makeHarness` 或直接 `createMinimalComposition`。

## 扩展覆盖率

目前仅 **kernel** 强制阈值。其他核包（session/tools）可后续仿 `vitest.kernel.config.ts` 加门，勿在未立项时一次抬全仓阈值。

## CI

`.github/workflows/ci.yml`：install + `pnpm check`（无密钥）。与本地门禁一致。
