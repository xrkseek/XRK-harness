/**
 * `@xrkseek/spill` — locator contract, local store, tool-result spill policy.
 *
 * Storage ({@link SpillStore} / {@link LocalSpillStore}) and policy
 * ({@link applySpillPolicy} / notices) are separate packages-of-concern so
 * Host / agent-loop can swap backends without rewriting notice text.
 */

export {
  SpillLocator,
  type SpillOwner,
  type SpillSource,
  type SaveTextSpill,
  type SpillRef,
  type SpillStore,
} from "./types.js";

export {
  LocalSpillStore,
  defaultLocalSpillStore,
  defaultSpillRoot,
  encodeSpillSegment,
  resetDefaultLocalSpillStore,
  type LocalSpillStoreOptions,
} from "./local-store.js";

export {
  NO_SPILL_TOOLS,
  DEFAULT_SPILL_INLINE_BYTES,
  utf8Bytes,
  utf8Prefix,
  utf8Suffix,
  headTail,
  formatSpillNotice,
  parseSpillLocator,
  alreadySavedPath,
  fitInlineNotice,
  applySpillPolicy,
  type ApplySpillPolicyInput,
  type ApplySpillPolicyResult,
} from "./policy.js";
