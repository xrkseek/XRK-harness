import type { TrajectoryNode } from "@xrkseek/web-runtime";

export function renderTrajectoryNode(node: TrajectoryNode): HTMLElement {
  const row = document.createElement("article");
  row.className = `traj traj-${node.kind}${
    node.kind === "assistant" && node.partial ? " traj-partial" : ""
  }${node.kind === "user" && node.optimistic ? " traj-partial" : ""}`;

  const role = document.createElement("span");
  role.className = "traj-role";
  const body = document.createElement("div");
  body.className = "traj-body";

  switch (node.kind) {
    case "user":
      role.textContent = node.optimistic ? "You · sending" : "You";
      body.textContent = node.content;
      break;
    case "assistant":
      role.textContent = node.partial ? "XRK · …" : "XRK";
      body.textContent = node.content;
      break;
    case "tool":
      role.textContent = `Tool · ${node.phase}`;
      body.textContent = `${node.name} · ${node.viewPreview ?? node.detail}`;
      break;
    case "notice":
      role.textContent = "Notice";
      body.textContent = node.content;
      break;
  }

  row.append(role, body);
  return row;
}
