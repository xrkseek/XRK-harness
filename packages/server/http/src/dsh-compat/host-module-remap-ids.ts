/**
 * Re-export pure remap helper for tests / callers that must not load the
 * customize-hook entry (see {@link ./host-module-remap-hook.ts}).
 */
export { remapHostModuleId } from "./host-module-remap-hook.js";
