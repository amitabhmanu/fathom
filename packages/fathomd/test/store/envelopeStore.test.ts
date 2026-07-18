import { describe, expect, it } from "vitest";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "@fathom/context-contract";
import { openDb } from "../../src/store/db.js";
import { EnvelopeStore } from "../../src/store/envelopeStore.js";

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: "11111111-1111-1111-1111-111111111111",
    content: "hello",
    source_uri: "file:///docs/foo.md",
    origin_layer: "1",
    provenance: "system-authoritative",
    confidence: 0.9,
    timestamp: "2026-07-18T00:00:00.000Z",
    freshness_contract: {},
    ...overrides
  };
}

describe("EnvelopeStore", () => {
  it("puts and gets an envelope by id", () => {
    const store = new EnvelopeStore(openDb(":memory:"));
    const result = store.put(envelope());
    expect(result.ok).toBe(true);
    const fetched = store.getById("11111111-1111-1111-1111-111111111111");
    expect(fetched?.content).toBe("hello");
  });

  it("gets envelopes by source_uri", () => {
    const store = new EnvelopeStore(openDb(":memory:"));
    store.put(envelope());
    const fetched = store.getBySourceUri("file:///docs/foo.md");
    expect(fetched).toHaveLength(1);
  });

  it("never persists a write rejected by the invariant guard", () => {
    const store = new EnvelopeStore(openDb(":memory:"));
    const bad = { ...envelope(), confidence: 5 };
    const result = store.put(bad);
    expect(result.ok).toBe(false);
    expect(store.getById("11111111-1111-1111-1111-111111111111")).toBeNull();
  });

  it("deletes an envelope", () => {
    const store = new EnvelopeStore(openDb(":memory:"));
    store.put(envelope());
    expect(store.delete("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(store.getById("11111111-1111-1111-1111-111111111111")).toBeNull();
  });
});
