import { describe, expect, it } from "vitest";
import {
  classifyToolExecutionMode,
  createToolRegistry,
} from "../src/index.js";

describe("classifyToolExecutionMode", () => {
  it("defaults to exclusive without isConcurrencySafe", () => {
    const registry = createToolRegistry();
    registry.register({
      name: "write",
      description: "w",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
    });
    expect(
      classifyToolExecutionMode(registry, {
        id: "1",
        name: "write",
        arguments: {},
      }),
    ).toEqual({ kind: "exclusive" });
  });

  it("is parallel only for exact true", () => {
    const registry = createToolRegistry();
    registry.register({
      name: "read",
      description: "r",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
      isConcurrencySafe: () => true,
    });
    registry.register({
      name: "maybe",
      description: "m",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
      isConcurrencySafe: () => "yes" as unknown as boolean,
    });
    registry.register({
      name: "boom",
      description: "b",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
      isConcurrencySafe() {
        throw new Error("nope");
      },
    });
    expect(
      classifyToolExecutionMode(registry, {
        id: "1",
        name: "read",
        arguments: {},
      }).kind,
    ).toBe("parallel");
    expect(
      classifyToolExecutionMode(registry, {
        id: "2",
        name: "maybe",
        arguments: {},
      }).kind,
    ).toBe("exclusive");
    expect(
      classifyToolExecutionMode(registry, {
        id: "3",
        name: "boom",
        arguments: {},
      }).kind,
    ).toBe("exclusive");
  });
});
