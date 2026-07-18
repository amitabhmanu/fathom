import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createFathomMcpServer } from "../src/server.js";

describe("fathom-mcp server scaffold", () => {
  it("constructs without throwing", () => {
    expect(() => createFathomMcpServer()).not.toThrow();
  });

  it("connects to a client over an in-memory transport", async () => {
    const server = createFathomMcpServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerVersion()).toEqual({ name: "fathom-mcp", version: "0.1.0" });

    await client.close();
  });

  it("does not declare the tools capability yet (zero tools registered, per Phase 0 scope)", async () => {
    // Real MCP behavior: a server only declares/handles "tools/list" once at least one
    // tool has been registered (see McpServer.setToolRequestHandlers, called lazily from
    // registerTool). Phase 0 intentionally registers none, so this must fail, not return [].
    const server = createFathomMcpServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await expect(client.listTools()).rejects.toThrow(/Method not found/);

    await client.close();
  });
});
