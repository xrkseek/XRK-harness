# @xrkseek/compose

Spatiotemporal composition leaf: reversible effects, reactive deps, Ordering, isolate realms — **without** Cordis Proxy or Effect-TS.

## Public API

- `createRootScope` — Active root
- `Scope.depend` / `activate` — hard deps; missing → stay `Pending`
- `Scope.provide` / `inject` / `tryInject` — realm-keyed bindings
- `Scope.effect` — LIFO disposers
- `Scope.child({ isolate, depend })` — child scopes + isolate labels
- `Scope.dispose` — Ordering (consumers → children → effects); inertia-safe
- `bindDisposable` — register an unsubscribe as an effect

## Non-goals

- Cordis / `@deepseek-ai/cordis` compatibility
- Proxy god `ctx`, HMR, Loader
- Session / agent-loop semantics (Host wiring = C1)

## Spec

[docs/superpowers/specs/2026-08-15-compose-design.md](../../docs/superpowers/specs/2026-08-15-compose-design.md) · [ADR-0005](../../docs/adr/0005-compose-leaf.md)
