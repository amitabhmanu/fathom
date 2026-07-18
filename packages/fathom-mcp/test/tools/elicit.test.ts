import { afterEach, describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createFathomMcpServer } from "../../src/server.js";
import { startRunningTestDaemon, type RunningTestDaemon } from "../helpers/testDaemon.js";

let daemon: RunningTestDaemon | undefined;
const originalProjectRoot = process.env.FATHOM_PROJECT_ROOT;

afterEach(async () => {
  if (daemon) {
    await daemon.cleanup();
    daemon = undefined;
  }
  process.env.FATHOM_PROJECT_ROOT = originalProjectRoot;
});

function makeClient(): { server: ReturnType<typeof createFathomMcpServer>; client: Client } {
  const server = createFathomMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client };
}

describe("fathom_elicit", () => {
  it("formalizes a given human answer with human-confirmed provenance", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const { server, client } = makeClient();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "fathom_elicit",
      arguments: {
        question: "Why did we choose vendor X over Y?",
        human_answer: "Decided in the Q2 vendor review for cost reasons."
      }
    });
    await client.close();

    const content = (result.content as { type: string; text: string }[])[0];
    const parsed = JSON.parse(content.text) as { content: string; provenance: string };
    expect(parsed.content).toBe("Decided in the Q2 vendor review for cost reasons.");
    expect(parsed.provenance).toBe("human-confirmed");
  });

  it("writes the elicited envelope back to the store, retrievable by its fathom://elicited/ source_uri", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const { server, client } = makeClient();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({
      name: "fathom_elicit",
      arguments: { question: "What's the workaround?", human_answer: "Retry with backoff." }
    });
    await client.close();

    const stored = daemon.envelopeStore
      .listAll()
      .find((e) => e.origin_layer === "5" && e.content === "Retry with backoff.");
    expect(stored).toBeTruthy();
    expect(stored?.source_uri).toMatch(/^fathom:\/\/elicited\//);
    expect(stored?.provenance).toBe("human-confirmed");
  });

  it("throws a clear tool error rather than fabricating an answer when human_answer is empty", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const { server, client } = makeClient();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // The MCP tool schema requires human_answer as a string; an empty string is the
    // legitimate way to simulate "no answer yet" without violating the schema.
    const result = await client.callTool({
      name: "fathom_elicit",
      arguments: { question: "Unanswered question", human_answer: "" }
    });
    await client.close();

    expect(result.isError).toBe(true);
  });
});
