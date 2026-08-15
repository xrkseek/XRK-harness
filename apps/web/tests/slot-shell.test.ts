import { describe, expect, it } from "vitest";
import { activateBootComposition } from "../src/boot-composition.js";
import { ShellController } from "../src/shell-controller.js";
import { mountSidebar } from "../src/shell/panels/sidebar.js";
import { mountConversation } from "../src/shell/panels/conversation.js";
import { mountStatusLine } from "../src/shell/panels/status.js";

describe("slot-shell", () => {
  it("chrome slots declare list|keyed|list and panel contributions win", () => {
    const ctl = new ShellController("http://127.0.0.1:8787");
    activateBootComposition(ctl.gate, ctl);
    expect(ctl.gate.getSnapshot().phase).toBe("settled");

    ctl.slots.register(
      {
        name: "chrome.sidebar",
        id: "sessions",
        order: 10,
        registrant: "test-sidebar",
      },
      mountSidebar,
    );
    ctl.slots.register(
      {
        name: "chrome.sidebar",
        id: "workspace",
        order: 20,
        registrant: "test-workspace",
      },
      () => {},
    );
    ctl.slots.register(
      {
        name: "chrome.main",
        key: "conversation",
        registrant: "test-conversation",
      },
      mountConversation,
    );
    ctl.slots.register(
      {
        name: "chrome.status",
        id: "boot",
        order: 10,
        registrant: "test-boot",
      },
      mountStatusLine,
    );

    const sidebar = ctl.slots.entriesOfSlot("chrome.sidebar");
    expect(sidebar.map((e) => e.options.id).sort()).toEqual([
      "sessions",
      "workspace",
    ]);

    const main = ctl.slots.entriesOfSlot("chrome.main");
    expect(main).toHaveLength(1);
    expect(main[0]?.options.key).toBe("conversation");

    const status = ctl.slots.entriesOfSlot("chrome.status");
    expect(status.some((e) => e.options.id === "boot")).toBe(true);

    const snap = ctl.slots.snapshot("root");
    expect(snap[0]?.children.map((c) => c.name).sort()).toEqual([
      "chrome.main",
      "chrome.sidebar",
      "chrome.status",
    ]);
  });
});
