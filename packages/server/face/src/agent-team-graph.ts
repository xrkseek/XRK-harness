/**
 * Multi-agent team graph beside the parent→child subagent registry.
 * Delegation edges are copied from attach; peer edges are explicit teammate links.
 */
import { readFileSync } from "node:fs";
import { tryWriteJsonSidecar } from "./json-sidecar.js";
import type { FaceSubagentLink } from "./subagent-registry.js";

export type AgentTeamEdgeKind = "delegates" | "peer";

/**
 * Team role for one node.
 * - `delegator` — hands work to a child (outgoing `delegates` edge).
 * - `worker` — the child that received the delegation.
 * - `observer` — linked by `peer` only; reads/coordinates, owns no delegation.
 * Derived from edges unless an explicit override is set.
 */
export type AgentTeamRole = "delegator" | "worker" | "observer";

export const AGENT_TEAM_ROLES: readonly AgentTeamRole[] = [
  "delegator",
  "worker",
  "observer",
];

export function isAgentTeamRole(value: unknown): value is AgentTeamRole {
  return value === "delegator" || value === "worker" || value === "observer";
}

export interface AgentTeamNode {
  readonly id: string;
  readonly label: string;
  /** Effective role: explicit override when set, else derived from edges. */
  readonly role?: AgentTeamRole;
  /**
   * Delegation depth from the `view`/`depthFrom` root along `delegates` edges
   * (root = 0). Omitted when the node is only peer-linked to the component.
   */
  readonly depth?: number;
}

export interface AgentTeamEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: AgentTeamEdgeKind;
  readonly label?: string;
}

/** One adjacency hop from `neighbors()`. */
export interface AgentTeamNeighbor {
  readonly id: string;
  readonly kind: AgentTeamEdgeKind;
  /** `out` = this node is edge.from; `in` = this node is edge.to (peer always sorted). */
  readonly direction: "in" | "out";
  readonly label?: string;
}

interface PersistShape {
  readonly nodes: AgentTeamNode[];
  readonly edges: AgentTeamEdge[];
  /** Explicit role overrides by node id (derived roles are not stored). */
  readonly roles?: Record<string, string>;
}

function edgeKey(edge: Pick<AgentTeamEdge, "from" | "to" | "kind">): string {
  if (edge.kind === "peer") {
    const [a, b] = [edge.from, edge.to].sort();
    return `peer:${a}:${b}`;
  }
  return `delegates:${edge.from}:${edge.to}`;
}

export class AgentTeamGraph {
  private readonly nodes = new Map<string, AgentTeamNode>();
  private readonly edges = new Map<string, AgentTeamEdge>();
  private readonly roles = new Map<string, AgentTeamRole>();
  private readonly persistPath: string | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) this.load();
  }

  recordDelegation(link: FaceSubagentLink): void {
    if (link.mode === "fork") return;
    this.upsertNode(link.parentSessionId, link.parentSessionId);
    this.upsertNode(link.childSessionId, link.label || link.childSessionId);
    this.upsertEdge({
      from: link.parentSessionId,
      to: link.childSessionId,
      kind: "delegates",
      ...(link.label ? { label: link.label } : {}),
    });
    this.save();
  }

  /** Replace delegation edges from the live registry; peer links stay. */
  rebuildDelegations(links: readonly FaceSubagentLink[]): void {
    for (const [key, edge] of this.edges) {
      if (edge.kind === "delegates") this.edges.delete(key);
    }
    for (const link of links) {
      if (link.mode === "fork") continue;
      this.upsertNode(link.parentSessionId, link.parentSessionId);
      this.upsertNode(link.childSessionId, link.label || link.childSessionId);
      this.upsertEdge({
        from: link.parentSessionId,
        to: link.childSessionId,
        kind: "delegates",
        ...(link.label ? { label: link.label } : {}),
      });
    }
    this.save();
  }

  linkPeers(from: string, to: string, label?: string): AgentTeamEdge | undefined {
    const a = from.trim();
    const b = to.trim();
    if (!a || !b || a === b) return undefined;
    this.upsertNode(a, a);
    this.upsertNode(b, b);
    const edge: AgentTeamEdge = {
      from: a < b ? a : b,
      to: a < b ? b : a,
      kind: "peer",
      ...(label?.trim() ? { label: label.trim() } : {}),
    };
    this.upsertEdge(edge);
    this.save();
    return edge;
  }

  /** Drop a peer edge (no-op when missing). Returns whether an edge was removed. */
  unlinkPeers(from: string, to: string): boolean {
    const a = from.trim();
    const b = to.trim();
    if (!a || !b || a === b) return false;
    const key = edgeKey({
      from: a < b ? a : b,
      to: a < b ? b : a,
      kind: "peer",
    });
    if (!this.edges.has(key)) return false;
    this.edges.delete(key);
    this.save();
    return true;
  }

  /**
   * Remove peer edges touching `nodeId`, clear its role override, and drop the
   * node when no `delegates` edge remains. Delegation edges stay owned by
   * `rebuildDelegations` / the live registry.
   */
  removeNode(nodeId: string): boolean {
    const id = nodeId.trim();
    if (!id) return false;
    let changed = false;
    for (const [key, edge] of this.edges) {
      if (edge.kind !== "peer") continue;
      if (edge.from !== id && edge.to !== id) continue;
      this.edges.delete(key);
      changed = true;
    }
    if (this.roles.delete(id)) changed = true;
    let hasDelegates = false;
    for (const edge of this.edges.values()) {
      if (edge.kind !== "delegates") continue;
      if (edge.from === id || edge.to === id) {
        hasDelegates = true;
        break;
      }
    }
    if (!hasDelegates && this.nodes.delete(id)) changed = true;
    if (changed) this.save();
    return changed;
  }

  /**
   * Adjacent nodes. `kind` defaults to any; peer hops are undirected
   * (`direction` still reports sorted from→to orientation).
   */
  neighbors(
    nodeId: string,
    kind?: AgentTeamEdgeKind,
  ): readonly AgentTeamNeighbor[] {
    const id = nodeId.trim();
    if (!id) return [];
    const out: AgentTeamNeighbor[] = [];
    for (const edge of this.edges.values()) {
      if (kind && edge.kind !== kind) continue;
      if (edge.from === id) {
        out.push({
          id: edge.to,
          kind: edge.kind,
          direction: "out",
          ...(edge.label ? { label: edge.label } : {}),
        });
      } else if (edge.to === id) {
        out.push({
          id: edge.from,
          kind: edge.kind,
          direction: "in",
          ...(edge.label ? { label: edge.label } : {}),
        });
      }
    }
    out.sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
    return out;
  }

  /**
   * BFS depth along `delegates` from `rootId` (root = 0). Undefined when the
   * target is unreachable via delegation (peer-only nodes).
   */
  depthFrom(rootId: string, nodeId: string): number | undefined {
    const root = rootId.trim();
    const target = nodeId.trim();
    if (!root || !target) return undefined;
    if (root === target) return 0;
    const children = new Map<string, string[]>();
    for (const edge of this.edges.values()) {
      if (edge.kind !== "delegates") continue;
      const bucket = children.get(edge.from) ?? [];
      bucket.push(edge.to);
      children.set(edge.from, bucket);
    }
    const seen = new Set<string>([root]);
    const queue: { id: string; depth: number }[] = [{ id: root, depth: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const child of children.get(cur.id) ?? []) {
        if (seen.has(child)) continue;
        const depth = cur.depth + 1;
        if (child === target) return depth;
        seen.add(child);
        queue.push({ id: child, depth });
      }
    }
    return undefined;
  }

  /** Effective role for one node (explicit override, else derived from edges). */
  roleOf(nodeId: string): AgentTeamRole {
    const id = nodeId.trim();
    const explicit = this.roles.get(id);
    if (explicit) return explicit;
    return this.deriveRole(id);
  }

  /**
   * Override a node's role. Pass `undefined` to clear the override and fall
   * back to the derived role. Returns the effective role afterwards.
   */
  setRole(nodeId: string, role?: AgentTeamRole): AgentTeamRole | undefined {
    const id = nodeId.trim();
    if (!id) return undefined;
    this.upsertNode(id, id);
    if (role === undefined) this.roles.delete(id);
    else this.roles.set(id, role);
    this.save();
    return this.roleOf(id);
  }

  /** Explicit overrides only (derived roles are recomputed on read). */
  roleOverrides(): Readonly<Record<string, AgentTeamRole>> {
    return Object.fromEntries(this.roles);
  }

  private deriveRole(id: string): AgentTeamRole {
    let incoming = false;
    for (const edge of this.edges.values()) {
      if (edge.kind !== "delegates") continue;
      if (edge.from === id) return "delegator";
      if (edge.to === id) incoming = true;
    }
    return incoming ? "worker" : "observer";
  }

  /** Connected component around `rootId` (delegation + peer). */
  view(rootId: string): {
    readonly nodes: readonly AgentTeamNode[];
    readonly edges: readonly AgentTeamEdge[];
  } {
    const root = rootId.trim();
    if (!root) return { nodes: [], edges: [] };
    const adj = new Map<string, AgentTeamEdge[]>();
    const touch = (id: string, edge: AgentTeamEdge) => {
      const bucket = adj.get(id) ?? [];
      bucket.push(edge);
      adj.set(id, bucket);
    };
    for (const edge of this.edges.values()) {
      touch(edge.from, edge);
      touch(edge.to, edge);
    }
    const seen = new Set<string>([root]);
    const queue = [root];
    const kept = new Map<string, AgentTeamEdge>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const edge of adj.get(id) ?? []) {
        kept.set(edgeKey(edge), edge);
        const next = edge.from === id ? edge.to : edge.from;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    if (!this.nodes.has(root)) this.upsertNode(root, root);
    const nodes = [...seen].map((id) => {
      const node = this.nodes.get(id) ?? { id, label: id };
      const depth = this.depthFrom(root, id);
      return {
        ...node,
        role: this.roleOf(id),
        ...(depth !== undefined ? { depth } : {}),
      };
    });
    return { nodes, edges: [...kept.values()] };
  }

  private upsertNode(id: string, label: string): void {
    const prev = this.nodes.get(id);
    if (prev && prev.label !== id && label === id) return;
    this.nodes.set(id, { id, label: label || id });
  }

  private upsertEdge(edge: AgentTeamEdge): void {
    this.edges.set(edgeKey(edge), edge);
  }

  private load(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as PersistShape;
      if (Array.isArray(raw.nodes)) {
        for (const node of raw.nodes) {
          if (!node || typeof node.id !== "string" || !node.id.trim()) continue;
          this.nodes.set(node.id, {
            id: node.id,
            label:
              typeof node.label === "string" && node.label.trim()
                ? node.label
                : node.id,
          });
        }
      }
      if (Array.isArray(raw.edges)) {
        for (const edge of raw.edges) {
          if (!edge || (edge.kind !== "delegates" && edge.kind !== "peer")) continue;
          const from = String(edge.from ?? "").trim();
          const to = String(edge.to ?? "").trim();
          if (!from || !to || from === to) continue;
          this.upsertEdge({
            from: edge.kind === "peer" && to < from ? to : from,
            to: edge.kind === "peer" && to < from ? from : to,
            kind: edge.kind,
            ...(typeof edge.label === "string" && edge.label.trim()
              ? { label: edge.label.trim() }
              : {}),
          });
        }
      }
      if (raw.roles && typeof raw.roles === "object") {
        for (const [id, role] of Object.entries(raw.roles)) {
          const key = id.trim();
          if (!key || !isAgentTeamRole(role)) continue;
          this.roles.set(key, role);
        }
      }
    } catch {
      /* missing / corrupt sidecar → empty graph */
    }
  }

  private save(): void {
    const file = this.persistPath;
    if (!file) return;
    tryWriteJsonSidecar(file, {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      ...(this.roles.size > 0 ? { roles: Object.fromEntries(this.roles) } : {}),
    });
  }
}

export function agentTeamGraphPath(subagentPersistPath?: string): string | undefined {
  if (!subagentPersistPath?.trim()) return undefined;
  return subagentPersistPath.replace(/[^/\\]+$/, "agent-team-graph.json");
}
