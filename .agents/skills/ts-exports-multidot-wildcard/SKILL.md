---
name: ts-exports-multidot-wildcard
description: 排查并修复 TypeScript exports 通配符子路径（如 api/events.schema）因多点文件名被误判扩展名而 TS2307 解析失败的问题。
---

# ts-exports-multidot-wildcard

## When to Use

消费方 `import ... from '@scope/pkg/api/events.schema'`（或任何写为 `pkg/path/file.suffix` 的子路径）时报
`TS2307: Cannot find module '@scope/pkg/api/events.schema'`，而：
- `@scope/pkg/api`（根子路径、无通配符）却解析正常；
- exports 里 `"./api/*": "./src/api/*"` 通配符映射看起来正确、目标文件也确实存在（`src/api/events.schema.ts`）；
- 改 exports 目标从 `src` 到 `lib`、或补 phantom 依赖、或换 `types`/`default` 条件都无济于事。

## Procedure

1. **别先从依赖/路径方向猜根因**。多点文件名的 exports 通配符解析失败是机制性问题，phantom 依赖、src-vs-lib 往往都是干扰项。先用决定性实验确认：改 exports 指向 lib 产物后重跑，若错误原样保留 → 与 src/lib 无关。

2. **跑 traceResolution 定位**：
   ```
   tsc -p <tsconfig> --pretty false --noEmit --traceResolution
   ```
   找到 exports 匹配行之后的连续几行。铁证样式：
   ```
   Using 'exports' subpath './api/*' with target './src/api/events.schema'.
   File name '.../src/api/events.schema' has a '.schema' extension - stripping it.
   File '.../src/api/events.d.schema.ts' does not exist.   ← 致命
   Export specifier './api/events.schema' does not exist ...
   ```
   语义：TS 把通配符替换结果 `events.schema` 末尾的 `.schema` 误判为「文件扩展名」剥掉，再套一层扩展名探测，拼出 `events.d.schema.ts` 这类永远不存在的名字。

3. **根治：给通配符目标补显式扩展名**：
   - `"./api/*": "./src/api/*"` → `"./src/api/*.ts"`。
   - 替换后最终文件名带 `.ts`，TS 只剥真正的 `.ts`，不再误判 `.schema`。
   - 无显式扩展名的根入口（如 `"./api": { types: "./src/api/index.ts" }`）本来就能解析，不用动；只改带多点文件被消费的那个通配符键。

4. **全仓验证**：
   - 用 grep 枚举所有消费该 `pkg/sub*` 子路径的文件，确认只有坏掉的 key 被影响（根入口消费方不受影响）。
   - 逐个跑受影响消费方的 tsconfig（如 `tsc -p x/tsconfig.client.json --noEmit`）应归零。
   - 全仓 `tsc -b` 0 错误 + 全量 vitest 跑一遍确认无行为回归。

## Pitfalls

- 千万别被 traceResolution 里的 `Scoped package detected, looking in 'xrkseek__...'`、`@types` 探路、node_modules 各层遍历带偏——那些是通配符匹配失败后的经典 fallback，不是根因。
- 同样别把「src 面 index.ts 全 type-only 能解析」当成前提：显式入口能过、通配符子路径失败，差异只在「通配符替换结果是否含疑似扩展名的点号段」。
- 不要把修复写进消费方代码（改 import 源），那是把契约细节泄漏给调用方；exports 一处改动是干净点。
- 用 PowerShell 跑 tsc 时，通配符目标的 `.Line.Trim()` 在 `$_` 为空时会抛 Null 异常，脚本里先用 `-split` 收集错误行再遍历，避免管道崩溃。
- git 只应看到 exports 一行 + 消费方类型修复；产物（lib/types）不手动改。
