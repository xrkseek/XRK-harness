# @xrkseek/mcp

MCP host / remote **client** plane（本仓主要角色）+ 可选日后 local-as-MCP server。

**Status:** empty shell（`export {}`）— **禁止当产品依赖**。

实现前必读调研笔记：[docs/learn/mcp-protocol.md](../../docs/learn/mcp-protocol.md)。  
权威规格：https://modelcontextprotocol.io/specification/2025-11-25/  
门禁：`policy` 的 `mcp.connect` 默认 **deny**（见 `docs/policy.md`）。
