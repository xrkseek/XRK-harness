/**
 * Face binding for `propose_skill` — always gate writes through user questions
 * (Hermes skills.write_approval stage path; XRK confirms inline via ask UI).
 */

import type { ToolRegistry } from "@xrkseek/core-tools";
import {
  clearLearningLoopNudge,
  createProposeSkillTool,
  PROPOSE_SKILL_TOOL,
  type ProposeSkillDraft,
} from "@xrkseek/workspace";
import { FaceQuestionError } from "./questions.js";
import type { FaceQuestionAnswer, FaceQuestionItem } from "./types.js";

export const PROPOSE_SKILL_APPROVE_LABEL = "Write skill";
export const PROPOSE_SKILL_REJECT_LABEL = "Reject";
export const PROPOSE_SKILL_QUESTION_ID = "propose-skill";

export function proposeSkillQuestions(
  draft: ProposeSkillDraft,
): FaceQuestionItem[] {
  return [
    {
      id: PROPOSE_SKILL_QUESTION_ID,
      header: "Learning loop",
      question: `Write skill "${draft.name}" to ${draft.targetRel}?`,
      detail: draft.markdown,
      options: [
        {
          label: PROPOSE_SKILL_APPROVE_LABEL,
          description:
            "Validate frontmatter and create the skill directory (user consent).",
        },
        {
          label: PROPOSE_SKILL_REJECT_LABEL,
          description: "Discard the draft; nothing is written.",
        },
      ],
    },
  ];
}

export interface BindProposeSkillToolOptions {
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly skillsRoot?: string;
  readonly ask: (
    questions: readonly FaceQuestionItem[],
    signal?: AbortSignal,
  ) => Promise<FaceQuestionAnswer>;
}

/** Register / replace `propose_skill` with Face confirm → write. */
export function bindProposeSkillTool(
  tools: ToolRegistry,
  options: BindProposeSkillToolOptions,
): void {
  const bound = createProposeSkillTool({
    resolveWorkspaceRoot: () => options.workspaceRoot,
    ...(options.skillsRoot !== undefined
      ? { resolveSkillsRoot: () => options.skillsRoot }
      : {}),
    async askConfirm(draft, signal) {
      try {
        const answer = await options.ask(
          proposeSkillQuestions(draft),
          signal,
        );
        const item = answer.answers.find(
          (row) => row.id === PROPOSE_SKILL_QUESTION_ID,
        );
        if (
          item?.selected.length === 1 &&
          item.selected[0] === PROPOSE_SKILL_APPROVE_LABEL &&
          item.custom === undefined
        ) {
          clearLearningLoopNudge(options.sessionId);
          return { approved: true };
        }
        return {
          approved: false,
          ...(item?.custom !== undefined ? { feedback: item.custom } : {}),
        };
      } catch (err) {
        if (err instanceof FaceQuestionError && err.code === "ASK_CANCELLED") {
          return { approved: false, feedback: "cancelled" };
        }
        throw err;
      }
    },
  });
  if (tools.get(PROPOSE_SKILL_TOOL)) tools.replace(bound);
  else tools.register(bound);
}
