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

describe("fathom_report_gap", () => {
  it("converts a raw signal into a nameable question referencing the task context", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const result = (await callTool("fathom_report_gap", {
      description: "customer-impact numbers are missing",
      task_context: "drafting the incident postmortem"
    })) as { question: string; documentation_priority: boolean };

    expect(result.question).toContain("drafting the incident postmortem");
    expect(result.question).toContain("customer-impact numbers are missing");
    expect(result.documentation_priority).toBe(false);
  });

  it("flags documentation_priority once the same task_context recurs past the threshold", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    let last: { documentation_priority: boolean } | undefined;
    for (let i = 0; i < 3; i++) {
      last = (await callTool("fathom_report_gap", {
        description: `gap number ${i}`,
        task_context: "recurring-topic"
      })) as { documentation_priority: boolean };
    }

    expect(last?.documentation_priority).toBe(true);
  });
});
