import { estimateTokens } from "../summarizer/budgetSelector.js";

export interface SubagentTaskResult {
  subagent_task: string;
  expected_return_shape: string;
}

/**
 * Builds the delegation brief for content too large/interlinked to summarize inline
 * (the layers doc's "sub-agent map-reduce" solution component). Doesn't invoke a
 * sub-agent itself — layer-functions stays pure and storage/agent-free; fathomd's
 * PostToolUse handler is what actually surfaces this to the model via additionalContext.
 */
export function buildSubagentTask(content: string, sourceUri: string, budgetTokens: number): SubagentTaskResult {
  const estimatedTokens = estimateTokens(content);
  return {
    subagent_task:
      `The content at "${sourceUri}" is too large to summarize inline (~${estimatedTokens} estimated tokens ` +
      `against a budget of ${budgetTokens}). Delegate to a sub-agent to read and distill it: extract only the ` +
      `load-bearing points relevant to the current task, not the full content.`,
    expected_return_shape:
      "A plain-text distillate that itself fits within the caller's token budget, covering the load-bearing " +
      "points of the delegated content — not the full content, and not a verbatim excerpt."
  };
}
