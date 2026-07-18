import { describe, expect, it } from "vitest";
import { scoreHybrid } from "../../src/retrievers/hybridRetriever.js";
import { rewriteQuery } from "../../src/queryRewriter.js";

describe("scoreHybrid", () => {
  it("does not let embedding similarity override a strong exact-identifier keyword hit", () => {
    const query = "resolveEndpoint";
    const queryTokens = rewriteQuery(query);

    // Exact identifier match, but otherwise unrelated prose (low embedding overlap with query words).
    const exactIdentifierHit = "export function resolveEndpoint(projectRoot: string): FathomEndpoint { ... }";
    // No exact term match at all, but shares many characters/substrings with the query
    // (long descriptive prose about the same general topic, to give the naive n-gram
    // embedding scorer maximum opportunity to score this higher than it deserves).
    const semanticNearMissNoTerm = "This section discusses how a running background process locates its own network address and communication channel based on the project directory, without ever naming the resolver function directly.";

    const exactScore = scoreHybrid(queryTokens, query, exactIdentifierHit).score;
    const semanticScore = scoreHybrid(queryTokens, query, semanticNearMissNoTerm).score;

    expect(exactScore).toBeGreaterThan(semanticScore);
  });

  it("keyword and embedding components are both present in the breakdown", () => {
    const queryTokens = rewriteQuery("fetch client");
    const result = scoreHybrid(queryTokens, "fetch client", "a fetch client implementation");
    expect(result.keywordScore).toBeGreaterThan(0);
    expect(result.score).toBeCloseTo(0.75 * result.keywordScore + 0.25 * result.embeddingScore, 10);
  });
});
