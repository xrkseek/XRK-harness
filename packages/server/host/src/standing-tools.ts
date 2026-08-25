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
  const preset = options.preset ?? "minimal";
  if (preset === "harness" || preset === "server") {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      defaultCwd: options.workspaceRoot,
    });
    for (const tool of createBashTools(shell, {
      defaultCwd: options.workspaceRoot,
    })) tools.register(tool);
    for (const tool of createWebTools(createDefaultWebAccess())) tools.register(tool);
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
