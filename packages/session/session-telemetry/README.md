# @xrkseek/session-telemetry

OpenTelemetry session-telemetry seam (capture + OTLP/HTTP logs export).

- **Definition**: `SessionTelemetrySink` (`emit` · optional `flush` · `shutdown`)
- **Provider**: memory sink · OTLP/HTTP JSON logs (no OTel SDK dependency)
- **Consumer**: `wrapStoreForSessionTelemetry` mirrors session appends (DSH-style live capture)

Env: `XRK_TELEMETRY=memory` | `XRK_TELEMETRY=1` + OTLP endpoint (`XRK_TELEMETRY_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_*`).

See [docs/session-telemetry.md](../../../docs/session-telemetry.md).
