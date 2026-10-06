import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = path.join(
  harnessRoot,
  "..",
  "XRK-AGT",
  "core",
  "harness-download-Core",
);
const helper = path.join(process.env.USERPROFILE, ".cursor", "xrk-ssh-deploy-core.py");
const result = spawnSync(process.env.PYTHON || "python", [helper, core], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});
process.exit(result.status ?? 1);
