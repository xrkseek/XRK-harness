# Standing seeds (`~/.xrk`)

Shared across **every** product surface (coding · 干员 · Xiangyang · IM). Keep this layer **common** — no badge-, workspace-, or tool-gated playbooks here.

| File | Policy | Inject | Purpose |
|------|--------|--------|---------|
| `AGENTS.md` | **fingerprint** — rewrite when the bundle moves | yes | Standing voice, stance, progressive disclosure, skill routing, thin engineering invariants |
| `SOUL.md` | **fingerprint** — same as AGENTS | yes | Product default persona tone |

**User edits:** put lasting persona in **`{workspace}/.agents/SOUL.md`** (or `IDENTITY.md`). Home `~/.xrk/SOUL.md` is a product seed — Host rewrites it when the bundled fingerprint moves (same as `AGENTS.md`).

**Per-session / on-demand (not standing)**

| Channel | Where |
|---------|--------|
| Permission × tool surface (+ briefs) | Face `<session_capability>` |
| IM / 奇创 role | Face `<session_posture>` |
| 支线 / presence · 主线 · canvas · attachments · … | Skills + that tool’s description |

**When seeds run:** every Host establish — `xrkh web` / `serve` / `restart`, and Desktop Host boot. Bundle: `@xrkseek/harness-cli/seeds/`.

Do **not** copy standing files or `seeds/skills` into a workspace `.agents/` wholesale — Host already injects `~/.xrk/` plus the overlay. Only author the overlay files you mean to own.
