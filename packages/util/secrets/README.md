# @xrkseek/secrets

Secret store Providers + unified log redaction (Codex-style keyring-store + sanitizer).

## Definition / Provider

| Layer | Role |
|-------|------|
| **Definition** | `SecretStore` (`load` / `save` / `delete` by service+account) |
| **Provider** | `createMemorySecretStore` · `createOsKeyringStore` (dynamic `keytar` probe; missing → `available: false`) |
| **Resolve** | `resolveSecretStore(env)` via `XRK_SECRETS_BACKEND` |

| `XRK_SECRETS_BACKEND` | Behavior |
|------------------------|----------|
| unset / `file` | No overlay — Face keeps `~/.xrk/.credentials.yaml` |
| `memory` | In-process store (CI) |
| `keyring` | OS keyring via optional `keytar` (`pnpm add keytar`); if missing → `available: false` (honest) |

Face may dual-write slots with `syncSlotToSecretStore` / hydrate with `loadSlotFromSecretStore`.

## Redaction

`redactSecrets(text)` — best-effort strip of `sk-…`, Bearer tokens, AWS AKIA, `api_key=` assignments.  
`wrapLoggerForSecrets(logger)` — wrap CLI / Host sinks.

Not the settings schema `role('secret')` walker (`@xrkseek/xrk-settings`).

See [docs/configuration.md](../../../docs/configuration.md) · [docs/seams.md](../../../docs/seams.md).
