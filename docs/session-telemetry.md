# 会话遥测

> **读者**：集成者 · 运维

OpenTelemetry **会话遥测**缝：`@xrkseek/session-telemetry`。对会话 append 做 live capture，经 `SessionTelemetrySink` 导出；默认实现为 OTLP/HTTP **logs**（JSON），不绑死 OTel JS SDK。

## 契约

| 层 | 内容 |
|----|------|
| Definition | `SessionTelemetrySink`：`emit`（非阻塞入队）· 可选 `flush` · `shutdown` |
| Record | `channel: ledger \| ops` · severity · attributes · body |
| Provider | memory（CI）· OTLP/HTTP logs |
| Consumer | `wrapStoreForSessionTelemetry`（Harness 默认按 env 挂） |

Capture **永不阻断**回合；导出失败丢弃该批。

## 启用

| 条件 | 行为 |
|------|------|
| （默认） | 未设 env → 不挂 sink |
| `XRK_TELEMETRY=0` | 显式关闭 |
| `XRK_TELEMETRY=memory` | 内存 sink |
| `XRK_TELEMETRY=1` + endpoint | OTLP/HTTP logs |
| 仅设 `OTEL_EXPORTER_OTLP_ENDPOINT` / `…_LOGS_ENDPOINT` | 同样启用 OTLP（endpoint 即 opt-in） |

Endpoint 优先：`XRK_TELEMETRY_OTLP_ENDPOINT` → `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/logs`。可选 `OTEL_EXPORTER_OTLP_HEADERS`（`k=v,k2=v2`）。

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
| Consumer | `wrapStoreForSessionTelemetry` (Harness mounts from env by default) |

Capture **never blocks** turns; failed export batches are dropped.

## Enable

| Condition | Behavior |
|-----------|----------|
| (default) | No env → no sink |
| `XRK_TELEMETRY=0` | Explicitly off |
| `XRK_TELEMETRY=memory` | Memory sink |
| `XRK_TELEMETRY=1` + endpoint | OTLP/HTTP logs |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `…_LOGS_ENDPOINT` alone | Also enables OTLP (endpoint is opt-in) |

Endpoint precedence: `XRK_TELEMETRY_OTLP_ENDPOINT` → `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/logs`. Optional `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k2=v2`).

Alongside outbound lifecycle webhooks (`webhooks.json`): webhooks are product notify; this seam is OTel observability export.
