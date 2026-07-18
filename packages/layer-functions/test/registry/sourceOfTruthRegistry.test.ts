import { describe, expect, it } from "vitest";
import { ConfigSourceOfTruthRegistry } from "../../src/registry/sourceOfTruthRegistry.js";
import type { RegistryConfig } from "../../src/registry/registryConfig.schema.js";

const CONFIG: RegistryConfig = {
  pricing: {
    rules: [
      { uri_prefix: "crm://", priority: 100 },
      { uri_prefix: "wiki://", priority: 20 }
    ],
    rationale: "CRM is the system of record for pricing."
  }
};

describe("ConfigSourceOfTruthRegistry", () => {
  it("returns the configured higher rank for a matching data_type/source_uri", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    expect(registry.rank("pricing", "crm://pricing/plan-a")).toBe(100);
    expect(registry.rank("pricing", "wiki://pricing/plan-a")).toBe(20);
    expect(registry.rank("pricing", "crm://pricing/plan-a")).toBeGreaterThan(
      registry.rank("pricing", "wiki://pricing/plan-a")
    );
  });

  it("falls back to 0 (not throw/NaN) for an unknown data_type", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    expect(registry.rank("unknown-data-type", "crm://x")).toBe(0);
  });

  it("falls back to 0 for a source_uri that matches no rule under a known data_type", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    expect(registry.rank("pricing", "slack://random-channel")).toBe(0);
  });

  it("exposes the configured rationale for a data_type", () => {
    const registry = new ConfigSourceOfTruthRegistry(CONFIG);
    expect(registry.rationale("pricing")).toBe("CRM is the system of record for pricing.");
    expect(registry.rationale("unknown")).toBeUndefined();
  });
});
