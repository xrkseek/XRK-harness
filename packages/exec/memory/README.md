# @xrkseek/exec-memory

Curated memory files frozen into the system prompt at session start.

- **Definition**: `CuratedMemoryStore` / `MemoryProvider` (`add` / `replace` / `remove`, plus an atomic batch)
- **Providers**: default **file** (`MEMORY.md` / `USER.md` under `{XRK_HOME}/memories`); optional **HTTP** and **sqlite** samples
- **Consumer**: `createCuratedMemoryTools` → `memory`
- **Consolidate**: Phase1 heuristic session-end; optional Phase2 LLM extract (`consolidateCuratedMemoryPhase2`)

The prompt block is the snapshot taken when the store is created. Tool writes update the backend and leave that snapshot alone. This is not the Mnemon document library.

Select via `resolveMemoryProvider` / `XRK_MEMORY_PROVIDER=file|http|sqlite` (+ `XRK_MEMORY_HTTP_URL` for http).

See [docs/curated-memory.md](../../../docs/curated-memory.md).
