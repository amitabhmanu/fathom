import { describe, expect, it } from "vitest";
import { discover } from "../src/discover.js";

const CATALOG = [
  { system: "confluence", content_types: ["policy", "wiki-page"], confidence: 0.9 },
  { system: "zendesk", content_types: ["macro", "ticket"], confidence: 0.8 },
  { system: "slack", content_types: ["message"], confidence: 0.3 }
];

describe("discover", () => {
  it("routes to single-high-confidence when exactly one catalog match clears the threshold", () => {
    const result = discover({ query: "refund policy", catalog: CATALOG });
    expect(result.route).toBe("single-high-confidence");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].source_uri).toBe("confluence://");
  });

  it("routes to multiple when more than one catalog match clears the threshold", () => {
    const catalog = [
      { system: "confluence", content_types: ["ticket"], confidence: 0.9 },
      { system: "zendesk", content_types: ["ticket"], confidence: 0.8 }
    ];
    const result = discover({ query: "ticket", catalog });
    expect(result.route).toBe("multiple");
    expect(result.candidates).toHaveLength(2);
  });

  it("routes to none-below-threshold when nothing clears the confidence bar", () => {
    const result = discover({ query: "message", catalog: CATALOG });
    expect(result.route).toBe("none-below-threshold");
  });

  it("routes to none-below-threshold when nothing in the catalog matches the query at all", () => {
    const result = discover({ query: "completely-unrelated-topic", catalog: CATALOG });
    expect(result.route).toBe("none-below-threshold");
    expect(result.candidates).toEqual([]);
  });
});
