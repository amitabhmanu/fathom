import { fit, wrapContentEnvelope, type FitResult } from "@fathom/layer-functions";
import { deriveToolSourceUri } from "./toolSourceUri.js";
import { extractToolResponseContent } from "./toolResponseContent.js";

/** Per-tool-result token budget. Deliberately small for Phase 2's own test fixtures to
 *  exercise summarize/delegate paths without needing enormous fixture content. */
export const POST_TOOL_USE_BUDGET_TOKENS = 500;

export interface FitApplication {
  fitResult: FitResult;
  sourceUri: string;
  /** The original, uncompressed content fit() ran against — callers need this back to build
   *  the raw-source envelope a "summarize" retrieval_hook resolves to. */
  content: string;
}

/**
 * Runs a PostToolUse tool_response through layer-2 fit(), for whichever tools have a real,
 * extractable single content string (see toolResponseContent.ts) — not literally "any tool"
 * as originally phrased, since most real tool_response shapes (Edit's diff-only result,
 * control/meta tool results) don't represent fetched/generated content in the sense layer 2
 * cares about. Returns null when there's nothing to fit.
 */
export function applyFitToToolOutput(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: unknown,
  budgetTokens: number = POST_TOOL_USE_BUDGET_TOKENS
): FitApplication | null {
  const content = extractToolResponseContent(toolName, toolResponse);
  if (content === undefined) {
    return null;
  }
  const sourceUri = deriveToolSourceUri(toolName, toolInput);
  const fitResult = fit({ content, source_uri: sourceUri, budget_tokens: budgetTokens });
  return { fitResult, sourceUri, content };
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
