import { randomUUID, createHash } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope, type DiscardRecordEntry } from "@fathom/context-contract";
import type { SourceOfTruthRegistry } from "./registry/sourceOfTruthRegistry.js";

export interface ReconcileCandidate {
  source_uri: string;
  content: string;
  last_modified?: string;
}

export interface ReconcileInput {
  /** Added during Phase 3 implementation: fathom-api-spec.md's reconcile() input lacked
   *  this, but the registry can't rank sources without knowing what kind of data they are. */
  data_type: string;
  candidates: ReconcileCandidate[];
  registry: SourceOfTruthRegistry;
}

export interface ReconcileResult {
  chosen: Envelope;
  confidence: number;
  requires_human_tiebreak: boolean;
}

const REGISTRY_CONFIDENCE = 0.95;
const RECENCY_CONFIDENCE = 0.7;
const UNRESOLVED_CONFIDENCE = 0.4;
const LAYER3F_TTL_SECONDS = 900;

function makeEnvelope(content: string, sourceUri: string, discardRecord: DiscardRecordEntry[]): Envelope {
  const now = new Date().toISOString();
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: randomUUID(),
    content,
    content_hash: createHash("sha256").update(content).digest("hex"),
    source_uri: sourceUri,
    origin_layer: "3f",
    provenance: "reconciled",
    confidence: 1,
    timestamp: now,
    freshness_contract: { ttl_seconds: LAYER3F_TTL_SECONDS, version_hash_watch: true },
    discard_record: discardRecord
  };
}

function discardEntry(candidate: ReconcileCandidate, reason: string): DiscardRecordEntry {
  return { source_uri: candidate.source_uri, reason, timestamp: new Date().toISOString() };
}

/**
 * Layer 3f (fragmented): collapses multiple candidate copies of the same fact to one
 * reconciled source. Tries the source-of-truth registry first, falls back to recency, and
 * flags a human tiebreak when neither signal distinguishes the candidates.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  if (input.candidates.length === 0) {
    throw new Error("reconcile() requires at least one candidate");
  }
  if (input.candidates.length === 1) {
    const only = input.candidates[0];
    return {
      chosen: makeEnvelope(only.content, only.source_uri, []),
      confidence: REGISTRY_CONFIDENCE,
      requires_human_tiebreak: false
    };
  }

  const scored = input.candidates.map((candidate) => ({
    candidate,
    registryRank: input.registry.rank(input.data_type, candidate.source_uri)
  }));
  const maxRegistryRank = Math.max(...scored.map((s) => s.registryRank));
  const topByRegistry = scored.filter((s) => s.registryRank === maxRegistryRank);

  if (topByRegistry.length === 1 && maxRegistryRank > 0) {
    const winner = topByRegistry[0].candidate;
    const discardRecord = input.candidates
      .filter((c) => c.source_uri !== winner.source_uri)
      .map((c) => discardEntry(c, `registry: lower-ranked source for data_type "${input.data_type}"`));
    return {
      chosen: makeEnvelope(winner.content, winner.source_uri, discardRecord),
      confidence: REGISTRY_CONFIDENCE,
      requires_human_tiebreak: false
    };
  }

  // Registry didn't settle it (tie, or no registry entry for this data_type) — fall back to recency.
  const withTimestamps = input.candidates.filter((c) => c.last_modified);
  if (withTimestamps.length > 0) {
    const sorted = [...withTimestamps].sort(
      (a, b) => Date.parse(b.last_modified!) - Date.parse(a.last_modified!)
    );
    const mostRecent = sorted[0];
    const secondMostRecentTime = sorted[1] ? Date.parse(sorted[1].last_modified!) : -Infinity;
    if (Date.parse(mostRecent.last_modified!) > secondMostRecentTime) {
      const discardRecord = input.candidates
        .filter((c) => c.source_uri !== mostRecent.source_uri)
        .map((c) => discardEntry(c, "recency: more recently modified candidate preferred"));
      return {
        chosen: makeEnvelope(mostRecent.content, mostRecent.source_uri, discardRecord),
        confidence: RECENCY_CONFIDENCE,
        requires_human_tiebreak: false
      };
    }
  }

  // Neither the registry nor recency distinguishes the candidates — don't guess.
  const [first, ...rest] = input.candidates;
  const discardRecord = rest.map((c) => discardEntry(c, "insufficient evidence to reconcile automatically"));
  return {
    chosen: makeEnvelope(first.content, first.source_uri, discardRecord),
    confidence: UNRESOLVED_CONFIDENCE,
    requires_human_tiebreak: true
  };
}
