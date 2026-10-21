/**
 * Recursive directory copy without `fs.cpSync`.
 *
 * On Windows, `fs.cpSync` of some trees (notably
 * `packages/client/ui-theme/src/styles`) aborts the Node process with
 * STATUS_STACK_BUFFER_OVERRUN (0xC0000409). `copyFileSync` is fine.
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (statSync(from).isDirectory()) copyDirSync(from, to);
    else copyFileSync(from, to);
  }
}
