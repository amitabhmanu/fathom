export type BudgetDecision = "pass" | "summarize" | "delegate";

const CHARS_PER_TOKEN_ESTIMATE = 4;

// Content requiring more than this many times the budget is treated as too large/interlinked
// to summarize linearly in one pass, per the layers doc's "sub-agent map-reduce" solution
// component for content that's too large to summarize inline.
const DELEGATE_MULTIPLIER = 8;

/** Zero-dependency token estimate (no tokenizer): ~4 chars/token for English prose/code. */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Decides which of layer 2's three paths a piece of content takes: pass through unchanged,
 * summarize inline, or delegate to a sub-agent. This is the "budget selector" from
 * docs/fathom-roadmap.md's Phase 2 deliverables.
 */
export function selectBudgetDecision(content: string, budgetTokens: number): BudgetDecision {
  const estimatedTokens = estimateTokens(content);
  if (estimatedTokens <= budgetTokens) {
    return "pass";
  }
  if (estimatedTokens > budgetTokens * DELEGATE_MULTIPLIER) {
    return "delegate";
  }
  return "summarize";
}
