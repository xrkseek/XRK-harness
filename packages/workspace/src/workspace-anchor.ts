/**
 * Durable inject anchor: absolute workspace root for the model (title is display-only).
 */
export function formatWorkspaceRootAnchor(
  root: string,
  displayTitle?: string,
): string {
  const path = root.trim();
  if (!path) return "";
  const title = displayTitle?.trim();
  const lines = [
    "## Workspace root",
    `\`${path}\``,
    ...(title ? [`Display name: ${title} (sidebar label — not a filesystem path).`] : []),
    "All relative tool paths resolve here. Shell tools default their cwd to this root — `pwd` / `Get-Location` must show this path, not the Host process directory.",
    "Do not search other drives for the project.",
  ];
  return lines.join("\n");
}
