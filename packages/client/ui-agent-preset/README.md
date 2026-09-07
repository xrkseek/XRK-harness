# @xrkseek/client-ui-agent-preset

Agent-preset settings row, hero chip, header label, and management section.

## Built-in badges

XRK Face ships **five** built-in tool surfaces: `minimal` · `shell` · `frugal` · `shallow` · `harness` (UI: **XRK Harness**). Plan mode is **`/plan`**, not a badge. Workspace seeds under `.xrk` are separate (personality / rules), not another tool surface. See [docs/profiles.md](../../../docs/profiles.md).

## Settings wiring

`agentPreset.list` once yields the roster and the default; writes go to `agent-presets.default`.

Preset files publish one unlocalized `name` and `description` for `user` rows and unknown `system` rows. For the five shipped ids, Web resolves both fields from its active locale when the roster marks the row `system`.

Settings page `agent-presets`: roster cards, copy dialog, read-only viewer for shipped compositions. Browser edits no composition YAML — a new preset is a host-side copy.
