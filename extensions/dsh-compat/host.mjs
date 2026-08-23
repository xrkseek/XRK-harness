/**
 * Built-in DSH community adapter (`kind: host`).
 * HTTP surface is implemented in @xrkseek/server-http/dsh-compat.
 */
import { createDshCompatHostPlugin } from "@xrkseek/server-http";

export function createPlugin() {
  return createDshCompatHostPlugin();
}
