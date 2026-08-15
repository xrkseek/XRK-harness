import { describe, expect, it } from "vitest";
import { BootGate } from "@xrkseek/web-runtime";
import {
  activateBootComposition,
  BOOT_ENTRY_IDS,
  formatBootReport,
} from "../src/boot-composition.js";
import { ShellController } from "../src/shell-controller.js";

describe("boot-composition", () => {
  it("settles when all local entries activate", () => {
    const ctl = new ShellController("http://127.0.0.1:8787");
    activateBootComposition(ctl.gate, ctl);
    const snap = ctl.gate.getSnapshot();
    expect(snap.phase).toBe("settled");
    for (const id of BOOT_ENTRY_IDS) {
      expect(snap.status[id]).toBe("active");
    }
    expect(ctl.slots.spec("chrome.sidebar")?.kind).toBe("list");
    expect(ctl.slots.spec("chrome.main")?.kind).toBe("keyed");
    expect(ctl.slots.spec("chrome.status")?.kind).toBe("list");
  });

  it("fails loud when an entry is forced failed — no settle", () => {
    const ctl = new ShellController("http://127.0.0.1:8787");
    activateBootComposition(ctl.gate, ctl, { forceFail: "face-client" });
    const snap = ctl.gate.getSnapshot();
    expect(snap.phase).toBe("failed");
    expect(snap.status["face-client"]).toBe("failed");
    expect(formatBootReport(ctl.gate)).toContain("face-client");
  });

  it("fails loud when an activator throws", () => {
    const ctl = new ShellController("http://127.0.0.1:8787");
    activateBootComposition(ctl.gate, ctl, {
      activators: {
        connection: () => {
          throw new Error("no endpoint");
        },
      },
    });
    const snap = ctl.gate.getSnapshot();
    expect(snap.phase).toBe("failed");
    expect(snap.report).toMatch(/connection.*no endpoint/);
  });

  it("BootGate alone: empty register set never settles", () => {
    const gate = new BootGate();
    expect(gate.getSnapshot().phase).toBe("booting");
    gate.register("only", "loading");
    expect(gate.getSnapshot().phase).toBe("booting");
  });
});
