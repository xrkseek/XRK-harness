# Cordis 深读（时空可组合 · lc25）

> **调研笔记 · 禁止当产品 API。**  
> 上游：[cordiverse/cordis](https://github.com/cordiverse/cordis) · 论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)（Shi / Zhang / Cui · PKU + DeepSeek-AI · 2026-08-13 draft）· DeepSeek Harness [primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer) / [tutorial](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cordis-tutorial) / [Context API](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-api/context.md)。  
> 本仓立场：[ADR-0002](../adr/0002-no-embed-upstream.md) — **学透、取精华、自研对照**；**禁止**把 Cordis 并成 `kernel` / `core*` 第二运行时。  
> 本地缓存（**不入库**）：`XRKgrocery/_upstream/cordis-paper.pdf` · `XRKgrocery/_upstream/deepseek-harness`（sparse：`docs` + `vendor/cordis`）。

---

## 0. 为什么值得完整学

Cordis 不是「又一个 DI 容器」。它把插件系统里最难、也最常被糊弄的两件事做成了**一等公民**：

| 维度 | 含义 | 朴素系统常怎么糊弄 |
|------|------|-------------------|
| **时间可组合（temporal）** | 组件卸载时，副作用能**完整回滚** | `removeListener` 漏挂、timer 泄漏、半卸载留下幽灵 handler |
| **空间可组合（spatial）** | 组件间依赖可**声明**并**随提供者上下线反应式重挂** | 手工 boot 顺序、`require` 硬耦合、换实现就改消费者 |

论文把经典 **effect / coeffect** 抬到运行时 → 统一 **Context** → **Component / Fiber** 演算 → Cordis 实现 + Loader/HMR。结论明确点名：**self-evolving agent harness** 是未来验证场景（组件被 AI 频繁生成/替换时，仍要「卸得净、依赖不乱」）——与 XRK 产品同构。

DeepSeek Harness：tools / llm / sessions / agent loop = 同树插件。  
本仓：preset + 显式对象（`ToolPipeline` · `SessionStore` · FaceRuntime）。**结构不同，问题同构。**

---

## 1. 五个核心概念（primer）

| 概念 | 一句话 | 进阶 |
|------|--------|------|
| **Plugin** | 函数 / `{ apply }` / `Service` 子类 | `ctx.plugin` → **Fiber** |
| **Context** | 服务仓库；属性读走 Proxy/`reflect` | `extend` · `isolate` · `intercept` |
| **inject** | 硬依赖服务名 | 未就绪 → **PENDING**；依赖消失 → 消费者 unload 再待重挂 |
| **Events** | 声明合并 + **mode** 契约 | `emit` / `waterfall` / `parallel` / `serial` / `bail` |
| **Effects** | 注册皆可逆 | `ctx.on` / `plugin` / `provide` 自带；裸资源 → `ctx.effect` |

实践：能力进 service；拦截进 events；顺序敏感 teardown 放**同一个** async disposer 内串行。

---

## 2. Fiber 生命周期

```text
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

论文 / 实现对照（Table 2）：LOADING ≈ 𝖱𝖾𝗅𝗈𝖺𝖽𝗂𝗇𝗀；FAILED ≈ 𝖨𝗇𝖺𝖼𝗍𝗂𝗏𝖾(𝜉)；`fiber.dispose` = 累加器 `𝑔` 的恢复；`fiber.inertia` = 进行中的转移句柄。

要点：PENDING 不是崩溃；依赖是**持续**的；子插件随父 dispose；disposer **逆序**；多 async disposer 默认可并行。

本仓：`BootGate` 有「全 ACTIVE 才 settle」；**无** Fiber / PENDING 唤醒 / 热替换级联。

---

## 3. Context 空间模型

| API | 作用 |
|-----|------|
| `extend(meta?)` | 子上下文；不改父 |
| `isolate(name, label?)` | 服务名独立隔离域；同 label **并域** |
| `intercept(name, config)` | 子树 config 叠层 |
| `provide` / `get` / `set` | Fiber 拥有 provide；`get(strict)` 默认可只见 ACTIVE |
| `mixin` | 方法挂到 `ctx`；随 unload 撤 |

**取精华：** subagent / 沙箱可用「作用域标签」换 `shell`/`fs`。  
**不搬：** 全局 Proxy 上帝 `ctx` 进 `kernel`（AGENTS 红线）。

---

## 4. 事件分发契约

| Mode | 语义 |
|------|------|
| `emit` | 同步广播，不 await |
| `parallel` | 全部并行 await |
| `serial` | 顺序 await；首个有意义返回可截断 |
| `bail` | 同步版 serial |
| `waterfall` | `(…args, next)`；可变换或 **不调 next = veto** |

纪律：mode 是公开契约；waterfall **只观察也必须 `next()`**。

本仓：`ToolPipeline` PreOutcome ≈ waterfall/policy；session 事件联合类型 ≈ 有名契约（无 Cordis Events 总线）。

---

## 5. 论文精读（88 页 draft · 已抽读）

作者：Yifan Shi, Wei Zhang（北大）· Tianyi Cui（DeepSeek-AI）。  
本地：`_upstream/cordis-paper.pdf`（不入库）。

### 5.1 贡献（§1.3）

1. **可逆 effects（§3.1）** — 每次上下文变换带显式逆；跟踪与恢复保组合 → **局部时间可组合**  
2. **反应式 coeffects（§3.2）** — 组件声明依赖规格；上下文变化通知为 activating / deactivating / neutral → **局部空间可组合**；含 isolation / interception  
3. **统一 Context 类型（§3.3）** — coeffect 上的 **observational equivalence** 给 effects **独立性**  
4. **动态组合演算（§4）** — Component + Fiber 操作语义；元理论把时空可组合从单组件抬到交错系统  
5. **Cordis 实现（§5）** — 核心库 + Loader（配置对账 / HMR）；Koishi 案例（>4000 社区插件）

### 5.2 可逆 effects（工程可读摘要）

- 效应 ≈ `Γ → Γ × (Γ → Γ)`：新上下文 + **左逆**（只要求 `𝑔 ∘ 𝑓`，不要求 `𝑓 ∘ 𝑔`）。  
- **扭曲复合** `(𝑓1,𝑔1)∘(𝑓2,𝑔2) = (𝑓1∘𝑓2, 𝑔2∘𝑔1)` —— 逆按 **LIFO** 叠（与 `ctx.effect` disposer 逆序一致）。  
- **Effect context** `𝜕Γ = Γ × (Γ → Γ)`：`(𝛾, 𝜑)` 当前态 + 累加恢复函数。  
- `track` 把 `(𝑓,𝑔)` 写入 `𝜕Γ`；`recover` 应用 `𝜑` 并重置。  
- **独立性**：交错 fibers 时，若效应交换，则单累加器恢复仍精确（Theorem 61 *Recovery exactness*）。

**对本仓：** 「每个注册必须能 undo」= Face bus off、pipeline `on*` 返回卸载函数、vault 不落盘。缺的是**统一累加器**与交错恢复定理级保证。

### 5.3 反应式 coeffects + 全局空间定理

- 组件声明 `𝑑`；上下文变 → activating / deactivating / neutral。  
- **isolate** 改变 key 解析到哪一 realm；**intercept** 改变绑定如何用。  
- **Theorem 63 Ordering：** 依赖先提供再 Begin；provider 的 Unload 须在所有仍 resolve 到它的 dependents 停用之后——teardown 期间消费者**仍可读**即将撤回的 coeffect（关连接池要还回 provider）。  
- **Theorem 64 Resolution coherence：** 一次过渡内迭代对着**同一** committed view `𝜔`；target 变了 → Divert/Raise，不能装「对着过期解析算出的效应」。

**对本仓：** policy / agent 缓存失效（`invalidateAgent`）是粗糙版「依赖变了重挂」；尚无 Ordering 级「先卸消费者再撤 provider」。

### 5.4 Fiber 演算（§4 直觉）

- Fiber = 组件一次实例：inject、provide、apply、parent、state、committed view、accumulator。  
- 生命周期边含 **进行中状态**（Reloading / Unloading）与 **inertia**（飞行中的异步转移）。  
- Withdrawal 必须拆步：先让 dependents 在仍可见 provider 时 teardown，再真正撤 provision（§4.3.1）。

### 5.5 实现对应（§5 Table 2 · 已对读 vendor）

| 理论 | 运行时（`vendor/cordis/src`） |
|------|------------------------------|
| `Γ∞` / ctx | `context.ts` Proxy + `ReflectService.handler` |
| `ctx.effect` | `fiber.ts` `execute` 迭代收集 inverses，LIFO `dispose` |
| store / isolate / intercept | `ctx[@@store]` · `@@isolate` · `@@intercept`（`symbols`） |
| Fiber | `fiber.ts`：`uid` · `state` · `inertia` · `dispose` · `restart` · `update` |
| Registry | `registry.ts`：`plugin` · `inject`（依赖变则 unload/re-run） |
| Events | `events.ts`：`DispatchMode` 五档；waterfall 组合 `next` |

**义务边界：** runtime **不验证** inverse 是否真恢复——作者责任；演算 Theorem 61 假设 witness。

### 5.6 结论与对本仓的指向（§8）

Cordis 验证场景含 **self-evolving agent harness**：组件被频繁替换时仍要完整恢复 + 依赖协调。  
→ XRK 不并 Cordis，但应用同一标尺审查：工具注册、Face 订阅、policy ask waiter、preset 切换是否「卸得净」。

---

## 6. Tutorial 1–7（全文吸收）+ 本仓对照习题

> 上游命令：`node --import tsx ../../vendor/cordis/bin.js`（在 DSH `tmp/cordis-tutorial`）。  
> 本机：已 sparse clone 文档与 vendor；**完整 `pnpm install` + 手跑七章**仍待你本机有空时勾 §9。下列习题**不要求 Cordis 进仓**，用本仓概念自测。

### Ch.1 First plugin

- **学到：** `apply(ctx)`；yml 列表并发挂载；顺序靠 inject 不靠文件行序；`apply` 抛错 = 响亮失败；**路径拼错可能只打日志不崩**。  
- **习题：** 列本仓「静默失败」风险点（例：plugin kind 非 tools）。对照 [plugin-tools-wire.md](./plugin-tools-wire.md)。

### Ch.2 Lifecycle & effects

- **学到：** `ctx.effect(() => disposer)`；`fiber.dispose()` 等异步清理；子 `ctx.plugin` 随父卸。  
- **习题：** 找一处本仓注册缺 disposer（若有则记债）。Face `bus.subscribe*` 是否在测试/关闭路径 off？

### Ch.3 Services + inject

- **学到：** `Service` + `declare module` 合并；`inject: ['x']` → PENDING；依赖卸 → 消费者卸；`ctx.get` 可选依赖。  
- **习题：** 把 `createHarnessComposition({ policy })` 想成 provide；缺 policy 时行为是「默认放行」还是 PENDING？本仓是**构造期可选**，非 PENDING。

### Ch.4 Events + waterfall

- **学到：** `emit` vs waterfall veto；观察者必须 `next()`。Harness：`approval/request` waterfall。  
- **习题：** 对照本仓 `approval/asked|decided` + `session.respondApproval`——决策在 **session 事件 + Promise**，不是 Cordis waterfall；写出利弊各一条。

### Ch.5 Config + Schema

- **学到：** Standard Schema / Schemastery；坏配置 ValidationError → FAILED；`!!js` 仅 config/disabled。  
- **习题：** 对照 `parsePolicyRuleset` / Face `invalid-payload`——是否 fail-loud？

### Ch.6 Composition + HMR + PENDING 诊断

- **学到：** 稳定 `id`；`disabled`；HMR = unload+load；`ctx.registry` 扫 PENDING；HMR 自己也 inject timer（缺则静默 PENDING）。  
- **习题：** 设计本仓「诊断命令」最小草案：列出 session 上 pending approvals / 未接线 policy（不必实现）。

### Ch.7 Into the harness

- **学到：** `inject: ['tools']` + `register` 自带 disposer；`tools/result` 事件解耦 logger 与执行者；tools 依赖 systemPrompt → 漏挂则 PENDING。  
- **习题：** 对照 `wireCompositionTools` + `ToolPipeline`——注册冲突是否可见？见 lc13。

---

## 7. Loader / HMR（组合平面）

YAML 树 · Include · overlay · HMR = 配置即组合。  
本仓：presets + `XRK_PLUGINS_DIR`；**HMR 不进 agent kernel**。Web Cordis Loader 见 [deepseek-web-ui.md](./deepseek-web-ui.md)；AppShell 用 BootGate（[xrk-app-shell.md](./xrk-app-shell.md)）。

---

## 8. 与本仓能力地图

| Cordis | 本仓近似 | 缺口 |
|--------|----------|------|
| 可逆注册 | pipeline off；bus unsubscribe | 无统一 Fiber 累加器 |
| inject / PENDING | 构造参数 | 无反应式重挂 |
| isolate | sandbox / 显式注入 | 无 realm 标签 |
| waterfall | ToolPipeline pre/ask | 无通用 typed catalog |
| Ordering 卸依赖 | abort / invalidateAgent | 无「先卸消费者」协议 |
| Loader / HMR | presets / plugin loader | 非目标 |

已抽算法（无 Cordis）：[web-client-algorithms.md](./web-client-algorithms.md)。

---

## 9. 吸收清单

### 概念 / 论文 / 源码

- [x] 时空两维 + 五件套 + Fiber + modes + isolate/intercept  
- [x] 论文贡献、可逆 effects、反应式 coeffects、Ordering/Coherence、Table 2、结论（agent harness 指向）  
- [x] Tutorial 1–7 **全文吸收** + 本仓习题（§6）  
- [x] 对读 `vendor/cordis/src`：`context.ts` · `fiber.ts` · `registry.ts` · `events.ts` · `reflect.ts`  
- [ ] 本机 DSH `pnpm install` 后 **手跑** tutorial 七章（可执行验证）  
- [ ] 论文 PDF 余下证明细节按需二刷（§4.4 完整证明树）

### 产品纪律

- [x] **不**并 Cordis 进 `kernel` / `core*`  
- [x] 组合正确性用显式对象 + 文档契约表达  
- [x] 叶包路线：`@xrkseek/compose` 规格 + C0 实现 — [compose-design](../superpowers/specs/2026-08-15-compose-design.md) · [ADR-0005](../adr/0005-compose-leaf.md)  
- [ ] C1：Host/Face 失效路径接 compose Ordering  
- [ ] 若做 subagent 作用域：C2 按 compose 规格落地（不并 Cordis）  
- [ ] 浏览器若引 `@deepseek-ai/cordis`：NOTICE + 仅 UI  

### 明确后置

- Cordis HMR / Yakumo 进仓  
- agent loop 改成 Cordis Service  
- 全局 `declare module` 进 protocol  

---

## 10. 推荐阅读顺序

1. 本文 §0–4 → §5 论文 → §6 习题  
2. 本地 PDF + vendor 源码  
3. DSH tutorial 手跑  
4. 回看：[plugin-tools-wire.md](./plugin-tools-wire.md) · [tool-pipeline.md](../tool-pipeline.md) · [web-client-algorithms.md](./web-client-algorithms.md) · [policy-gates.md](./policy-gates.md)

---

## 11. 一句话结论

Cordis 先进在：用运行时机制保证 **装得上、卸得净、依赖变了能协调**，并把事件 mode 钉成契约；论文给出交错系统下的恢复精确性与依赖卸序定理。  
本仓完整学标尺；实现继续 **显式 TS 对象图 + session 事件真源**，不引入第二套 Cordis 内核。
