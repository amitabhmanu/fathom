import { randomUUID, createHash } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "@fathom/context-contract";

export interface ElicitInput {
  question: string;
  human_available: boolean;
  /** Added during Phase 4 implementation: fathom-api-spec.md's elicit() took only a
   *  question, but a pure function can't itself carry out an interactive "ask a human"
   *  step — that happens in the caller (fathom_elicit, via a real conversation turn). This
   *  is the answer once the caller already has it, for elicit() to wrap and provenance-tag. */
  human_answer?: string;
  /** Populated when the caller falls back to inference from adjacent evidence rather than
   *  a direct human answer. */
  inference?: { content: string; basis: string[] };
}

export type ElicitResult =
  | { kind: "human-answer"; content: string; envelope: Envelope }
  | { kind: "inference"; content: string; envelope: Envelope; basis: string[] }
  | { kind: "unresolved"; reason: string };

const LAYER5_HALF_LIFE_SECONDS = 1800;

function makeElicitEnvelope(content: string, provenance: "human-confirmed" | "inferred"): Envelope {
  const envelopeId = randomUUID();
  const now = new Date().toISOString();
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: envelopeId,
    content,
    content_hash: createHash("sha256").update(content).digest("hex"),
    source_uri: `fathom://elicited/${envelopeId}`,
    origin_layer: "5",
    provenance,
    confidence: provenance === "human-confirmed" ? 0.9 : 0.5,
    timestamp: now,
    freshness_contract: { half_life_seconds: LAYER5_HALF_LIFE_SECONDS }
  };
}

/**
 * Layer 5 (doesn't exist anywhere): wraps an already-obtained human answer or best-effort
 * inference with mandatory provenance tagging, never presenting inference as fact. Returns
 * "unresolved" rather than guessing when neither is available — legible failure over a
 * confidently wrong answer, per the layers doc.
 */
export function elicit(input: ElicitInput): ElicitResult {
  if (input.human_answer !== undefined) {
    const envelope = makeElicitEnvelope(input.human_answer, "human-confirmed");
    return { kind: "human-answer", content: input.human_answer, envelope };
  }

  if (input.inference) {
    const envelope = makeElicitEnvelope(input.inference.content, "inferred");
    return { kind: "inference", content: input.inference.content, envelope, basis: input.inference.basis };
  }

  return {
    kind: "unresolved",
    reason: input.human_available
      ? "human available but no answer has been provided yet"
      : "no human available and no adjacent evidence to infer from"
  };
}
