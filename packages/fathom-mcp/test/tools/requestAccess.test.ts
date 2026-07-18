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

describe("fathom_request_access", () => {
  it("never auto-grants: returns granted:false when no prior approval exists", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const result = (await callTool("fathom_request_access", {
      source_uri: "system://tickets/42",
      scope: "read-only:tickets",
      reason: "need to look up a customer ticket"
    })) as { granted: boolean };

    expect(result.granted).toBe(false);
  });

  it("returns granted:true only once a human has seeded a prior approval out of band", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;
    daemon.accessGrantStore.approve("system://tickets/42", "read-only:tickets", "human:amitabh");

    const result = (await callTool("fathom_request_access", {
      source_uri: "system://tickets/42",
      scope: "read-only:tickets",
      reason: "need to look up a customer ticket"
    })) as { granted: boolean };

    expect(result.granted).toBe(true);
  });

  it("does not grant a different scope on the same source_uri than the one approved", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;
    daemon.accessGrantStore.approve("system://tickets/42", "read-only:tickets", "human:amitabh");

    const result = (await callTool("fathom_request_access", {
      source_uri: "system://tickets/42",
      scope: "write:tickets",
      reason: "need to update a ticket"
    })) as { granted: boolean };

    expect(result.granted).toBe(false);
  });
});
