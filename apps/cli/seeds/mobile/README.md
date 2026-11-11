# Mobile skill seeds (build-time merge)

> **Audience**: Maintainers · Coding Agents packing mobile guest runtime.

Same fingerprint establish as Desktop/CLI — **no Host/establish fork**.

| Path | Role |
|------|------|
| `seeds/skills/` | Universal product seeds (Desktop · CLI · Mobile) |
| `seeds/mobile/skills/` | Phone-only sources (`xrk-phone`, …) |
| Flutter `assets/skills/` | App-shell HOWTO (`xrk-guide` · `xrk-ui` · `xrk-support`) — managed install, not here |

**Desktop / npm / ordinary CLI:** establish only reads `seeds/skills/`. This
`mobile/` tree **must ship** in `@xrkseek/harness-cli` (stage gate) but is
**never** established there.

**Mobile guest runtime** (`XRK-harness-mobile/runtime/build-runtime.sh`):
after installing harness-cli, **hard-fail** if `seeds/mobile/skills/xrk-phone`
is missing; otherwise copy `seeds/mobile/skills/*` → `seeds/skills/`. Guest
establish then refreshes them like any other product seed.

| Surface | Source of truth |
|---------|-----------------|
| `phone_*` tools | Mobile `PhoneToolCatalog` → guest plugin `xrk-mobile` |
| Phone prompt section | Mobile asset `xrk-mobile-prompt` (while control on) |
| Phone AGENTS inject | `PhoneGuest.AGENTS_SECTION` (while control on) |
| Phone playbook skill | This tree → merge → `$XRK_HOME/skills/xrk-phone` |

**Hard rules:** do not put phone playbooks in universal `seeds/skills/` or
standing `AGENTS.md`. Do not add `XRK_MOBILE_*` branches to establish.
