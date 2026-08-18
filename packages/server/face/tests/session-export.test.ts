import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import { createFaceRuntime } from "../src/runtime.js";
import { createFaceOnlyServer } from "../src/attach-http.js";
import { isSessionExportPath, buildSessionExportZip } from "../src/session-export.js";
import { buildStoredZip, zipEntryName } from "../src/zip-store.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
    drain: {
      wake() {},
      async cancel() {},
      isActive() {
        return false;
      },
    },
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

describe("session.export", () => {
  it("claims GET/HEAD paths without stealing REST", () => {
    expect(isSessionExportPath("/api/session.export")).toBe(true);
    expect(isSessionExportPath("/api/face/session.export")).toBe(true);
    expect(isSessionExportPath("/api/session.prompt")).toBe(false);
  });

  it("HEAD 200 then GET zip with jsonl + descendants", async () => {
    const store = createMemorySessionStore();
    const parent = newSession(store);
    const child = newSession(store);
    store.append(parent.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "export-root-token",
    });
    store.append(child.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t2",
      stepId: "s1",
      content: "child-log",
    });
    const runtime = bareRuntime(store);
    runtime.subagents.attach({
      parentSessionId: parent.id,
      childSessionId: child.id,
      mode: "one-shot",
      label: "kid",
    });

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) => req.headers.authorization === "Bearer k",
    });
    const { port } = await face.listen();
    const url = `http://127.0.0.1:${port}/api/session.export?sessionId=${encodeURIComponent(parent.id)}&includeDescendants=true`;
    const head = await fetch(url, {
      method: "HEAD",
      headers: { authorization: "Bearer k" },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toMatch(/zip/);

    const get = await fetch(url, {
      headers: { authorization: "Bearer k" },
    });
    expect(get.status).toBe(200);
    const buf = Buffer.from(await get.arrayBuffer());
    expect(buf.subarray(0, 2).toString("utf8")).toBe("PK");
    const asText = buf.toString("latin1");
    expect(asText).toContain(`sessions/${parent.id}.jsonl`);
    expect(asText).toContain(`sessions/${child.id}.jsonl`);
    expect(asText).toContain("export-root-token");
    expect(asText).toContain("manifest.json");

    const missing = await fetch(
      `http://127.0.0.1:${port}/api/session.export?sessionId=nope`,
      { method: "HEAD", headers: { authorization: "Bearer k" } },
    );
    expect(missing.status).toBe(404);

    await face.close();
  });

  it("packs attachment bytes when the store has them", async () => {
    const store = createMemorySessionStore();
    const attachments = createMemoryAttachmentStore();
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const ref = await attachments.saveImage({
      data: png,
      mediaType: "image/png",
      name: "dot.png",
    });
    const session = newSession(store);
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: [
        { type: "text", text: "pic" },
        { type: "image", attachment: ref },
      ],
    });
    const runtime = createFaceRuntime({
      store,
      attachments,
      workspaceRoot: process.cwd(),
      version: "test",
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) => req.headers.authorization === "Bearer k",
    });
    const { port } = await face.listen();
    const get = await fetch(
      `http://127.0.0.1:${port}/api/session.export?sessionId=${encodeURIComponent(session.id)}`,
      { headers: { authorization: "Bearer k" } },
    );
    expect(get.status).toBe(200);
    const buf = Buffer.from(await get.arrayBuffer());
    expect(buf.toString("latin1")).toContain(`attachments/${ref.attachmentId}.png`);
    await face.close();
  });

  it("buildStoredZip round-trips PK header", () => {
    const zip = buildStoredZip([
      { name: "a.txt", data: Buffer.from("hello") },
    ]);
    expect(zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(
      true,
    );
    expect(zip.includes(Buffer.from("hello"))).toBe(true);
  });

  it("strips parent segments from zip entry names", () => {
    expect(zipEntryName("../evil/../x.jsonl")).toBe("evil/x.jsonl");
    expect(zipEntryName("/abs/a.txt")).toBe("abs/a.txt");
    const zip = buildStoredZip([
      { name: "../../outside.txt", data: Buffer.from("nope") },
    ]);
    expect(zip.toString("latin1")).toContain("outside.txt");
    expect(zip.toString("latin1")).not.toContain("..");
  });

  it("session.export zip paths cannot escape the archive", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store, "../evil");
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "token",
    });
    const zip = await buildSessionExportZip(bareRuntime(store), session.id, false);
    const asText = zip.toString("latin1");
    expect(asText).toContain("sessions/evil.jsonl");
    expect(asText).not.toContain("sessions/../");
  });
});
