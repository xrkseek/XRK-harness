# @xrkseek/client-ui-agent-preset

English | [中文](README.zh.md)

Agent-preset surfaces: General settings row (default tool surface for new sessions), new-session chip, session-header label, and a settings section for the roster.

XRK Face ships **six** built-in tool surfaces: `minimal`, `shell`, `frugal`, `plan`, `shallow`, and `harness` (UI: **XRK Harness**). Workspace seeds under `.xrk` are separate (personality / rules), not another tool surface. See [docs/profiles.md](../../../docs/profiles.md).

## Why it is a new-session preference

A session's tool surface is fixed when the session is created — the host refuses to adopt an existing session under a different one. Changing the default applies to sessions started afterwards.

## What it reads and writes

Options and the current default both come from one `agentPreset.list` call. The write targets the `agent-presets` settings namespace's `default` field.

Preset files publish one unlocalized `name` and `description` for `user` rows and unknown `system` rows. For the six shipped ids, Web resolves both fields from its active locale when the roster marks the row `system`.

## The management section

Settings page `agent-presets`: roster cards, copy dialog, read-only viewer for shipped compositions. Browser edits no composition YAML — a new preset is a host-side copy.

When the roster still carries a self-referential `cordis` row (foreign / older deployments), a dashed add-card can stage Creator-style drafting; XRK's Face catalog does not include `cordis`.

Deleting removes the preset directory. Sessions already composed from it keep running.

Broken rows (`broken` set) render marked and cannot become default; pickers drop them.

## Related

[docs/profiles.md](../../../docs/profiles.md) · [docs/host-preset.md](../../../docs/host-preset.md)
