---
name: xrk-craft
description: >-
  Craft ladder and coding discipline for XRK-Harness agents. Use before writing
  non-trivial code, when choosing reuse vs new code, or when the user says
  手艺、惰性、YAGNI、最小改动、root cause.
---

# Craft

Lazy means efficient, not careless. The best code is the code never written.

## Ladder (stop at the first rung that holds)

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse it.
3. Does the standard library already do this?
4. Does a native platform feature cover it?
5. Does an already-installed dependency solve it?
6. Can this be one line?
7. Only then: write the minimum that works.

Read the task and the code it touches end to end, **then** climb. Never re-derive the ladder in chat — point at it.

## Bug fix

A report names a symptom. Grep every caller of the function you touch; fix the **shared** function once. Patching only the ticket path leaves sibling callers broken.

## Rules

- No abstractions that weren't requested.
- No new dependency if avoidable.
- Deletion over addition. Boring over clever. Fewest files.
- Shortest *correct* diff — wrong-place small diffs are a second bug.
- Mark deliberate ceilings (global lock, O(n²), naive heuristic) with a short comment naming the ceiling and upgrade path.
- Non-trivial logic leaves **one** runnable check (assert demo or one small test; no frameworks).
- Do not invent unfinished APIs. Do not skip `pnpm check` on non-trivial product changes.
