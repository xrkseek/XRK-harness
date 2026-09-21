/**
 * Product SPA boot omit list — shared by assemble / client:bundle /
 * client:types and mirrored in `@xrkseek/server-http` `boot-inject.ts`
 * (`XRK_OMIT_CLIENT_PLUGIN_IDS`). Overlay cannot put these back at serve time.
 *
 * Historical Cordis UI / runner (no longer in-tree), HMR (dev-only),
 * native OS directory picker (fights in-app browse slot), dsh-pocket.
 */
export const PRODUCT_BOOT_OMIT_IDS = Object.freeze([
  "@xrkseek/client-ui-cordis",
  "@xrkseek/xrk-cordis-client-runner",
  "@xrkseek/client-hmr",
  "@xrkseek/client-ui-directory-picker-native",
  "dsh-pocket",
]);

export const PRODUCT_BOOT_OMIT = new Set(PRODUCT_BOOT_OMIT_IDS);
