import { describe, expect, it } from "vitest";
import { parseEnvelope } from "../src/envelope.schema.js";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION } from "../src/envelope.js";

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: "11111111-1111-1111-1111-111111111111",
    content: "hello world",
    source_uri: "file:///docs/foo.md",
    origin_layer: "1",
    provenance: "system-authoritative",
    confidence: 0.9,
    timestamp: "2026-07-18T00:00:00.000Z",
    freshness_contract: { half_life_seconds: 3600 },
    ...overrides
  };
}

describe("EnvelopeSchema", () => {
  it("accepts a minimal valid envelope", () => {
    const result = parseEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
  });

  it("rejects an envelope missing origin_layer", () => {
    const input = validEnvelope();
    delete (input as Record<string, unknown>).origin_layer;
    const result = parseEnvelope(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path.join(".") === "origin_layer")).toBe(true);
    }
  });

  it("accepts origin_layer '3f' as a string enum member, not a coerced number", () => {
    const result = parseEnvelope(validEnvelope({ origin_layer: "3f" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.origin_layer).toBe("3f");
      expect(typeof result.envelope.origin_layer).toBe("string");
    }
  });

  it("rejects an unrecognized schema_version", () => {
    const result = parseEnvelope(validEnvelope({ schema_version: "v99" }));
    expect(result.ok).toBe(false);
  });

  it("rejects confidence outside [0,1]", () => {
    expect(parseEnvelope(validEnvelope({ confidence: 1.5 })).ok).toBe(false);
    expect(parseEnvelope(validEnvelope({ confidence: -0.1 })).ok).toBe(false);
  });
});
