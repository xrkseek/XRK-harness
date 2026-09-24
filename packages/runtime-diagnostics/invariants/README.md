# `@xrkseek/runtime-invariants`

> **读者**：维护者 · Host / Face 集成者

Face 主路径用的**包自有运行时不变量**注册表（对标 dsh `dsh-invariants`，**不依赖 Cordis**）。社区 Cordis 叠层仍用 stubs `@xrkseek/xrk-invariants`。

## 用法

1. Host 可选开启 fail-fast：`XRK_INVARIANTS_FAIL_FAST=1`（或 `true`）。
2. Host 创建 registry → 挂关键包 `./invariant` 伴侣 → 包装 `SessionStore.append`。
3. 违规抛 `InvariantError`（`code: "INVARIANT"`，带 `packageName`）。

```ts
import {
  createInvariantRegistry,
  wrapSessionStore,
  resolveInvariantsFailFast,
} from "@xrkseek/runtime-invariants";
import { installCoreSessionInvariant } from "@xrkseek/core-session/invariant";

if (resolveInvariantsFailFast()) {
  const registry = createInvariantRegistry({ enabled: true });
  installCoreSessionInvariant(registry);
  store = wrapSessionStore(store, registry);
}
```

加载 registry 本身不安装任何产品检查；伴侣负责包级关系。
