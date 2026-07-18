import { describe, expect, it } from "vitest";
import { reconcile } from "../src/reconcile.js";
import { ConfigSourceOfTruthRegistry } from "../src/registry/sourceOfTruthRegistry.js";
import type { RegistryConfig } from "../src/registry/registryConfig.schema.js";

const CONFIG: RegistryConfig = {
  pricing: {
    rules: [
      { uri_prefix: "crm://", priority: 100 },
      { uri_prefix: "wiki://", priority: 20 }
    ],
    rationale: "CRM is the system of record for pricing."
  }
};

describe("reconcile", () => {
  it("lets the registry settle it when one candidate strictly outranks the others", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    const result = reconcile({
      data_type: "pricing",
      registry,
      candidates: [
        { source_uri: "wiki://pricing", content: "$10/mo" },
        { source_uri: "crm://pricing", content: "$12/mo" }
      ]
    });
    expect(result.chosen.source_uri).toBe("crm://pricing");
    expect(result.chosen.content).toBe("$12/mo");
    expect(result.chosen.discard_record).toHaveLength(1);
    expect(result.chosen.discard_record![0].reason).toMatch(/registry/);
    expect(result.requires_human_tiebreak).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("falls back to recency when the registry doesn't distinguish the candidates", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    const result = reconcile({
      data_type: "unknown-data-type",
      registry,
      candidates: [
        { source_uri: "a://x", content: "old value", last_modified: "2026-01-01T00:00:00.000Z" },
        { source_uri: "b://x", content: "new value", last_modified: "2026-06-01T00:00:00.000Z" }
      ]
    });
    expect(result.chosen.source_uri).toBe("b://x");
    expect(result.chosen.content).toBe("new value");
    expect(result.chosen.discard_record![0].reason).toMatch(/recency/);
    expect(result.requires_human_tiebreak).toBe(false);
  });

  it("flags requires_human_tiebreak when neither registry nor recency distinguishes the candidates", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    const result = reconcile({
      data_type: "unknown-data-type",
      registry,
      candidates: [
        { source_uri: "a://x", content: "value a" },
        { source_uri: "b://x", content: "value b" }
      ]
    });
    expect(result.requires_human_tiebreak).toBe(true);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("throws for an empty candidate list (caller misuse, not a normal reconciliation outcome)", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    expect(() => reconcile({ data_type: "pricing", registry, candidates: [] })).toThrow();
  });
});
