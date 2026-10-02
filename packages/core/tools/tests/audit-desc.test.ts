import { describe, it } from "vitest";
import { createStdTools } from "../src/index.ts";
import { createSettingsTools } from "../src/settings-tools.ts";
import { createFsTools, createFsLocalProvider } from "../../../exec/fs/src/index.ts";
import { createBashTools } from "../../../exec/shell/src/index.ts";
import { createDefaultWebAccess, createWebTools, createBrowserTools } from "../../../exec/web/src/index.ts";
import { createSkillTools, createProposeSkillTool } from "../../../workspace/src/index.ts";
import { createImageGenTools } from "../../../exec/image-gen/src/index.ts";
import { createVideoGenTools } from "../../../exec/video-gen/src/index.ts";
import { createVideoAnalyzeTools } from "../../../exec/video-analyze/src/index.ts";
import { createVoiceTools } from "../../../exec/voice/src/index.ts";
import { createCuratedMemoryTools, createCuratedMemoryStore } from "../../../exec/memory/src/index.ts";
import { createLspTools } from "../../../exec/lsp/src/index.ts";
import { createPtyTools } from "../../../exec/pty/src/tools.ts";
import { createTerminalSessionService } from "../../../exec/pty/src/registry.ts";
import { createComputerUseTools } from "../../../exec/computer-use/src/index.ts";
import { createCronTools } from "../../../server/cron/src/tools.ts";

describe("tool description audit", () => {
  it("dumps ALL tool registry by description length", () => {
    const tools: { name: string; description: string }[] = [];
    const push = (ts: { name: string; description: string }[]) => tools.push(...ts);

    push(createStdTools());
    push(createSettingsTools());
    push(createFsTools({} as never));
    push(createBashTools({} as never, { defaultCwd: process.cwd(), maxOutputBytes: 64000 }));
    const access = createDefaultWebAccess({});
    push(createWebTools(access));
    // browser tools need a runtime registry — stub at tool definition level
    push(createBrowserTools({} as never, {} as never));
    push(createSkillTools({ workspaceRoot: process.cwd(), productDir: ".xrk" }));
    push([createProposeSkillTool({ resolveWorkspaceRoot: () => process.cwd() })]);
    push(createImageGenTools({} as never));
    push(createVideoGenTools({} as never));
    push(createVideoAnalyzeTools({} as never));
    push(createVoiceTools({} as never));
    push(createCuratedMemoryTools(createCuratedMemoryStore()));
    push(createLspTools({} as never));
    push(createPtyTools({ service: createTerminalSessionService() } as never));
    push(createComputerUseTools({} as never));
    push(createCronTools({} as never));

    const sorted = [...tools].sort((a, b) => b.description.length - a.description.length);
    const byName = new Map<string, string>();
    for (const t of sorted) {
      const prev = byName.get(t.name);
      if (!prev || t.description.length > prev.length) byName.set(t.name, t.description);
    }
    const uniq = [...byName.entries()]
      .map(([name, description]) => ({ name, description }))
      .sort((a, b) => b.description.length - a.description.length);
    let total = 0;
    console.log("=== ALL UNIQUE TOOLS by description length (desc) ===");
    for (const t of uniq) {
      total += t.description.length;
      const oneLine = t.description.replace(/\s+/g, " ").slice(0, 150);
      console.log(String(t.description.length).padStart(5), t.name.padEnd(24), oneLine);
    }
    console.log("=== totals ===", uniq.length, "unique tools,", total, "desc chars, ~", Math.ceil(total / 4), "tokens est (desc only)");
  });
});