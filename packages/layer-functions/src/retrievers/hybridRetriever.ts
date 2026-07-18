import { scoreKeyword } from "./keyword.js";
import { scoreEmbedding } from "./embedding.js";

export interface HybridScore {
  score: number;
  keywordScore: number;
  embeddingScore: number;
}

// Keyword-weighted: a strong exact-identifier keyword hit must not be overridden by
// embedding similarity on a semantically-related-but-term-absent candidate (code search
// cares more about exact symbol/term matches than loose semantic similarity).
const KEYWORD_WEIGHT = 0.75;
const EMBEDDING_WEIGHT = 0.25;

export function scoreHybrid(queryTokens: string[], query: string, content: string): HybridScore {
  const keywordScore = scoreKeyword(queryTokens, content);
  const embeddingScore = scoreEmbedding(query, content);
  return {
    score: KEYWORD_WEIGHT * keywordScore + EMBEDDING_WEIGHT * embeddingScore,
    keywordScore,
    embeddingScore
  };
}
