import { basename } from "node:path";
import type { ToolDefinition, ToolExecuteExtras } from "@xrkseek/core-tools";
import type { AttachmentStore, ImageAttachmentRef } from "@xrkseek/attachment";
import { imageMediaTypeForPath, isWorkspaceImagePath } from "./read-image.js";

/**
 * Per-call delivery limit, aligned with DSH `tool-present` (default 8).
 */
export const PRESENT_MAX_FILES = 8;

export interface PresentFileArg {
  readonly path: string;
  readonly description?: string;
}

/** Minimal FS surface used by `present` (stat + optional image byte read). */
export interface PresentFs {
  stat(userPath: string): Promise<{ readonly isFile: boolean }>;
  readBytes?(userPath: string, maxBytes?: number): Promise<Uint8Array>;
}

export interface PresentToolOptions {
  /** Maximum files per call. Must be a positive safe integer. */
  readonly maxFiles?: number;
  /**
   * When set, PNG/JPEG/WebP/GIF/SVG deliverables are persisted as durable image
   * attachments so the chat row can gallery them like `read_image` /
   * `image_generate`. Non-image files stay path-only.
   */
  readonly attachments?: AttachmentStore;
}

type TextPart = { readonly type: "text"; readonly text: string };
type ImagePart = { readonly type: "image"; readonly attachment: ImageAttachmentRef };

/**
 * `present` — model-declared final deliverables (DSH `tool-present`).
 *
 * Declares existing files as outputs the user asked to receive. Unlike the
 * turn-end `workspace/changes` diff capture (which only sees write/edit/patch
 * paths), `present` lets the model declare files created through shell /
 * scripts / downloads as deliverables. Image paths also ride durable
 * `type: "image"` blocks so the client shows an inline gallery.
 */
export function createPresentTool(
  fs: PresentFs,
  options: PresentToolOptions = {},
): ToolDefinition {
  const maxFiles = options.maxFiles ?? PRESENT_MAX_FILES;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new Error("present requires a positive integer maxFiles");
  }
  const attachments = options.attachments;
  return {
    name: "present",
    description:
      "Declare existing files as final deliverables the user asked to receive " +
      "(delivery + on-screen display). " +
      "Call present after writing a file (including files created through Bash, scripts, or downloads) " +
      "and before your final response; mentioning the path in your reply does not replace this call. " +
      "PNG/JPEG/WebP/GIF/SVG paths are shown inline in chat like read_image / image_generate. " +
      "Relative paths resolve against the workspace root; contents are not copied for non-image files.",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          maxItems: maxFiles,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              description: { type: "string" },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      required: ["files"],
    },
    async execute(args, _signal, extras?: ToolExecuteExtras) {
      const a = args as { files?: PresentFileArg[] };
      const files = a.files ?? [];
      if (files.length === 0) {
        return { content: "present requires at least one file", isError: true };
      }
      if (files.length > maxFiles) {
        return {
          content: `present accepts at most ${maxFiles} files per call`,
          isError: true,
        };
      }
      const declared: { path: string; description?: string }[] = [];
      for (const file of files) {
        const p = String(file.path ?? "");
        if (!p.trim()) {
          return { content: "present requires a non-empty path", isError: true };
        }
        try {
          const st = await fs.stat(p);
          if (!st.isFile) {
            return {
              content: `present: not a regular file: ${p}`,
              isError: true,
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: `present: cannot access ${p}: ${message}`, isError: true };
        }
        const description =
          typeof file.description === "string" && file.description.trim()
            ? file.description.trim()
            : undefined;
        declared.push(description === undefined ? { path: p } : { path: p, description });
      }
      if (extras) {
        extras.emitToolEvent("deliverables/presented", { files: declared });
      }

      const lines = declared.map((file) => {
        const desc = file.description ? ` (${file.description})` : "";
        return `presented ${file.path}${desc}`;
      });
      const textBlock: TextPart = { type: "text", text: lines.join("\n") };

      // No attachment store or no image byte reader → path text only (standing tools).
      if (attachments === undefined || fs.readBytes === undefined) {
        return { content: textBlock.text };
      }

      const imageParts: ImagePart[] = [];
      for (const file of declared) {
        if (!isWorkspaceImagePath(file.path)) continue;
        const mediaType = imageMediaTypeForPath(file.path);
        if (
          mediaType !== undefined
          && !attachments.imageLimits.mediaTypes.includes(mediaType)
        ) {
          continue;
        }
        if (mediaType === undefined && attachments.importImageFile === undefined) {
          continue;
        }
        try {
          const byteCap = Math.min(
            attachments.imageLimits.maxImageBytes,
            attachments.imageLimits.maxMessageImageBytes,
          );
          const data = await fs.readBytes(file.path, byteCap);
          const leaf = basename(file.path);
          const ref = attachments.importImageFile !== undefined
            ? await attachments.importImageFile({
                data,
                fileName: leaf,
                sourcePath: file.path,
              })
            : await attachments.saveImage({
                data,
                mediaType: mediaType!,
                name: leaf,
                sourcePath: file.path,
              });
          imageParts.push({ type: "image", attachment: ref });
        } catch {
          continue;
        }
      }

      if (imageParts.length === 0) {
        return {
          content: textBlock.text,
          meta: { path: declared[0]?.path },
        };
      }

      return {
        content: [textBlock, ...imageParts],
        meta: {
          path: declared[0]?.path,
          ...(declared.length > 1 ? { paths: declared.map((f) => f.path) } : {}),
        },
      };
    },
    isConcurrencySafe: () => true,
    presentCall: (args) => {
      const entries = (args as { files?: PresentFileArg[] }).files ?? [];
      return {
        card: "generic" as const,
        title: "Present delivered files",
        kind: "edit" as const,
        rawInput: entries,
        locations: entries
          .filter((entry) => typeof entry.path === "string" && entry.path.trim())
          .map((entry) => ({ path: entry.path })),
      };
    },
  };
}
