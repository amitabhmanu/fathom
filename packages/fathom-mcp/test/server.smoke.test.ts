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

  it("declares fathom_query_source_of_truth and fathom_request_access as of Phase 3", async () => {
    const server = createFathomMcpServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(["fathom_query_source_of_truth", "fathom_request_access"]);

    await client.close();
  });
});
