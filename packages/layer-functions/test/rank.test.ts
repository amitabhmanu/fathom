import { describe, expect, it } from "vitest";
import { rank } from "../src/rank.js";

describe("rank", () => {
  it("sorts candidates best-first with populated ranking_metadata on every result", () => {
    const result = rank({
      query: "resolveEndpoint pipe name",
      candidates: [
        { source_uri: "file:///a.ts", content: "unrelated content about something else entirely" },
        {
          source_uri: "file:///b.ts",
          content: "export function resolveEndpoint(root) { return pipeName; }"
        },
        { source_uri: "file:///c.ts", content: "resolveEndpoint pipe name docs" }
      ]
    });

    expect(result.ranked.length).toBeGreaterThan(0);
    expect(typeof result.cutoff_applied).toBe("number");

    for (let i = 0; i < result.ranked.length; i++) {
      expect(result.ranked[i].ranking_metadata?.rank).toBe(i);
      expect(result.ranked[i].ranking_metadata?.query).toBe("resolveEndpoint pipe name");
    }

    for (let i = 1; i < result.ranked.length; i++) {
      const prevScore = result.ranked[i - 1].ranking_metadata!.score;
      const currScore = result.ranked[i].ranking_metadata!.score;
      expect(prevScore).toBeGreaterThanOrEqual(currScore);
    }

    expect(result.ranked[0].source_uri).toBe("file:///c.ts");
  });

  it("drops candidates below the relevance cutoff", () => {
    const result = rank({
      query: "extremely specific rare term xyzzy",
      candidates: [{ source_uri: "file:///unrelated.ts", content: "completely unrelated content" }]
    });
    expect(result.ranked).toEqual([]);
  });

  it("produces envelopes matching the context contract schema shape", () => {
    const result = rank({
      query: "fetch client",
      candidates: [{ source_uri: "file:///x.ts", content: "a fetch client implementation" }]
    });
    const envelope = result.ranked[0];
    expect(envelope.schema_version).toBe("v1");
    expect(envelope.origin_layer).toBe("1");
    expect(envelope.provenance).toBe("system-authoritative");
    expect(envelope.confidence).toBeGreaterThanOrEqual(0);
    expect(envelope.confidence).toBeLessThanOrEqual(1);
    expect(envelope.freshness_contract.half_life_seconds).toBeGreaterThan(0);
  });
});
