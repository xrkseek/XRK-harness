/**
 * Lazily materialize reserved `ws_im` when an IM gateway connects or admits.
 * Face boot does **not** create it — unlike 向阳空间 (`ws_default`).
 */

import path from "node:path";
import type { FaceRuntime } from "./context.js";
import { IM_WORKSPACE_ID, IM_WORKSPACE_TITLE } from "./im-workspace.js";
import { persistWorkspaceDoc } from "./workspace-store.js";
import { resolveHarnessHome } from "./settings-document.js";

/** Ensure `ws_im` exists under product home; persist when newly created. */
export async function ensureImWorkspace(
  runtime: FaceRuntime,
): Promise<void> {
  if (runtime.workspaces.get(IM_WORKSPACE_ID)) return;
  const productHome =
    runtime.productDir?.trim() || resolveHarnessHome(runtime);
  const imPath = path.join(productHome, "im-workspace");
  const ensured = runtime.workspaces.ensureReserved(
    IM_WORKSPACE_ID,
    imPath,
    IM_WORKSPACE_TITLE,
  );
  if (ensured.created) {
    await persistWorkspaceDoc(runtime, runtime.workspaces).catch(() => {
      // Fail closed: in-memory ws_im still usable without durable write.
    });
  }
}
