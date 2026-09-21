/**
 * Model-facing sidebar agent tools: `sidebar_open` + `terminal_*` (agent PTY).
 * Bound per Agent with a closed-over sessionId (same pattern as Face subagent tools).
 */
import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import {
  AgentOpenRegistry,
  classifyAgentOpenTarget,
} from "./sidebar-agent-opens.js";
import {
  AgentPtyRegistry,
  ALLOWED_SIGNALS,
  type AgentTerminalSignal,
} from "./sidebar-agent-pty.js";

const READ_BYTE_LIMIT = 256 * 1024;

export function boundBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: buf.subarray(0, end).toString("utf8"), truncated: true };
}

function jsonContent(value: unknown): { content: string } {
  return { content: JSON.stringify(value) };
}

export interface SidebarAgentToolsOptions {
  readonly sessionId: string;
  readonly agentOpens: AgentOpenRegistry;
  readonly agentPty: AgentPtyRegistry;
  readonly resolveCwd: (sessionId: string) => string;
  readonly readPrefs: () => Record<string, unknown>;
  readonly readShellOverrides: () => {
    shell?: string;
    shellArgs?: string[];
  };
}

function createSidebarOpenTool(
  options: SidebarAgentToolsOptions,
): ToolDefinition {
  return {
    name: "sidebar_open",
    description:
      "Open a local file, a local folder, or an HTTP(S) page in the sidebar of the calling conversation. "
      + "A file opens in the sidebar editor; a folder opens a tree rooted there; a URL opens in the sidebar browser. "
      + "Paths may be absolute or relative to the session working directory. "
      + "While that session's sidebar view is not connected, the open is queued (`delivered: false`).",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "Absolute or session-cwd-relative local path, or an http:// / https:// URL.",
        },
        title: {
          type: "string",
          description:
            "Optional tab title (defaults to the file/folder name or the URL hostname).",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
    async execute(args: { target?: string; title?: string }, signal) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const raw = typeof args.target === "string" ? args.target.trim() : "";
      if (!raw) {
        return { content: "target required", isError: true };
      }
      const cwd = options.resolveCwd(options.sessionId);
      try {
        const classified = await classifyAgentOpenTarget(raw, cwd);
        const prefs = options.readPrefs();
        const tabs =
          prefs.tabsEnabled && typeof prefs.tabsEnabled === "object"
            ? (prefs.tabsEnabled as Record<string, unknown>)
            : {};
        const tab = classified.kind === "url" ? "browser" : "editor";
        if (tabs[tab] === false) {
          return {
            content: `the built-in ${tab} tab is disabled in the side card settings`,
            isError: true,
          };
        }
        const title =
          typeof args.title === "string" && args.title.trim() !== ""
            ? args.title.trim()
            : classified.title;
        const { delivered } = options.agentOpens.enqueue(
          options.sessionId,
          classified.kind,
          classified.target,
          title,
        );
        return jsonContent({
          kind: classified.kind,
          target: classified.target,
          title,
          delivered,
        });
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}

function createAgentTerminalTools(
  options: SidebarAgentToolsOptions,
): ToolDefinition[] {
  const { sessionId, agentPty } = options;
  return [
    {
      name: "terminal_create",
      description:
        "Open a persistent terminal in the sidebar and run a command in it. "
        + "Returns a uuid handle; the terminal stays alive after the command exits. "
        + "Use terminal_send / terminal_read / terminal_signal / terminal_close for follow-up.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: 'Short label for the terminal tab (e.g. "dev server").',
          },
          command: {
            type: "string",
            description:
              'Shell command to run (host appends Enter). Pass "" for a bare shell.',
          },
        },
        required: ["title", "command"],
        additionalProperties: false,
      },
      async execute(args: { title?: string; command?: string }, signal) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const title = typeof args.title === "string" ? args.title.trim() : "";
        if (!title) return { content: "title required", isError: true };
        const command = typeof args.command === "string" ? args.command : "";
        try {
          const cwd = options.resolveCwd(sessionId);
          const { shell, shellArgs } = options.readShellOverrides();
          const uuid = await agentPty.create(
            sessionId,
            title,
            command,
            cwd,
            80,
            24,
            shell,
            shellArgs,
          );
          return jsonContent({ uuid, title });
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
    {
      name: "terminal_list",
      description:
        "List every agent terminal opened in this session (uuid, title, command, exited).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return jsonContent(agentPty.list(sessionId));
      },
    },
    {
      name: "terminal_send",
      description:
        "Send keystrokes to a terminal_create uuid. Set submit=true to append Enter.",
      parameters: {
        type: "object",
        properties: {
          uuid: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["uuid", "text"],
        additionalProperties: false,
      },
      async execute(
        args: { uuid?: string; text?: string; submit?: boolean },
        signal,
      ) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const uuid = typeof args.uuid === "string" ? args.uuid : "";
        const text = typeof args.text === "string" ? args.text : "";
        try {
          agentPty.assertOwned(uuid, sessionId);
          const payload = args.submit === true ? `${text}\r` : text;
          agentPty.send(uuid, payload);
          return jsonContent({
            uuid,
            bytes: Buffer.byteLength(payload, "utf8"),
          });
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
    {
      name: "terminal_read",
      description:
        "Read a bounded page of retained output from an agent terminal.",
      parameters: {
        type: "object",
        properties: {
          uuid: { type: "string" },
          offset: { type: "number" },
          count: { type: "number" },
        },
        required: ["uuid"],
        additionalProperties: false,
      },
      async execute(
        args: { uuid?: string; offset?: number; count?: number },
        signal,
      ) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const uuid = typeof args.uuid === "string" ? args.uuid : "";
        try {
          agentPty.assertOwned(uuid, sessionId);
          const result = agentPty.read(uuid, args.offset, args.count);
          const bounded = boundBytes(result.text, READ_BYTE_LIMIT);
          return jsonContent({
            text: bounded.text,
            totalLines: result.totalLines,
            lineBegin: result.lineBegin,
            lineEnd: result.lineEnd,
            truncated: bounded.truncated,
          });
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
    {
      name: "terminal_wait_for",
      description:
        "Wait until a substring appears in an agent terminal transcript (or exit/timeout).",
      parameters: {
        type: "object",
        properties: {
          uuid: { type: "string" },
          needle: { type: "string" },
          timeoutMs: { type: "number" },
        },
        required: ["uuid", "needle"],
        additionalProperties: false,
      },
      async execute(
        args: { uuid?: string; needle?: string; timeoutMs?: number },
        signal,
      ) {
        const uuid = typeof args.uuid === "string" ? args.uuid : "";
        const needle = typeof args.needle === "string" ? args.needle : "";
        try {
          agentPty.assertOwned(uuid, sessionId);
          const result = await agentPty.waitFor(
            uuid,
            needle,
            typeof args.timeoutMs === "number" ? args.timeoutMs : 10_000,
            signal,
          );
          return jsonContent(result);
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
    {
      name: "terminal_resize",
      description: "Resize an agent terminal PTY (cols×rows, clamped 2..1024).",
      parameters: {
        type: "object",
        properties: {
          uuid: { type: "string" },
          cols: { type: "number" },
          rows: { type: "number" },
        },
        required: ["uuid", "cols", "rows"],
        additionalProperties: false,
      },
      async execute(
        args: { uuid?: string; cols?: number; rows?: number },
        signal,
      ) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const uuid = typeof args.uuid === "string" ? args.uuid : "";
        try {
          agentPty.assertOwned(uuid, sessionId);
          const dims = agentPty.resize(
            uuid,
            typeof args.cols === "number" ? args.cols : 80,
            typeof args.rows === "number" ? args.rows : 24,
          );
          return jsonContent({ uuid, ...dims });
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
    {
      name: "terminal_signal",
      description:
        'Send SIGINT/SIGTSTP (Ctrl+C/Z) or SIGTERM/SIGKILL/SIGHUP to an agent terminal.',
      parameters: {
        type: "object",
        properties: {
          uuid: { type: "string" },
          signal: {
            type: "string",
            enum: [...ALLOWED_SIGNALS],
          },
        },
        required: ["uuid", "signal"],
        additionalProperties: false,
      },
      async execute(
        args: { uuid?: string; signal?: string },
        abort,
      ) {
        if (abort?.aborted) throw new DOMException("aborted", "AbortError");
        const uuid = typeof args.uuid === "string" ? args.uuid : "";
        const sig = args.signal;
        if (
          !ALLOWED_SIGNALS.includes(sig as AgentTerminalSignal)
        ) {
          return { content: "unsupported signal", isError: true };
        }
        try {
          agentPty.assertOwned(uuid, sessionId);
          agentPty.signal(uuid, sig as AgentTerminalSignal);
          return jsonContent({ uuid, signal: sig });
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
    {
      name: "terminal_close",
      description: "Close an agent terminal and drop its state (idempotent).",
      parameters: {
        type: "object",
        properties: { uuid: { type: "string" } },
        required: ["uuid"],
        additionalProperties: false,
      },
      async execute(args: { uuid?: string }, signal) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const uuid = typeof args.uuid === "string" ? args.uuid : "";
        try {
          agentPty.assertOwned(uuid, sessionId);
          const closed = agentPty.close(uuid);
          return jsonContent({ uuid, closed });
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          };
        }
      },
    },
  ];
}

/** Register/replace sidebar agent tools on a live Agent tool registry. */
export function bindSidebarAgentTools(
  tools: ToolRegistry,
  options: SidebarAgentToolsOptions,
): void {
  const prefs = options.readPrefs();
  const openOn = prefs.agentOpenTools === true;
  const termOn = prefs.agentTerminalTools === true;
  const batch: ToolDefinition[] = [];
  if (openOn) batch.push(createSidebarOpenTool(options));
  if (termOn) batch.push(...createAgentTerminalTools(options));
  for (const tool of batch) {
    if (tools.get(tool.name)) tools.replace(tool);
    else tools.register(tool);
  }
}
