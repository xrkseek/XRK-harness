# @xrkseek/exec-memory

Curated memory files frozen into the system prompt at session start.

- **Definition**: `CuratedMemoryStore` (`add` / `replace` / `remove`, plus an atomic batch of those)
- **Provider**: `MEMORY.md` and `USER.md` under `{XRK_HOME}/memories`
- **Consumer**: `createCuratedMemoryTools` → `memory`

The prompt block is the snapshot taken when the store is created. Tool writes update the files and leave that snapshot alone. This is not the Mnemon document library.

See [docs/curated-memory.md](../../../docs/curated-memory.md).
