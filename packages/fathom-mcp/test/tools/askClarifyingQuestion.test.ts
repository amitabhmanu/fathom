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

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const server = createFathomMcpServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  const content = (result.content as { type: string; text: string }[])[0];
  return JSON.parse(content.text);
}

describe("fathom_ask_clarifying_question", () => {
  it("poses the question back for the model to relay, rather than confabulating", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const result = (await callTool("fathom_ask_clarifying_question", {
      question: "Should refunds be processed against the original payment method or store credit?"
    })) as { posed_question: string };

    expect(result.posed_question).toBe(
      "Should refunds be processed against the original payment method or store credit?"
    );
  });

  it("logs every call to the feedback store (recurrence tracking), per fathom-api-spec.md", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    await callTool("fathom_ask_clarifying_question", { question: "q1" });
    const count = daemon.recurrenceStore.count("clarifying-question");
    expect(count).toBeGreaterThan(0);
  });
});
