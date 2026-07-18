import { describe, expect, it } from "vitest";
import { scoreKeyword } from "../../src/retrievers/keyword.js";
import { rewriteQuery } from "../../src/queryRewriter.js";

describe("scoreKeyword", () => {
  it("ranks an exact keyword hit above a keyword-absent near-miss", () => {
    const queryTokens = rewriteQuery("parseEnvelope function");
    const exactHit = "export function parseEnvelope(input: unknown): EnvelopeParseResult { ... }";
    const nearMiss = "This module validates structured data shapes before they are used downstream.";

    const exactScore = scoreKeyword(queryTokens, exactHit);
    const nearMissScore = scoreKeyword(queryTokens, nearMiss);

    expect(exactScore).toBeGreaterThan(nearMissScore);
    expect(nearMissScore).toBe(0);
  });

  it("returns 0 when there are no query tokens or no content tokens", () => {
    expect(scoreKeyword([], "some content")).toBe(0);
    expect(scoreKeyword(["term"], "")).toBe(0);
  });
});
