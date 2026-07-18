import { describe, expect, it } from "vitest";
import { fit } from "../src/fit.js";

describe("fit", () => {
  it("passes content under budget through unchanged", () => {
    const result = fit({ content: "short content", source_uri: "file:///a.md", budget_tokens: 100 });
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.envelope.content).toBe("short content");
      expect(result.envelope.source_uri).toBe("file:///a.md");
    }
  });

  it("summarizes content over budget, populating retrieval_hook back to the original source_uri", () => {
    const oversized = "x".repeat(2000);
    const result = fit({ content: oversized, source_uri: "file:///big.md", budget_tokens: 100 });
    expect(result.kind).toBe("summarize");
    if (result.kind === "summarize") {
      expect(result.envelope.retrieval_hook?.full_source_uri).toBe("file:///big.md");
      expect(result.envelope.retrieval_hook?.resolution).toBe("doc");
      expect(result.envelope.source_uri).not.toBe("file:///big.md");
    }
  });

  it("still produces a valid fresh summarize result when existing_hierarchy is passed", () => {
    const oversized = "x".repeat(2000);
    const result = fit({
      content: oversized,
      source_uri: "file:///big.md",
      budget_tokens: 100,
      existing_hierarchy: [{ full_source_uri: "file:///big.md", resolution: "doc", parent_hook: null }]
    });
    expect(result.kind).toBe("summarize");
  });

  it("delegates drastically oversized content instead of summarizing inline", () => {
    const huge = "x".repeat(50000);
    const result = fit({ content: huge, source_uri: "file:///huge.md", budget_tokens: 100 });
    expect(result.kind).toBe("delegate");
    if (result.kind === "delegate") {
      expect(result.subagent_task).toContain("file:///huge.md");
      expect(result.expected_return_shape.length).toBeGreaterThan(0);
    }
  });
});
