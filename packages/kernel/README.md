# @xrkseek/kernel

Explicit DI context, plugins, event bus (emit / waterfall / serial), and config patch layering.

## Public API

- `createContext` — service bag + dispose stack (no Proxy)
- `definePlugin` / `createPluginRegistry`
- `createEventBus` — `emit`, `waterfall` (must `next()`), `serial`
- `applyPatches` — replace-by-id, no deep merge

## Non-goals

- Scope / Ordering（见 `@xrkseek/compose`）
- Global runtime / god object
- Business tools or LLM adapters

## Status

Kernel coverage ≥90% 由 `pnpm test:kernel-coverage`（含于 `pnpm check`）门禁。
