import { describe, expect, it } from "vitest";
import {
  legacyAdmitRpcId,
  rebuildAdmitRpcMaps,
} from "../src/admit-rpc-rebuild.js";

describe("rebuildAdmitRpcMaps", () => {
  it("prefers durable rpcId and mints legacy ids otherwise", () => {
    const admitRpcMap = new Map<string, string>();
    const rpcAdmitMap = new Map<string, string>();
    rebuildAdmitRpcMaps(
      [
        {
          admitId: "a1",
          sessionId: "s",
          content: "x",
          delivery: "steer",
          rpcId: "rpc-a",
        },
        {
          admitId: "a2",
          sessionId: "s",
          content: "y",
          delivery: "queue",
        },
      ],
      { admitRpcMap, rpcAdmitMap },
    );
    expect(admitRpcMap.get("a1")).toBe("rpc-a");
    expect(admitRpcMap.get("a2")).toBe(legacyAdmitRpcId("a2"));
    expect(rpcAdmitMap.get("rpc-a")).toBe("a1");
    expect(rpcAdmitMap.get(legacyAdmitRpcId("a2"))).toBe("a2");
  });
});
