/**
 * DSH apiproxy cold history: presenters live on the preset standing layer —
 * `viewFor` must work with no live Agent. Same factories as the presets;
 * Face only calls presentCall / presentResult.
 */

import {
  createStdTools,
  createToolRegistry,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import { createFsLocalProvider, createFsTools } from "@xrkseek/exec-fs";
import { createBashTools, createLocalShell } from "@xrkseek/exec-shell";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import { createDefaultWebAccess, createWebTools } from "@xrkseek/exec-web";
import { createLspTools } from "@xrkseek/exec-lsp";
import { createPtyTools } from "@xrkseek/exec-pty";
import { resolveToolPreset } from "@xrkseek/server-face";
import { createSkillTools } from "@xrkseek/workspace";

export function createStandingToolRegistry(options: {
  readonly workspaceRoot: string;
  readonly preset?: string;
}): ToolRegistry {
  const tools = createToolRegistry();
  const fs = createFsLocalProvider({ root: options.workspaceRoot });
  for (const tool of createFsTools(fs)) tools.register(tool);
  for (const tool of createStdTools()) tools.register(tool);
  for (const tool of createSkillTools({
    workspaceRoot: options.workspaceRoot,
  })) {
    tools.register(tool);
  }
  // Display-only presenters for cold history. When Host composition is harness
  // (any of shell/frugal/plan/shallow/harness/server), register the full tool
  // surface so a session badge with more tools than the Host default still
  // renders cards without resuming the agent.
  const composition = resolveToolPreset(options.preset, "minimal");
  if (composition === "harness") {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      defaultCwd: options.workspaceRoot,
    });
    for (const tool of createBashTools(shell, {
      defaultCwd: options.workspaceRoot,
    })) {
      tools.register(tool);
    }
    for (const tool of createWebTools(createDefaultWebAccess())) {
      tools.register(tool);
    }
    for (const tool of createLspTools({
      workspaceRoot: options.workspaceRoot,
    })) {
      tools.register(tool);
    }
    for (const tool of createPtyTools({
      workspaceRoot: options.workspaceRoot,
    })) {
      tools.register(tool);
    }
  }
  return tools;
}
