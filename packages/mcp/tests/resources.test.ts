import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPolicyEngine, denyMcpResourceServers } from "@xrkseek/policy";
import {
  createMcpClient,
  createMcpResourceTools,
  renderResourceResult,
} from "../src/index.js";

function allowPolicy() {
  return createPolicyEngine({ defaults: { "mcp.connect": "allow" } });
}

async function linkedResourceServer(): Promise<{
  createTransport: () => Promise<
    import("@modelcontextprotocol/sdk/shared/transport.js").Transport
  >;
  close: () => Promise<void>;
}> {
  const server = new McpServer(
    { name: "test-resources", version: "0.0.0" },
    { capabilities: { resources: {} } },
  );
  server.registerResource(
    "note",
    "docs://note",
    { description: "a note", mimeType: "text/plain" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: "hello-resource", mimeType: "text/plain" }],
    }),
  );
  server.registerResource(
    "doc",
    new ResourceTemplate("docs://{id}", { list: undefined }),
    { description: "templated doc" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: `id=${uri.pathname}`, mimeType: "text/plain" }],
    }),
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  return {
    createTransport: async () => clientTransport,
    close: async () => {
      await server.close();
    },
  };
}

describe("mcp resources", () => {
  it("lists resources, templates, and reads by URI", async () => {
    const linked = await linkedResourceServer();
    const client = createMcpClient({
      serverName: "docs",
      command: "unused",
      policy: allowPolicy(),
      createTransport: linked.createTransport,
    });
    await client.connect();

    const listed = await client.listResources();
    expect(listed.items.some((r) => r.uri === "docs://note")).toBe(true);

    const templates = await client.listResourceTemplates();
    expect(
      templates.items.some((t) => t.uriTemplate.includes("{id}")),
    ).toBe(true);

    const read = await client.readResource("docs://note");
    expect(read.contents[0]).toMatchObject({
      uri: "docs://note",
      text: "hello-resource",
    });

    await client.dispose();
    await linked.close();
  });

  it("returns empty resource lists when server has no resources capability", async () => {
    const { Server } = await import(
      "@modelcontextprotocol/sdk/server/index.js"
    );
    const server = new Server(
      { name: "tools-only", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = createMcpClient({
      serverName: "nor",
      command: "unused",
      policy: allowPolicy(),
      createTransport: async () => clientTransport,
    });
    await client.connect();
    expect(await client.listResources()).toEqual({ items: [] });
    expect(await client.listResourceTemplates()).toEqual({ items: [] });
    await expect(client.readResource("x://y")).rejects.toThrow(/does not support resources/);
    await client.dispose();
    await server.close();
  });

  it("enforces mcp.resource policy deny", async () => {
    const linked = await linkedResourceServer();
    const policy = createPolicyEngine({
      defaults: { "mcp.connect": "allow" },
      rules: [denyMcpResourceServers(["docs"])],
    });
    const client = createMcpClient({
      serverName: "docs",
      command: "unused",
      policy,
      createTransport: linked.createTransport,
    });
    await client.connect();
    await expect(client.listResources()).rejects.toThrow(/policy deny/);
    await expect(client.readResource("docs://note")).rejects.toThrow(
      /policy deny/,
    );
    await client.dispose();
    await linked.close();
  });

  it("shared tools resolve by server and redact blobs", async () => {
    expect(
      renderResourceResult("s", {
        contents: [{ uri: "x", blob: "YWJj" }],
      }),
    ).toContain("[binary resource: 4 base64 characters");

    const linked = await linkedResourceServer();
    const client = createMcpClient({
      serverName: "docs",
      command: "unused",
      policy: allowPolicy(),
      createTransport: linked.createTransport,
    });
    await client.connect();
    const tools = createMcpResourceTools({
      resolveClient: (name) => (name === "docs" ? client : undefined),
    });
    const list = tools.find((t) => t.name === "list_mcp_resources");
    const read = tools.find((t) => t.name === "read_mcp_resource");
    expect(list).toBeDefined();
    const listed = await list!.execute({ server: "docs" });
    expect(String(listed.content)).toContain("docs://note");
    const body = await read!.execute({ server: "docs", uri: "docs://note" });
    expect(String(body.content)).toContain("hello-resource");
    await expect(list!.execute({ server: "missing" })).rejects.toThrow(
      /unavailable/,
    );
    await client.dispose();
    await linked.close();
  });
});
