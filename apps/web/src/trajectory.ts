import type { TrajectoryNode } from "@xrkseek/web-runtime";

export function renderTrajectoryNode(node: TrajectoryNode): HTMLElement {
  const row = document.createElement("div");
  row.className = `traj traj-${node.kind}${
    node.kind === "assistant" && node.partial ? " traj-partial" : ""
  }${node.kind === "user" && node.optimistic ? " traj-partial" : ""}`;
  switch (node.kind) {
    case "user":
      row.textContent = `user${node.optimistic ? " (opt)" : ""}${
        node.rpcId ? ` · ${node.rpcId}` : ""
      } · ${node.content}`;
      break;
    case "assistant":
      row.textContent = `assistant${node.partial ? "…" : ""} · ${node.content}`;
      break;
    case "tool":
      row.textContent = `tool/${node.phase} · ${node.name} · ${
        node.viewPreview ?? node.detail
      }`;
      break;
    case "notice":
      row.textContent = `notice · ${node.content}`;
      break;
  }
  return row;
}
