export const CONTEXT_ENVELOPE_SCHEMA_VERSION = "v1";

export type OriginLayer = "1" | "2" | "3" | "3f" | "4" | "5" | "6";

export type Provenance =
  | "authoritative-human"
  | "human-confirmed"
  | "inferred"
  | "reconciled"
  | "redacted"
  | "cached"
  | "system-authoritative";

export interface FreshnessContract {
  ttl_seconds?: number | null;
  version_hash_watch?: boolean | null;
  session_only?: boolean | null;
  half_life_seconds?: number | null;
}

export interface DiscardRecordEntry {
  source_uri: string;
  reason: string;
  timestamp: string;
}

export interface AccessProvenance {
  granted_by: string;
  scope: string;
  redacted_fields?: string[];
  policy_ref?: string | null;
}

export interface RankingMetadata {
  query: string;
  score: number;
  rank: number;
  retriever: string;
}

export interface RetrievalHook {
  full_source_uri: string;
  resolution: "doc" | "section" | "chunk";
  parent_hook?: string | null;
}

/**
 * The Fathom context envelope. Mirrors docs/fathom-context-contract.md's JSON Schema.
 *
 * `schema_version`, `access_provenance_cleared_reason`, and `discard_record_cleared_reason`
 * were added during Phase 0 implementation to make the contract doc's stated invariants
 * ("fathomd should reject writes that drop a non-null access_provenance ... without an
 * explicit ...cleared_reason") mechanically checkable. See invariants.ts.
 */
export interface Envelope {
  schema_version: typeof CONTEXT_ENVELOPE_SCHEMA_VERSION;
  envelope_id: string;
  content: string;
  content_hash?: string;
  source_uri: string;
  origin_layer: OriginLayer;
  provenance: Provenance;
  confidence: number;
  timestamp: string;
  freshness_contract: FreshnessContract;
  discard_record?: DiscardRecordEntry[];
  discard_record_cleared_reason?: string | null;
  access_provenance?: AccessProvenance;
  access_provenance_cleared_reason?: string | null;
  ranking_metadata?: RankingMetadata;
  retrieval_hook?: RetrievalHook | null;
  supersedes?: string | null;
}
