# Design: `@xrkseek/compose` — 时空可组合底层（自研）

日期：2026-08-15  
状态：**Accepted**（2026-08-15 · 用户「接着 do」；C0 先不接线 Host）  
依据：[`docs/learn/cordis.md`](../../learn/cordis.md) · 论文 *Spatiotemporal Composability* · ADR-0002 / 0004 · 用户：「慢慢动 · 好好吸收 · 让底层高级」

---

## 0. 一句话

用 **显式 TypeScript 对象图**（无 Proxy、无 Cordis、无 Effect-TS）实现 Cordis 论文里真正硬的两件事：

1. **时间可组合** — 每个副作用带左逆；交错卸载时恢复仍精确（Recovery exactness）  
2. **空间可组合** — 依赖可声明；提供者上下线时消费者按 **Ordering** 协调卸装（含 isolate 域）

本仓 session 事件真源、agent loop 语义 **不动**；compose 是能力叶，供 Host / Face / plugin / 将来 subagent **另接**。

---

## 1. 为什么不是扩 `kernel`

| | `kernel` | `compose` |
|---|----------|-----------|
| 角色 | 薄 DI 袋 · Plugin 登记 · EventBus 三 mode · patch | Fiber/Scope · 可逆 effect · 反应式 inject · Ordering · realm |
| 依赖 | 零 / 极薄 | → `@xrkseek/kernel`（仅复用 `ServiceKey` 类型习惯；**不**把 Scope 塞回 Context） |
| 红线 | 保持无 Fiber / 无 PENDING 机 | 禁止 Proxy 上帝对象；禁止 Cordis API 兼容层 |

`kernel.createContext().onDispose` 仍是「简单 LIFO 清理」；**不算** compose 的替代品。  
高级保证（状态机、依赖边、卸序、域解析）只存在于 compose。

---

## 2. 吸收表（论文 → 本包不变量）

| 论文 / Cordis | 本包保证 | 刻意不搬 |
|---------------|----------|----------|
| 效应 `(𝑓,𝑔)` + 扭曲复合 LIFO | `scope.effect` 登记 disposer；`dispose` 逆序 await | Proxy `ctx` |
| Effect context 累加器 `𝜑` | 每个 Scope 持有 effect 栈；子 Scope 本身是父的一个 effect | HMR / Yakumo |
| Theorem 61 Recovery exactness | 交错 child dispose 与 sibling effect：测试钉「恢复后无泄漏、无双重 dispose」 | 形式化证明进仓 |
| inject → PENDING | 缺依赖 → `ScopeState.Pending`；**不**假装 ACTIVE | 自动全树 HMR 重挂（C0 不做；C1+ 可选 `onReady`） |
| Theorem 63 Ordering | 撤 provide 前：所有仍 resolve 到该 binding 的消费者 Scope 先进入 Unloading/Disposed；teardown 期间消费者 **仍可读** 即将撤回的值 | 全局服务表 + Reflect |
| Theorem 64 Coherence | 一次 unload/reload 过渡内，inject 解析对着 **同一 committed view**；过渡中禁止半新半旧 | Divert 全演算 |
| `isolate(name, label)` | `RealmKey = { name, label }`；同 label 并域 | `intercept` 配置叠层（C2） |
| Fiber inertia | `dispose()` 可重入：第二次 await 同一次 in-flight promise | `fiber.restart` 热替换（C1） |
| EffectMeta 诊断树 | 可选 `label`；`dumpEffects()` 调试 | Cordis 字符串栈采集 |

---

## 3. 公共面（C0 锁定）

包名：`@xrkseek/compose`  
路径：`packages/compose/`  
导出：稳定、小、可测。

### 3.1 状态

```text
Pending → Loading → Active → Unloading → Disposed
                 ↘ Failed(reason)
```

- **Pending**：声明了 inject，committed view 上尚未齐。  
- **Loading**：正在跑 setup / 登记 effects（可选；同步 setup 可瞬间穿过）。  
- **Active**：可 `provide` / `effect` / 派生子 Scope。  
- **Unloading**：disposers 在跑；**仍允许** `inject` 读到本过渡开始时的 committed 值（Ordering）。  
- **Disposed / Failed**：再 `effect` / `child` / `provide` 抛错。

### 3.2 核心类型（概念）

```ts
type ServiceKey = string | symbol; // 与 kernel 同形，compose 自有导出，避免强耦合运行时

interface RealmRef {
  /** 服务名 */
  name: ServiceKey;
  /** 隔离域；缺省 = 根域 */
  label?: string;
}

interface Scope {
  readonly id: string;
  readonly state: ScopeState;
  readonly parent: Scope | null;

  /** 可逆副作用。返回 disposer；亦可返回 AsyncIterable 逐步 collect（C0 可先只支持 sync/async 单 disposer）。 */
  effect(run: () => Disposer | Promise<Disposer>, meta?: { label?: string }): Disposer;

  /** 子 Scope；随父 dispose。label 写入隔离表（仅对本子树 provide/inject 生效）。 */
  child(opts?: { id?: string; isolate?: RealmRef[] }): Scope;

  /** 登记硬依赖（activate 前）。缺则保持 Pending。类型安全拆自「双用途 inject」。 */
  depend(key: ServiceKey, opts?: { label?: string }): void;

  /** Active / Loading / Unloading 取值；未命中抛 ComposeInjectError。 */
  inject<T>(key: ServiceKey, opts?: { label?: string }): T;

  tryInject<T>(key: ServiceKey, opts?: { label?: string }): T | undefined;

  /** 本 Scope 拥有的提供。卸载时按 Ordering 撤。 */
  provide<T>(key: ServiceKey, value: T, opts?: { label?: string }): Disposer;

  /** 尝试进入 Active：依赖齐则跑可选 `setup`；不齐保持 Pending。 */
  activate(setup?: () => void | Promise<void>): Promise<void>;

  /** 卸本 Scope 及子孙。可重入（inertia）。 */
  dispose(): Promise<void>;
}

function createRootScope(opts?: { id?: string }): Scope;
```

### 3.3 解析规则（空间）

1. `inject(name, { label })` 只看见 **同一 `(name, label)` realm** 上、状态允许的 provide。  
2. 子 Scope 的 `isolate: [{ name, label }]` 把该 name 的默认解析改到 `label`（等价 Cordis isolate，无 Proxy）。  
3. 查找顺序：本 Scope provide → 祖先链同 realm → 未命中则 Pending / 抛（见下）。

### 3.4 `inject` 缺失行为（钉死）

**高级轨：** 不是「静默 undefined」。

| API | 行为 |
|-----|------|
| `depend(key)` 在 **activate 之前** | 只记边，不取值 |
| `activate()` | 依赖不齐 → 保持 `Pending`，**不抛**（Cordis PENDING） |
| `inject(key)` 在 Active / **Loading** / Unloading | 未命中 → **抛** `ComposeInjectError`（防止半活代码读到谎言） |
| `tryInject(key)` | 返回 `T \| undefined`，不抛；测试与探测用 |

`Loading` 允许 `effect` / `provide` / `inject`：setup 回调在进入 Active 前登记可逆副作用（对齐 Cordis apply 窗）。

C0 **不做**「依赖后上线自动 activate」调度器；只预留 `scope.whenReady(cb)` 或根上的 `Graph.notifyProvided` 钩子，C1 再接 Host。

### 3.5 Ordering（卸序）伪码

```text
dispose(scope):
  if inertia: return inertia
  state = Unloading
  snapshot = committedView  // Coherence：本过渡冻结
  // 1) 先卸所有仍依赖「本 Scope 所 provide 之 binding」的消费者 Scope（拓扑：消费者先）
  for consumer in dependents(scope.provides):
    await consumer.dispose()
  // 2) 再卸子 Scope（若尚未被上一步卸掉）
  for child in children (reverse):
    await child.dispose()
  // 3) LIFO effect disposers（teardown 内仍可用 snapshot 读 inject）
  for disposer in effects (reverse):
    await disposer()
  clear provides
  state = Disposed
```

测试必须覆盖：provider dispose 时，consumer 的 disposer **仍能** `inject` 到旧值；之后再读则失败。

### 3.6 与 `kernel` EventBus

- **不**把 EventBus 搬进 compose。  
- 提供薄助手（可选 C0）：`bindDisposable(scope, () => bus.on(...))` → 把 unsubscribe 登记为 effect。  
- waterfall / serial 纪律仍属 kernel 文档。

---

## 4. 非目标（明确后置）

- Cordis / `@deepseek-ai/cordis` 依赖或 API 别名  
- Proxy · `declare module` 全局 augmentation  
- Effect（effect-ts）Layer/Fiber  
- HMR · Loader 配置对账  
- 改写 `runTurn` / session 事件模型  
- C0 接线 `server-host` / Face / `invalidateAgent`（属 C1）

---

## 5. 分期

| 切片 | 交付 | 完成定义 |
|------|------|----------|
| **C0** | 包 + Scope/effect/child/provide/inject/activate/dispose + Ordering/Coherence 测试 + README + 本规格 Accepted + ADR-0005 + status/architecture/AGENTS 依赖纪律一行 | `pnpm check` 绿；compose 单测覆盖核心不变量 |
| **C1** | Host/Face：插件与 agent 缓存失效走 compose 卸序；`whenReady` / 依赖上线唤醒 | 行为测 + 文档 |
| **C2** | `intercept` 等价物 · subagent realm 规格落地 | 先规格再编码 |

---

## 6. 依赖纪律（拟改 AGENTS）

```text
能力叶与 core* → kernel / protocol / compose
compose → kernel（类型/惯例；禁止 compose → core* / server）
server / presets 可选 → compose
禁止：kernel → compose（保持 kernel 更薄）
```

---

## 7. 测试清单（C0 最低）

1. effect LIFO 顺序  
2. 子 Scope 随父 dispose；父 effect 在子卸完后才跑  
3. provide → inject 同域命中  
4. 异 label 不可见（isolate）  
5. 缺依赖 activate → Pending；齐了再 activate → Active  
6. Ordering：dispose provider 时 consumer disposer 仍可读旧值，且 consumer 先于 provider effect 卸  
7. dispose 可重入（inertia）合并为一次  
8. Disposed 后 effect/provide 抛错  
9. 交错两个 sibling child dispose：无双重 disposer、无泄漏（Recovery 工程近似）

---

## 8. 文档触点

- ADR-0005：叶包 compose（本决策）  
- `docs/architecture.md`：平面图加 compose；钉「非 Effect 运行时」  
- `packages/compose/README.md`：公共 API + 非目标  
- `docs/learn/cordis.md` §9：勾选「isolate 等价物规格」→ 本文件  
- `docs/status.md`：C0 后进 Shipped（或 Partial 至 C1 接线）

---

## 9. 自审

- [x] 无「TBD 实现时再说」的核心语义空洞（Pending/Ordering/Realm 已钉）  
- [x] 与 ADR-0002/0004 无矛盾  
- [x] C0 边界清楚（不接线 Host）  
- [x] 未把 EventBus / session 真源拖进本包  
- [x] 「高级」落在不变量与测试，而非 API 堆砌  

---

## 10. 请审阅人确认

1. 本规格 **Accepted** 后才开 C0 编码。  
2. 若要改名（`scope` / `lifecycle`）或要把 `whenReady` 提前进 C0，在本文件改一版再动代码。
