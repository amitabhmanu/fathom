import { fit, wrapContentEnvelope, type FitResult } from "@fathom/layer-functions";
import { deriveToolSourceUri } from "./toolSourceUri.js";

/** Per-tool-result token budget. Deliberately small for Phase 2's own test fixtures to
 *  exercise summarize/delegate paths without needing enormous fixture content. */
export const POST_TOOL_USE_BUDGET_TOKENS = 500;

export interface FitApplication {
  fitResult: FitResult;
  sourceUri: string;
}

/** Runs any PostToolUse tool_output through layer-2 fit(), regardless of tool_name — unlike
 *  ranking (Phase 1), oversized-content handling isn't limited to Read/Grep/Glob. */
export function applyFitToToolOutput(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  budgetTokens: number = POST_TOOL_USE_BUDGET_TOKENS
): FitApplication {
  const sourceUri = deriveToolSourceUri(toolName, toolInput);
  const fitResult = fit({ content: toolOutput, source_uri: sourceUri, budget_tokens: budgetTokens });
  return { fitResult, sourceUri };
}

export type PostToolUseHookSpecificOutput =
  | Record<string, never>
  | {
      hookSpecificOutput: {
        hookEventName: "PostToolUse";
        updatedToolOutput?: string;
        additionalContext?: string;
      };
    };

/**
 * Translates a FitResult into the real PostToolUse decision-control shape. "pass" needs no
 * response change (Phase 0/1 no-op); "summarize" replaces the tool result via
 * updatedToolOutput (confirmed real PostToolUse capability); "delegate" surfaces the
 * sub-agent brief via additionalContext, since there's no native "spawn a sub-agent for me"
 * hook field — the model decides whether to act on it.
 */
export function buildPostToolUseFitResponse(fitResult: FitResult): PostToolUseHookSpecificOutput {
  if (fitResult.kind === "pass") {
    return {};
  }
  if (fitResult.kind === "summarize") {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: fitResult.envelope.content
      }
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: fitResult.subagent_task
    }
  };
}

/** The original, uncompressed content stored under its own source_uri, so a "summarize"
 *  envelope's retrieval_hook.full_source_uri has something real to resolve back to. */
export function makeRawSourceEnvelope(content: string, sourceUri: string) {
  return wrapContentEnvelope(content, sourceUri);
}
