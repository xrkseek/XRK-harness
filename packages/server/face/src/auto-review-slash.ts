/** Parsed `/auto-review` slash actions (Face projection + narrate). */
export type AutoReviewSlashAction =
  | { readonly kind: "enable" }
  | { readonly kind: "disable" }
  | { readonly kind: "approve"; readonly index: number };

export function parseAutoReviewSlashInput(
  args: string,
): AutoReviewSlashAction | null {
  const input = args.trim();
  if (input === "on" || input === "") return { kind: "enable" };
  if (input === "off") return { kind: "disable" };
  const approve = /^approve(?:\s+(\d+))?$/u.exec(input);
  if (approve) {
    return { kind: "approve", index: Number(approve[1] ?? "1") - 1 };
  }
  return null;
}
