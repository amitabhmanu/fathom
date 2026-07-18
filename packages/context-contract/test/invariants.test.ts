import { describe, expect, it } from "vitest";
import { validateEnvelopeWrite } from "../src/invariants.js";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "../src/envelope.js";

function baseEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    content: "v1 content",
    source_uri: "file:///docs/foo.md",
    origin_layer: "3f",
    provenance: "reconciled",
    confidence: 0.8,
    timestamp: "2026-07-18T00:00:00.000Z",
    freshness_contract: {},
    discard_record: [{ source_uri: "wiki://foo", reason: "recency", timestamp: "2026-07-18T00:00:00.000Z" }],
    access_provenance: { granted_by: "human:amitabh", scope: "read-only" },
    ...overrides
  };
}

describe("validateEnvelopeWrite", () => {
  it("accepts a brand-new envelope with no predecessor", () => {
    const next = baseEnvelope({ supersedes: null });
    expect(validateEnvelopeWrite(null, next)).toEqual({ ok: true });
  });

  it("rejects an envelope failing schema validation", () => {
    const next = { ...baseEnvelope(), confidence: 5 };
    const result = validateEnvelopeWrite(null, next);
    expect(result.ok).toBe(false);
  });

  it("rejects a schema_version it doesn't recognize", () => {
    const next = { ...baseEnvelope(), schema_version: "v2" };
    const result = validateEnvelopeWrite(null, next);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/schema_version/);
  });

  it("rejects a supersede write that drops a non-empty discard_record without a cleared reason", () => {
    const prev = baseEnvelope();
    const next = baseEnvelope({
      envelope_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      supersedes: prev.envelope_id,
      discard_record: []
    });
    const result = validateEnvelopeWrite(prev, next);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/discard_record/);
  });

  it("accepts a supersede write that drops discard_record when a cleared reason is given", () => {
    const prev = baseEnvelope();
    const next = baseEnvelope({
      envelope_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      supersedes: prev.envelope_id,
      discard_record: [],
      discard_record_cleared_reason: "single source confirmed authoritative, fragmentation resolved upstream"
    });
    expect(validateEnvelopeWrite(prev, next)).toEqual({ ok: true });
  });

  it("rejects a supersede write that drops access_provenance without a cleared reason", () => {
    const prev = baseEnvelope();
    const next = baseEnvelope({
      envelope_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      supersedes: prev.envelope_id,
      access_provenance: undefined
    });
    const result = validateEnvelopeWrite(prev, next);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/access_provenance/);
  });

  it("does not apply supersede checks when next.supersedes does not point at prev", () => {
    const prev = baseEnvelope();
    const next = baseEnvelope({
      envelope_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      supersedes: "some-other-envelope-id",
      discard_record: [],
      access_provenance: undefined
    });
    expect(validateEnvelopeWrite(prev, next)).toEqual({ ok: true });
  });
});
