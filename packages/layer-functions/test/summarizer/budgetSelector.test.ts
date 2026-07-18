import { describe, expect, it } from "vitest";
import { estimateTokens, selectBudgetDecision } from "../../src/summarizer/budgetSelector.js";

describe("estimateTokens", () => {
  it("estimates roughly 4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("a".repeat(401))).toBe(101);
  });
});

describe("selectBudgetDecision", () => {
  it("passes content exactly at budget", () => {
    expect(selectBudgetDecision("a".repeat(400), 100)).toBe("pass");
  });

  it("passes content one token under budget", () => {
    expect(selectBudgetDecision("a".repeat(396), 100)).toBe("pass");
  });

  it("summarizes content one token over budget", () => {
    expect(selectBudgetDecision("a".repeat(401), 100)).toBe("summarize");
  });

  it("summarizes content exactly at the delegate threshold (8x budget)", () => {
    // 8x budget = 800 tokens = 3200 chars exactly; boundary is ">", not ">=", so this stays summarize.
    expect(selectBudgetDecision("a".repeat(3200), 100)).toBe("summarize");
  });

  it("delegates content one token over the delegate threshold", () => {
    expect(selectBudgetDecision("a".repeat(3201), 100)).toBe("delegate");
  });
});
