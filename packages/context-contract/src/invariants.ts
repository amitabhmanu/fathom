import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "./envelope.js";
import { parseEnvelope } from "./envelope.schema.js";

export type WriteValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates a write of `next` where `prev` is the envelope `next.supersedes` points to
 * (or null if this is a brand-new envelope with no predecessor).
 *
 * Enforces the schema-version guard and the non-drop rule from
 * docs/fathom-context-contract.md: discard_record and access_provenance must carry
 * forward across a supersedes chain unless the new envelope states an explicit
 * *_cleared_reason for why it's no longer needed.
 */
export function validateEnvelopeWrite(
  prev: Envelope | null,
  next: unknown
): WriteValidationResult {
  const parsed = parseEnvelope(next);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `envelope failed schema validation: ${parsed.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    };
  }

  if (parsed.envelope.schema_version !== CONTEXT_ENVELOPE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unrecognized schema_version "${parsed.envelope.schema_version}"; fathomd only accepts "${CONTEXT_ENVELOPE_SCHEMA_VERSION}"`
    };
  }

  if (!prev) {
    return { ok: true };
  }

  if (parsed.envelope.supersedes !== prev.envelope_id) {
    // Not actually a supersede write against this prev; nothing to check.
    return { ok: true };
  }

  const prevHadDiscardRecord = !!prev.discard_record && prev.discard_record.length > 0;
  const nextDroppedDiscardRecord =
    prevHadDiscardRecord && (!parsed.envelope.discard_record || parsed.envelope.discard_record.length === 0);
  if (nextDroppedDiscardRecord && !parsed.envelope.discard_record_cleared_reason) {
    return {
      ok: false,
      reason:
        "next envelope drops a non-empty discard_record from its supersedes chain without discard_record_cleared_reason"
    };
  }

  const prevHadAccessProvenance = !!prev.access_provenance;
  const nextDroppedAccessProvenance = prevHadAccessProvenance && !parsed.envelope.access_provenance;
  if (nextDroppedAccessProvenance && !parsed.envelope.access_provenance_cleared_reason) {
    return {
      ok: false,
      reason:
        "next envelope drops a non-null access_provenance from its supersedes chain without access_provenance_cleared_reason"
    };
  }

  return { ok: true };
}
