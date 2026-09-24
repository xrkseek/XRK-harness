# Topic eval golden tracks

> Hermes-style thematic evals: one named contract per capability spine.
> These are **product golden tracks**, not unit coverage — they pin the
> observable contract a maintainer must not silently regress.

| Track | File | Contract |
|-------|------|----------|
| compact | `golden/compact.track.test.ts` | Overflow → one `context/compaction` → window resumes |
| fan-out | `golden/fan-out.track.test.ts` | Parallel children honor `maxActiveChildren` |
| steer | `golden/steer.track.test.ts` | Steer admits promote ahead of queue; steers coalesce |
| spill | `golden/spill.track.test.ts` | Oversized tool results land under `spill/tool-outputs` |
| session.search | `golden/session-search.track.test.ts` | Face `session.search` finds cross-session literals |

Run:

```bash
pnpm test:evals
# or
pnpm exec vitest run evals/golden
```

Included in root `pnpm test` / `pnpm check` via `vitest.config.ts` `evals/**/*.track.test.ts`.
