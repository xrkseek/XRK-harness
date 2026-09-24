# 会话遥测

> **读者**：集成者 · 运维

OpenTelemetry **会话遥测**缝：`@xrkseek/session-telemetry`。对会话 append 做 live capture，经 `SessionTelemetrySink` 导出；默认实现为 OTLP/HTTP **logs**（JSON），不绑死 OTel JS SDK。

## 契约

| 层 | 内容 |
|----|------|
| Definition | `SessionTelemetrySink`：`emit`（非阻塞入队）· 可选 `flush` · `shutdown` |
| Record | `channel: ledger \| ops` · severity · attributes · body |
| Provider | memory（CI）· OTLP/HTTP logs |
| Consumer | `wrapStoreForSessionTelemetry`（Harness 按 Face Settings 与/或 env 挂） |

Capture **永不阻断**回合；导出失败丢弃该批。

## 启用

| 条件 | 行为 |
|------|------|
| Settings → Plugins → **Session telemetry**（`session-telemetry`） | 产品真源：`mode=off\|memory\|otlp` + 可选 `endpoint`（落 `~/.xrk/settings.yaml`）；需重启 Host |
| （默认） | Face `mode=off` 且未设 env → 不挂 sink |
| `XRK_TELEMETRY` 非空 | **CI 旁路**：盖过 Settings（`0` 关 · `memory` · `1`/`otlp`） |
| 仅设 `OTEL_EXPORTER_OTLP_ENDPOINT` / `…_LOGS_ENDPOINT`（且未设 Face product / `XRK_TELEMETRY`） | 同样启用 OTLP（endpoint 即 opt-in；CLI/无 Face 路径） |

Endpoint 优先：Settings `endpoint` → `XRK_TELEMETRY_OTLP_ENDPOINT` → `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/logs`。可选 `OTEL_EXPORTER_OTLP_HEADERS`（`k=v,k2=v2`）。

与出站 lifecycle webhook（`webhooks.json`）并列：webhook 是业务通知；本缝是 OTel 可观测导出。

---

# Session telemetry

> **Audience**: Integrators · Operators

OpenTelemetry **session-telemetry** seam: `@xrkseek/session-telemetry`. Live-captures session appends into a `SessionTelemetrySink`; default Provider is OTLP/HTTP **logs** (JSON) without the OTel JS SDK.

## Contract

| Layer | Content |
|-------|---------|
| Definition | `SessionTelemetrySink`: non-blocking `emit` · optional `flush` · `shutdown` |
| Record | `channel: ledger \| ops` · severity · attributes · body |
| Provider | memory (CI) · OTLP/HTTP logs |
| Consumer | `wrapStoreForSessionTelemetry` (Harness mounts from Face Settings and/or env) |

Capture **never blocks** turns; failed export batches are dropped.

## Enable

| Condition | Behavior |
|-----------|----------|
| Settings → Plugins → **Session telemetry** (`session-telemetry`) | Product SoT: `mode=off\|memory\|otlp` + optional `endpoint` (in `~/.xrk/settings.yaml`); Host restart required |
| (default) | Face `mode=off` and no env → no sink |
| Non-empty `XRK_TELEMETRY` | **CI bypass** over Settings (`0` off · `memory` · `1`/`otlp`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `…_LOGS_ENDPOINT` alone (no Face product / no `XRK_TELEMETRY`) | Also enables OTLP (endpoint is opt-in; CLI / no-Face paths) |

Endpoint precedence: Settings `endpoint` → `XRK_TELEMETRY_OTLP_ENDPOINT` → `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/logs`. Optional `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k2=v2`).

Alongside outbound lifecycle webhooks (`webhooks.json`): webhooks are product notify; this seam is OTel observability export.
