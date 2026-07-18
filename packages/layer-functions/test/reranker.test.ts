import { describe, expect, it } from "vitest";
import { rerank } from "../src/reranker.js";

describe("rerank", () => {
  it("sorts by score descending", () => {
    const result = rerank([
      { source_uri: "a", content: "", score: 0.2 },
      { source_uri: "b", content: "", score: 0.8 },
      { source_uri: "c", content: "", score: 0.5 }
    ]);
    expect(result.map((r) => r.source_uri)).toEqual(["b", "c", "a"]);
  });

  it("breaks a score tie by recency, most recent first", () => {
    const result = rerank([
      { source_uri: "old", content: "", score: 0.5, last_modified: "2026-01-01T00:00:00.000Z" },
      { source_uri: "new", content: "", score: 0.5, last_modified: "2026-06-01T00:00:00.000Z" }
    ]);
    expect(result.map((r) => r.source_uri)).toEqual(["new", "old"]);
  });

  it("treats a missing last_modified as least recent", () => {
    const result = rerank([
      { source_uri: "unknown-time", content: "", score: 0.5 },
      { source_uri: "known-time", content: "", score: 0.5, last_modified: "2026-01-01T00:00:00.000Z" }
    ]);
    expect(result.map((r) => r.source_uri)).toEqual(["known-time", "unknown-time"]);
  });
});
