import { describe, expect, it } from "vitest";
import { elicit } from "../src/elicit.js";

describe("elicit", () => {
  it("wraps a human answer with human-confirmed provenance", () => {
    const result = elicit({
      question: "Why did we choose vendor X over Y?",
      human_available: true,
      human_answer: "Decided in the Q2 vendor review meeting for cost reasons."
    });
    expect(result.kind).toBe("human-answer");
    if (result.kind === "human-answer") {
      expect(result.content).toBe("Decided in the Q2 vendor review meeting for cost reasons.");
      expect(result.envelope.provenance).toBe("human-confirmed");
      expect(result.envelope.origin_layer).toBe("5");
      expect(result.envelope.source_uri).toMatch(/^fathom:\/\/elicited\//);
    }
  });

  it("wraps a best-effort inference with inferred provenance and cites its basis", () => {
    const result = elicit({
      question: "What's the workaround for this edge case?",
      human_available: false,
      inference: { content: "Likely retry with backoff, based on similar cases.", basis: ["file:///a.ts", "file:///b.ts"] }
    });
    expect(result.kind).toBe("inference");
    if (result.kind === "inference") {
      expect(result.envelope.provenance).toBe("inferred");
      expect(result.basis).toEqual(["file:///a.ts", "file:///b.ts"]);
    }
  });

  it("never treats inference as more confident than a human-confirmed answer", () => {
    const humanResult = elicit({ question: "q", human_available: true, human_answer: "a" });
    const inferenceResult = elicit({
      question: "q",
      human_available: false,
      inference: { content: "a", basis: [] }
    });
    if (humanResult.kind === "human-answer" && inferenceResult.kind === "inference") {
      expect(humanResult.envelope.confidence).toBeGreaterThan(inferenceResult.envelope.confidence);
    }
  });

  it("returns unresolved rather than guessing when neither an answer nor inference is available", () => {
    const result = elicit({ question: "q", human_available: false });
    expect(result.kind).toBe("unresolved");
    if (result.kind === "unresolved") {
      expect(result.reason).toMatch(/no human available/);
    }
  });

  it("returns unresolved distinctly when a human is available but hasn't answered yet", () => {
    const result = elicit({ question: "q", human_available: true });
    expect(result.kind).toBe("unresolved");
    if (result.kind === "unresolved") {
      expect(result.reason).toMatch(/no answer has been provided/);
    }
  });
});
