/**
 * Re-export shared child-env scrub from `@xrkseek/exec-subprocess`
 * (single implementation for PTY and non-PTY bash paths).
 */

export {
  DSH_ENV_PREFIX,
  SENSITIVE_ENV_PATTERN,
  XRK_ENV_PREFIX,
  childEnv,
  scrubbedParentEnv,
} from "@xrkseek/exec-subprocess";
