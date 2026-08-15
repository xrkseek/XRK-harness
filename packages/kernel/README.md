# @xrkseek/kernel

Explicit DI context, plugins, event bus (emit / waterfall / serial), and config patch layering.

## Public API

- `createContext` — service bag + dispose stack (no Proxy)
- `definePlugin` / `createPluginRegistry`
- `createEventBus` — `emit`, `waterfall` (must `next()`), `serial`
- `applyPatches` — replace-by-id, no deep merge

## Non-goals

- Cordis compatibility
- Global runtime / god object
- Business tools or LLM adapters

## Status

M0 / S4 implementation. Kernel coverage ≥90% is gated by `pnpm test:kernel-coverage` (also part of `pnpm check`).
