import { describe, expect, it } from "vitest";
import {
  entriesFromPluginFailures,
  formatStartupDiagnostic,
  isPendingServiceMessage,
  missingServicesFromMessage,
  StartupError,
} from "../src/startup-audit.js";
import { RequiredPluginLoadError } from "../src/load-failures.js";

describe("startup-audit", () => {
  it("detects pending service messages", () => {
    expect(
      isPendingServiceMessage("pending (waiting for service: webServer)"),
    ).toBe(true);
    expect(isPendingServiceMessage("failed to import")).toBe(false);
    expect(missingServicesFromMessage("waiting for services: a, b")).toEqual([
      "a",
      "b",
    ]);
  });

  it("formats Failed vs Waiting sections", () => {
    const text = formatStartupDiagnostic([
      {
        id: "boom",
        required: true,
        outcome: { kind: "failed", error: new Error("cannot listen") },
      },
      {
        id: "waiter",
        required: false,
        outcome: { kind: "pending", missing: ["webServer"] },
      },
    ]);
    expect(text).toContain("Failed plugins (1):");
    expect(text).toContain("boom");
    expect(text).toContain("cannot listen");
    expect(text).toContain("Plugins waiting for services (1):");
    expect(text).toContain("webServer");
  });

  it("RequiredPluginLoadError classifies pending from message", () => {
    const err = new RequiredPluginLoadError([
      {
        id: "need",
        required: true,
        message: "pending (waiting for service: faceRuntime)",
      },
      { id: "bad", required: true, message: "failed to import" },
    ]);
    expect(err).toBeInstanceOf(StartupError);
    expect(err.message).toContain("Failed plugins");
    expect(err.message).toContain("Plugins waiting for services");
    expect(err.entries.some((e) => e.outcome.kind === "pending")).toBe(true);
    expect(err.entries.some((e) => e.outcome.kind === "failed")).toBe(true);
  });

  it("entriesFromPluginFailures honors explicit kind", () => {
    const entries = entriesFromPluginFailures([
      {
        id: "x",
        required: true,
        message: "whatever",
        kind: "pending",
        missing: ["svc"],
      },
    ]);
    expect(entries[0]?.outcome).toEqual({
      kind: "pending",
      missing: ["svc"],
    });
  });
});
