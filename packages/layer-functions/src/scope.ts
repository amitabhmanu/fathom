import { randomUUID } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "@fathom/context-contract";

export interface ScopeGapInput {
  raw_signal: string;
  task_context: string;
  checklist_ref?: string;
}

export interface ScopeSpec {
  question: string;
  requires_human: boolean;
  envelope: Envelope;
}

const LAYER6_CONFIDENCE = 0.3;

/**
 * Layer 6 (unknown context): converts a confabulation-risk moment into a nameable question.
 * Phase 4 MVP always defers to a human (`requires_human: true`) — there's no automated way
 * to resolve a genuine unknown-unknown, per the layers doc's own framing of this layer as a
 * calibration problem, not a retrieval one.
 */
export function scope(gap: ScopeGapInput): ScopeSpec {
  const question = gap.checklist_ref
    ? `Regarding "${gap.task_context}" (checklist: ${gap.checklist_ref}): ${gap.raw_signal}`
    : `Regarding "${gap.task_context}": ${gap.raw_signal}`;

  const envelopeId = randomUUID();
  const now = new Date().toISOString();
  const envelope: Envelope = {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: envelopeId,
    content: question,
    source_uri: `fathom://scoped/${envelopeId}`,
    origin_layer: "6",
    provenance: "inferred",
    confidence: LAYER6_CONFIDENCE,
    timestamp: now,
    // Layer 6's carryover is deliberately the lightest of any layer — just the stated spec,
    // void once the task that raised it ends (docs/fathom-context-contract.md).
    freshness_contract: { session_only: true }
  };

  return { question, requires_human: true, envelope };
}
