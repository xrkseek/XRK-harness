# 产品壳性能工程

> **读者**：贡献者 · 维护者（改 `apps/web` / `packages/client` / Desktop 壳）

**原则：动效与手感保留，去掉多余布局工作。** 栏位滑动、座位收放、进出场仍在；优化只针对「每帧重排重内容」这类常见问题。存储 / 打开链路取证见 [perf-ux-audit](./perf-ux-audit.md)。

## 目标

| 指标 | 目标 |
|------|------|
| 概况 / 侧栏开合 | 动效完整，目视流畅（约 ≥55fps） |
| 动画窗内主线程 | 尽量无 >50ms long task |
| `prefers-reduced-motion` | 立即到位、无过渡 |

## 常用做法（已落地）

| 做法 | 含义 | 落点 |
|------|------|------|
| **轨道缓动 + 内容钉宽** | `grid-template-columns` 仍缓动；概况/侧栏子树钉在开态宽，由 `overflow: hidden` 裁切，避免每帧重排 | `ui-layout` `AppFrame` · `--xrk-details-anim-width` / `--xrk-sidebar-anim-width` |
| **座位缓宽 + 芯片钉宽** | 顶栏座位 `width` 可缓；芯片几何固定（勿在 `height:0` 座位上加 `overflow:hidden` / `contain:paint`，会裁掉球） | `ui-plan` `PresenceDock` |
| **合成器属性** | 手机抽屉 / 表用 `transform` + `opacity` | `AppFrame` phone 路径 |
| **开栏后 hydrate** | 重引擎等退场完成再启 | `PRESENCE_RAIL_HANDOFF_MS` |
| **contain** | 动画窗隔离 layout/paint | `[data-animating]` 列 · Presence 座位 |

不砍：时长曲线、`data-animating`、社区皮肤钩子、进出场 keyframes。  
不堆：第二套宽度 transition、无测量的「感觉」大改。

## PR 清单

- [ ] 动效是否还在（开合仍有滑动 / 淡入淡出）？
- [ ] 若缓动触及 layout 属性：是否钉宽 + 裁切 / `contain`？
- [ ] `prefers-reduced-motion` 是否仍立即到位？
- [ ] 相关 vitest / 手测（概况、侧栏、顶栏球）？

```bash
pnpm exec vitest run --config vitest.client.config.ts packages/client/ui-layout/tests/app-frame.client.spec.tsx
pnpm build:desktop && pnpm start:desktop   # 隔离 userData，勿与已安装版抢锁
```

## 相关

[host-face](./host-face.md) · [sidebar-workbench](./sidebar-workbench.md) · [testing](./testing.md) · 笔记 `.cursor/rules/xrk-shell-motion.mdc`

---

# Product shell performance

> **Audience**: Contributors · maintainers (`apps/web` / `packages/client` / Desktop shell)

**Keep motion and feel; cut redundant layout work.** Column slides, seat collapse, and enter/exit stay. Optimize the common failure mode: reflowing heavy subtrees every animation frame. Forensics for storage / open path: [perf-ux-audit](./perf-ux-audit.md).

## Goals

| Metric | Target |
|--------|--------|
| Overview / sidebar toggle | Full motion, visually smooth (~≥55fps) |
| Main thread in the animation window | Avoid >50ms long tasks |
| `prefers-reduced-motion` | Snap with no transition |

## Common patterns (shipped)

| Pattern | Meaning | Where |
|---------|---------|--------|
| **Ease tracks, pin content** | Keep `grid-template-columns` easing; pin Overview/sidebar children to open width; clip with `overflow: hidden` | `ui-layout` `AppFrame` · `--xrk-details-anim-width` / `--xrk-sidebar-anim-width` |
| **Ease seat, pin chip** | Seat `width` may ease; chip geometry stays fixed (do not put `overflow:hidden` / `contain:paint` on the `height:0` seat — that clips the ball away) | `ui-plan` `PresenceDock` |
| **Compositor props** | Phone drawer/sheet: `transform` + `opacity` | `AppFrame` phone path |
| **Hydrate after open** | Heavy engines after dock exit | `PRESENCE_RAIL_HANDOFF_MS` |
| **contain** | Isolate layout/paint during motion | `[data-animating]` columns · Presence seat |

Do not remove: timing curves, `data-animating`, community skin hooks, enter/exit keyframes.  
Do not add: a second competing width transition, unmeasured “feel” rewrites.

## PR checklist

- [ ] Motion still present (slide / fade on toggle)?
- [ ] If easing layout properties: pin width + clip / `contain`?
- [ ] `prefers-reduced-motion` still snaps?
- [ ] Vitest / manual (Overview, sidebar, header ball)?

```bash
pnpm exec vitest run --config vitest.client.config.ts packages/client/ui-layout/tests/app-frame.client.spec.tsx
pnpm build:desktop && pnpm start:desktop   # isolated userData; do not fight installed single-instance
```

## Related

[host-face](./host-face.md) · [sidebar-workbench](./sidebar-workbench.md) · [testing](./testing.md) · notes `.cursor/rules/xrk-shell-motion.mdc`
