import { randomUUID, createHash } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "@fathom/context-contract";
import { rewriteQuery } from "./queryRewriter.js";
import { scoreHybrid } from "./retrievers/hybridRetriever.js";
import { rerank } from "./reranker.js";

export interface RankCandidate {
  source_uri: string;
  content: string;
  /** Added during Phase 1 implementation: fathom-api-spec.md's rank() candidate type
   *  lacked this, but the layers doc's layer-1 solution component requires
   *  recency-weighting, which needs a modification time to weight by. */
  last_modified?: string;
}

export interface RankInput {
  query: string;
  candidates: RankCandidate[];
}

export interface RankResult {
  ranked: Envelope[];
  cutoff_applied: number;
}

// Calibrated against the naive n-gram embedding's noise floor: two entirely unrelated
// English passages still share some character trigrams, producing a nonzero embedding
// score. The cutoff must sit above that noise floor or unrelated content never gets
// filtered (see packages/layer-functions/test/rank.test.ts's cutoff test).
const RELEVANCE_CUTOFF = 0.08;
const RETRIEVER_NAME = "hybrid-keyword-ngram-v1";
const LAYER1_HALF_LIFE_SECONDS = 3600;

/**
 * Layer 1 (happy path): of everything reachable, surface the right slice for this query.
 * Scores every candidate with the hybrid keyword+embedding retriever, reranks by recency
 * on near-ties, drops anything below the relevance cutoff, and wraps survivors in
 * envelopes with populated ranking_metadata per docs/fathom-context-contract.md.
 */
export function rank(input: RankInput): RankResult {
  const queryTokens = rewriteQuery(input.query);

  const scored = input.candidates.map((candidate) => ({
    ...candidate,
    score: scoreHybrid(queryTokens, input.query, candidate.content).score
  }));

  const reranked = rerank(scored);
  const aboveCutoff = reranked.filter((candidate) => candidate.score >= RELEVANCE_CUTOFF);

  const ranked: Envelope[] = aboveCutoff.map((candidate, index) => {
    const now = new Date().toISOString();
    return {
      schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
      envelope_id: randomUUID(),
      content: candidate.content,
      content_hash: createHash("sha256").update(candidate.content).digest("hex"),
      source_uri: candidate.source_uri,
      origin_layer: "1",
      provenance: "system-authoritative",
      confidence: Math.max(0, Math.min(1, candidate.score)),
      timestamp: now,
      freshness_contract: { half_life_seconds: LAYER1_HALF_LIFE_SECONDS },
      ranking_metadata: {
        query: input.query,
        score: candidate.score,
        rank: index,
        retriever: RETRIEVER_NAME
      }
    };
  });

  return { ranked, cutoff_applied: RELEVANCE_CUTOFF };
}
