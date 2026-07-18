import { afterEach, describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { reconcile, ConfigSourceOfTruthRegistry, type RegistryConfig } from "@fathom/layer-functions";
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

describe("fathom_query_source_of_truth", () => {
  it("returns the top-ranked source and rationale for a configured data_type", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;
    daemon.registryStore.setEntry("pricing", {
      rules: [
        { uri_prefix: "crm://", priority: 100 },
        { uri_prefix: "wiki://", priority: 20 }
      ],
      rationale: "CRM is the system of record for pricing."
    });

    const result = (await callTool("fathom_query_source_of_truth", {
      data_type: "pricing",
      topic: "plan-a"
    })) as { source_uri: string; rationale: string };

    expect(result.source_uri).toBe("crm://plan-a");
    expect(result.rationale).toBe("CRM is the system of record for pricing.");
  });

  it("falls back gracefully when no registry entry exists for the data_type", async () => {
    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;

    const result = (await callTool("fathom_query_source_of_truth", {
      data_type: "totally-unconfigured-type",
      topic: "plan-a"
    })) as { source_uri: string; rationale: string };

    expect(result.source_uri).toBe("unknown://plan-a");
    expect(result.rationale).toMatch(/No registry entry/);
  });

  it("Phase 3 exit criterion: reconcile()'s discard_record and the MCP tool's rationale cite the same registry rule", async () => {
    const config: RegistryConfig = {
      pricing: {
        rules: [
          { uri_prefix: "crm://", priority: 100 },
          { uri_prefix: "wiki://", priority: 20 }
        ],
        rationale: "CRM is the system of record for pricing; wiki pages go stale."
      }
    };

    // A pricing-conflict scenario: wiki and CRM disagree on the price.
    const reconcileResult = reconcile({
      data_type: "pricing",
      registry: new ConfigSourceOfTruthRegistry(config),
      candidates: [
        { source_uri: "wiki://pricing/plan-a", content: "$10/mo" },
        { source_uri: "crm://pricing/plan-a", content: "$12/mo" }
      ]
    });

    expect(reconcileResult.chosen.source_uri).toBe("crm://pricing/plan-a");
    expect(reconcileResult.chosen.content).toBe("$12/mo");
    expect(reconcileResult.chosen.discard_record).toHaveLength(1);
    expect(reconcileResult.requires_human_tiebreak).toBe(false);

    daemon = await startRunningTestDaemon();
    process.env.FATHOM_PROJECT_ROOT = daemon.endpoint.projectRoot;
    daemon.registryStore.setEntry("pricing", config.pricing);

    const mcpResult = (await callTool("fathom_query_source_of_truth", {
      data_type: "pricing",
      topic: "plan-a"
    })) as { source_uri: string; rationale: string };

    // Same registry config, so the MCP tool's rationale must be the exact string reconcile()'s
    // discard_record implicitly relied on to pick crm:// over wiki://.
    expect(mcpResult.rationale).toBe(config.pricing.rationale);
    expect(mcpResult.source_uri).toBe("crm://plan-a");
  });
});
