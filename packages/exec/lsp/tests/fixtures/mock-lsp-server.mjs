import { stdin, stdout } from "node:process";

const SEP = "\r\n\r\n";
let buffer = Buffer.alloc(0);
let exiting = false;

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  stdout.write(Buffer.concat([header, body]));
}

function handle(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  if (method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        capabilities: {
          positionEncoding: "utf-16",
          textDocumentSync: 1,
          definitionProvider: true,
          referencesProvider: true,
          implementationProvider: true,
          hoverProvider: true,
        },
      },
    });
    return;
  }
  if (method === "initialized" || method === "textDocument/didOpen" || method === "textDocument/didClose") {
    return;
  }
  if (method === "textDocument/definition") {
    const uri = params?.textDocument?.uri ?? "file:///src/a.ts";
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        uri,
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 3 },
        },
      },
    });
    return;
  }
  if (method === "textDocument/references") {
    const uri = params?.textDocument?.uri ?? "file:///src/a.ts";
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: [
        {
          uri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
        {
          uri,
          range: {
            start: { line: 4, character: 2 },
            end: { line: 4, character: 5 },
          },
        },
      ],
    });
    return;
  }
  if (method === "textDocument/implementation") {
    const uri = params?.textDocument?.uri ?? "file:///src/a.ts";
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: [
        {
          targetUri: uri,
          targetSelectionRange: {
            start: { line: 8, character: 1 },
            end: { line: 8, character: 4 },
          },
        },
      ],
    });
    return;
  }
  if (method === "textDocument/hover") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        contents: { kind: "markdown", value: "const ping: string" },
      },
    });
    return;
  }
  if (method === "shutdown") {
    writeMessage({ jsonrpc: "2.0", id, result: null });
    return;
  }
  if (method === "exit") {
    exiting = true;
    process.exit(0);
  }
  if (id !== undefined) {
    writeMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    });
  }
}

stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const sep = buffer.indexOf(SEP);
    if (sep < 0) break;
    const header = buffer.toString("ascii", 0, sep);
    let length;
    for (const line of header.split("\r\n")) {
      if (line.toLowerCase().startsWith("content-length:")) {
        length = Number(line.slice(line.indexOf(":") + 1).trim());
      }
    }
    if (!Number.isInteger(length)) break;
    const start = sep + SEP.length;
    const end = start + length;
    if (buffer.length < end) break;
    const body = buffer.toString("utf8", start, end);
    buffer = buffer.subarray(end);
    handle(JSON.parse(body));
    if (exiting) return;
  }
});

stdin.on("end", () => {
  if (!exiting) process.exit(0);
});
