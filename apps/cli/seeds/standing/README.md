# Standing seeds (`~/.xrk`)

| File | Policy | Inject | Purpose |
|------|--------|--------|---------|
| `AGENTS.md` | **fingerprint** — rewrite when the bundle moves | yes | Always-on standing: voice, craft ladder, presence, workflow |
| `SOUL.md` | **create-once** — install only if missing | yes | User-editable persona |

**When seeds run:** every Host establish — `xrkh web` / `serve` / `restart`, and Desktop Host boot (`@xrkseek/harness-desktop-host`). Bundle lives in `@xrkseek/harness-cli/seeds/` (shipped with CLI and with the Desktop host tree).

Workspace overlays (`.agents/AGENTS.md` · `.agents/SOUL.md`) still win for project-specific voice.
