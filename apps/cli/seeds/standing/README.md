# Standing seeds (`~/.xrk`)

**Audience:** product employees (every seat). Write **handbook** behavior here — not inject architecture, fingerprint policy, or monorepo maintainer notes (those stay in repo-root `AGENTS.md` · `docs/workspace-inject.md` · skill `xrk-inject-layer`).

`AGENTS.md` / `SOUL.md` are shared across **every** product surface (coding · 干员 · Xiangyang · IM). Keep that layer **common** — no badge-, workspace-, or tool-gated playbooks.

| File | Policy | Inject | Purpose |
|------|--------|--------|---------|
| `AGENTS.md` | **fingerprint** — Host overwrites `~/.xrk` when the bundle moves | **every** audience | Employee handbook: stance · how you work · skill route · craft |
| `SOUL.md` | **fingerprint** — same | **every** audience | Default persona tone |
| `XRK.md` | **fingerprint** — same path / refresh as AGENTS | **`audience=user` only**（经理 · 向日葵 · 经理特调父席） | Workspace-frequent ledger；**never** 干员家 / delegated child |

**User lasting persona:** `{workspace}/.xrk/SOUL.md` (or `IDENTITY.md`). Optional project overlay ledger: `{workspace}/.xrk/XRK.md` (same audience gate). Industry overlays: workspace `.agents/` (AGENTS/rules/context/skills) — not SOUL.

**When seeds run:** every Host establish — `xrkh web` / `serve` / `restart`, Desktop Host boot. Bundle: `@xrkseek/harness-cli/seeds/`.

Do **not** copy standing files or `seeds/skills` into a workspace `.agents/` wholesale — Host already injects `~/.xrk/` plus the overlay.
