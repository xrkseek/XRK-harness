import { createHash } from "node:crypto";

/** Content-addressed id: `sha256:<hex>`. Never a filesystem path. */
export function attachmentIdForBytes(data: Uint8Array): string {
  const hex = createHash("sha256").update(data).digest("hex");
  return `sha256:${hex}`;
}
