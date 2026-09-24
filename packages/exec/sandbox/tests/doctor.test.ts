import { describe, expect, it } from "vitest";
import { probeSandboxEnvironment } from "../src/doctor.js";

describe("probeSandboxEnvironment", () => {
  it("reports workspace backend as ready without a helper", () => {
    const probe = probeSandboxEnvironment({
      env: { XRK_SANDBOX_BACKEND: "workspace" },
    });
    expect(probe.backend).toBe("workspace");
    expect(probe.ok).toBe(true);
    expect(probe.checks.find((c) => c.name === "sandbox-helper")?.detail).toMatch(
      /no external helper/,
    );
  });

  it("fails closed for windows backend without a helper", () => {
    const probe = probeSandboxEnvironment({
      env: { XRK_SANDBOX_BACKEND: "windows" },
      platform: "win32",
    });
    expect(probe.backend).toBe("windows");
    expect(probe.ok).toBe(false);
    expect(probe.checks.find((c) => c.name === "sandbox-helper")?.ok).toBe(false);
  });

  it("accepts windows helper when path exists on PATH name", () => {
    const probe = probeSandboxEnvironment({
      env: {
        XRK_SANDBOX_BACKEND: "windows",
        XRK_SANDBOX_WINDOWS_HELPER: "xrk-windows-sandbox-helper",
      },
      platform: "win32",
    });
    expect(probe.ok).toBe(true);
    expect(probe.checks.find((c) => c.name === "sandbox-helper")?.detail).toMatch(
      /helper ready/,
    );
  });

  it("fails docker backend when image is unset", () => {
    const probe = probeSandboxEnvironment({
      env: {
        XRK_SANDBOX_BACKEND: "docker",
        XRK_SANDBOX_DOCKER_BIN: "docker-not-a-real-bin-xyz",
      },
    });
    expect(probe.backend).toBe("docker");
    expect(probe.ok).toBe(false);
  });
});
