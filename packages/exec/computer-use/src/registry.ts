/**
 * One named computer-use Provider at a time (DSH computer-use register).
 * A second register fails and reports the name already held.
 */
import { ComputerUseError, type ComputerUseProviderName } from "./types.js";

export type { ComputerUseProviderName };

export interface ComputerUseProviderRegistry {
  readonly providerName: ComputerUseProviderName | undefined;
  register(name: ComputerUseProviderName): () => void;
}

export function createComputerUseProviderRegistry(): ComputerUseProviderRegistry {
  let current: ComputerUseProviderName | undefined;
  return {
    get providerName() {
      return current;
    },
    register(name) {
      if (current !== undefined) {
        throw new ComputerUseError(
          `computer-use provider already registered: ${current}`,
          "COMPUTER_USE_BACKEND",
        );
      }
      current = name;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (current === name) current = undefined;
      };
    },
  };
}
