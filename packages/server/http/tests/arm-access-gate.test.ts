/**
 * armAccessGateForListen — remint PINs on non-loopback web/serve start.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  armAccessGateForListen,
  patchMobileAccessState,
  readMobileAccessState,
} from "../src/dsh-compat/mobile-access.js";

describe("armAccessGateForListen", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "xrk-arm-gate-"));
    homes.push(home);
    return home;
  }

  it("leaves loopback binds idle", () => {
    const xrkHome = freshHome();
    const result = armAccessGateForListen({ xrkHome }, "127.0.0.1", 8787);
    expect(result.armed).toBe(false);
    expect(readMobileAccessState({ xrkHome }).running).toBe(false);
  });

  it("arms and remints PINs for a private LAN bind", () => {
    const xrkHome = freshHome();
    patchMobileAccessState(
      { xrkHome },
      { lanToken: "11111111", wanToken: "22222222", running: false },
    );
    const first = armAccessGateForListen({ xrkHome }, "10.79.42.51", 8787);
    expect(first.armed).toBe(true);
    expect(first.origin).toBe("http://10.79.42.51:8787");
    expect(first.lanToken).toMatch(/^\d{8}$/);
    expect(first.wanToken).toMatch(/^\d{8}$/);
    expect(first.lanToken).not.toBe("11111111");
    expect(first.wanToken).not.toBe("22222222");
    expect(readMobileAccessState({ xrkHome }).running).toBe(true);

    const second = armAccessGateForListen({ xrkHome }, "10.79.42.51", 8787);
    expect(second.wanToken).not.toBe(first.wanToken);
  });

  it("keeps custom PINs across remint", () => {
    const xrkHome = freshHome();
    patchMobileAccessState(
      { xrkHome },
      {
        lanToken: "87654321",
        wanToken: "12345678",
        lanPinCustom: true,
        wanPinCustom: true,
        running: false,
      },
    );
    const armed = armAccessGateForListen({ xrkHome }, "10.0.0.5", 8787);
    expect(armed.armed).toBe(true);
    expect(armed.lanToken).toBe("87654321");
    expect(armed.wanToken).toBe("12345678");
  });
});
