/**
 * Turn-start `<instruction_authority>` — lanes from a pluggable registry.
 * Default registry: `@xrkseek/workspace` createInstructionAuthorityRegistry.
 * Process plugins / Host may `register()` more order|data rows.
 */
import {
  createInstructionAuthorityRegistry,
  type InstructionAuthorityRegistry,
} from "@xrkseek/workspace";

export function createInstructionAuthorityFragmentProvider(
  registry: InstructionAuthorityRegistry = createInstructionAuthorityRegistry(),
): {
  readonly id: "instruction-authority";
  readonly phases: readonly ["turn-start"];
  readonly registry: InstructionAuthorityRegistry;
  produce(): readonly {
    readonly id: string;
    readonly kind: "additional_context";
    readonly text: string;
    readonly phase: "turn-start";
    readonly priority: number;
  }[];
} {
  return {
    id: "instruction-authority",
    phases: ["turn-start"],
    registry,
    produce() {
      const value = registry.formatCard();
      if (!value.trim()) return [];
      return [
        {
          id: "additional_context.instruction_authority",
          kind: "additional_context",
          text: `<instruction_authority>\n${value}\n</instruction_authority>`,
          phase: "turn-start",
          priority: 9.5,
        },
      ];
    },
  };
}
