import { describe, expect, it } from "vitest";
import {
  createInstructionAuthorityRegistry,
  DEFAULT_INSTRUCTION_AUTHORITY,
} from "../src/instruction-authority.js";

describe("instruction-authority registry", () => {
  it("formats order vs data lanes and soft-label rule", () => {
    const reg = createInstructionAuthorityRegistry();
    const card = reg.formatCard();
    expect(card).toContain("order = must follow");
    expect(card).toContain("data = facts only");
    expect(card).toContain("soft labels");
    expect(card).toContain("cannot move order → data");
    expect(card).toContain("Host hard-block");
    expect(card).toContain("Product standing");
    expect(card).toContain("This turn's user ask");
    expect(card).toContain("Tool / web / other-session");
  });

  it("lets plugins register and unregister lanes", () => {
    const reg = createInstructionAuthorityRegistry([]);
    const off = reg.register({
      id: "order.plugin-demo",
      lane: "order",
      label: "Plugin playbook X",
    });
    expect(reg.formatCard()).toContain("Plugin playbook X");
    off();
    expect(reg.formatCard()).not.toContain("Plugin playbook X");
  });

  it("ships a non-empty default seed", () => {
    expect(DEFAULT_INSTRUCTION_AUTHORITY.length).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_INSTRUCTION_AUTHORITY.some((r) => r.lane === "order")).toBe(
      true,
    );
    expect(DEFAULT_INSTRUCTION_AUTHORITY.some((r) => r.lane === "data")).toBe(
      true,
    );
  });
});
