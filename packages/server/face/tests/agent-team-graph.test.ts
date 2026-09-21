import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTeamGraph } from "../src/agent-team-graph.js";
import { FaceSubagentRegistry } from "../src/subagent-registry.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent team graph", () => {
  it("stores delegation edges and peer links", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-team-"));
    temps.push(dir);
    const registryPath = path.join(dir, "subagents.json");
    const graphPath = path.join(dir, "agent-team-graph.json");
    const graph = new AgentTeamGraph(graphPath);
    const registry = new FaceSubagentRegistry(registryPath, {
      onAttach: (link) => graph.recordDelegation(link),
    });
    registry.attach({
      parentSessionId: "root",
      childSessionId: "child-a",
      mode: "one-shot",
      label: "researcher",
    });
    registry.attach({
      parentSessionId: "root",
      childSessionId: "fork-1",
      mode: "fork",
      label: "fork",
    });
    graph.linkPeers("child-a", "child-b", "review");

    const view = graph.view("root");
    expect(view.nodes.map((node) => node.id).sort()).toEqual([
      "child-a",
      "child-b",
      "root",
    ]);
    expect(
      view.edges.some((edge) => edge.kind === "delegates" && edge.to === "child-a"),
    ).toBe(true);
    expect(view.edges.some((edge) => edge.kind === "peer")).toBe(true);
    expect(view.edges.some((edge) => edge.to === "fork-1")).toBe(false);

    const cold = new AgentTeamGraph(graphPath);
    const again = cold.view("root");
    expect(again.edges).toHaveLength(view.edges.length);
    const raw = JSON.parse(readFileSync(graphPath, "utf8")) as { edges: unknown[] };
    expect(raw.edges.length).toBeGreaterThan(0);
  });

  it("derives delegator / worker / observer roles from edges", () => {
    const graph = new AgentTeamGraph();
    const registry = new FaceSubagentRegistry(undefined, {
      onAttach: (link) => graph.recordDelegation(link),
    });
    registry.attach({
      parentSessionId: "root",
      childSessionId: "worker-1",
      mode: "one-shot",
      label: "researcher",
    });
    graph.linkPeers("root", "watcher");

    expect(graph.roleOf("root")).toBe("delegator");
    expect(graph.roleOf("worker-1")).toBe("worker");
    expect(graph.roleOf("watcher")).toBe("observer");

    const byId = new Map(graph.view("root").nodes.map((n) => [n.id, n.role]));
    expect(byId.get("root")).toBe("delegator");
    expect(byId.get("worker-1")).toBe("worker");
    expect(byId.get("watcher")).toBe("observer");
  });

  it("lets an explicit role override the derived one, and clears back", () => {
    const graph = new AgentTeamGraph();
    const registry = new FaceSubagentRegistry(undefined, {
      onAttach: (link) => graph.recordDelegation(link),
    });
    registry.attach({
      parentSessionId: "root",
      childSessionId: "child",
      mode: "one-shot",
      label: "child",
    });

    // Promote the worker to a delegator (it will run its own sub-team).
    expect(graph.setRole("child", "delegator")).toBe("delegator");
    expect(graph.roleOf("child")).toBe("delegator");
    expect(graph.roleOverrides()).toEqual({ child: "delegator" });
    // Override wins even though an edge says otherwise.
    expect(graph.setRole("root", "observer")).toBe("observer");

    // Clearing falls back to the derived role.
    expect(graph.setRole("child", undefined)).toBe("worker");
    expect(graph.setRole("root", undefined)).toBe("delegator");
    expect(graph.setRole("", "worker")).toBeUndefined();
  });

  it("persists explicit roles and ignores unknown role strings", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-team-role-"));
    temps.push(dir);
    const graphPath = path.join(dir, "agent-team-graph.json");
    const graph = new AgentTeamGraph(graphPath);
    graph.setRole("root", "delegator");
    graph.setRole("watcher", "observer");

    const cold = new AgentTeamGraph(graphPath);
    expect(cold.roleOverrides()).toEqual({
      root: "delegator",
      watcher: "observer",
    });
    expect(cold.roleOf("watcher")).toBe("observer");

    const raw = JSON.parse(readFileSync(graphPath, "utf8")) as {
      roles?: Record<string, string>;
    };
    expect(raw.roles).toEqual({ root: "delegator", watcher: "observer" });
  });
});
