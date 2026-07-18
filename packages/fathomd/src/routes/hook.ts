import { rank } from "@fathom/layer-functions";
import type { RawEventLog } from "../store/rawEventLog.js";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RankingLog } from "../store/rankingLog.js";
import type { CompactionLog } from "../store/compactionLog.js";
import { isRankableToolUse, extractRankInput } from "./postToolUseRanking.js";
import { applyFitToToolOutput, buildPostToolUseFitResponse, makeRawSourceEnvelope } from "./postToolUseFit.js";

export interface HookRouteDeps {
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
  compactionLog: CompactionLog;
}

export type HookResponse =
  | Record<string, never>
  | {
      hookSpecificOutput: {
        hookEventName: string;
        updatedToolOutput?: string;
        additionalContext?: string;
      };
    };

interface PostToolUsePayloadShape {
  tool_name?: unknown;
  tool_input?: unknown;
  tool_output?: unknown;
}

function isPostToolUsePayload(payload: unknown): payload is PostToolUsePayloadShape {
  return typeof payload === "object" && payload !== null;
}

function handlePostToolUse(payload: PostToolUsePayloadShape, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput, tool_output: toolOutput } = payload;
  const toolInputRecord = (toolInput ?? {}) as Record<string, unknown>;

  // Phase 1: layer-1 ranking for Read/Grep/Glob.
  if (isRankableToolUse(toolName) && typeof toolOutput === "string") {
    const { query, candidates } = extractRankInput(toolName, toolInputRecord, toolOutput);
    if (candidates.length > 0) {
      const { ranked, cutoff_applied: cutoffApplied } = rank({ query, candidates });
      for (const envelope of ranked) {
        deps.envelopeStore.put(envelope);
      }
      deps.rankingLog.append(
        query,
        cutoffApplied,
        ranked.map((envelope) => ({
          source_uri: envelope.source_uri,
          score: envelope.ranking_metadata!.score,
          rank: envelope.ranking_metadata!.rank
        }))
      );
    }
  }

  // Phase 2: layer-2 fit for any tool's oversized output, not just the rankable set.
  if (typeof toolName === "string" && typeof toolOutput === "string") {
    const { fitResult, sourceUri } = applyFitToToolOutput(toolName, toolInputRecord, toolOutput);
    if (fitResult.kind === "summarize") {
      // Store the original content under its own key so the summary's retrieval_hook has
      // something real to resolve back to (see docs/fathom-context-contract.md's
      // "compression is a one-way door without this" invariant).
      deps.envelopeStore.put(makeRawSourceEnvelope(toolOutput, sourceUri));
      deps.envelopeStore.put(fitResult.envelope);
    }
    return buildPostToolUseFitResponse(fitResult);
  }

  return {};
}

function handlePreCompact(deps: HookRouteDeps): HookResponse {
  const docSummaries = deps.envelopeStore
    .listAll()
    .filter((envelope) => envelope.origin_layer === "2" && envelope.retrieval_hook?.resolution === "doc");

  if (docSummaries.length === 0) {
    return {};
  }

  deps.compactionLog.recordPreCompact(docSummaries.map((envelope) => envelope.envelope_id));

  const summaryLines = docSummaries
    .map((envelope) => `- ${envelope.retrieval_hook!.full_source_uri}: ${envelope.content}`)
    .join("\n");

  // Real PreCompact decision control is `additionalContext` or `decision:"block"` — there is
  // no field that literally replaces Claude Code's own compaction output. This injects
  // Fathom's summaries alongside compaction rather than swapping it, per the correction
  // documented in fathom-architecture.md's PreCompact row.
  return {
    hookSpecificOutput: {
      hookEventName: "PreCompact",
      additionalContext:
        `Fathom has stored hierarchical summaries for the following sources from this session ` +
        `(full content still resolvable via their retrieval_hook.full_source_uri):\n${summaryLines}`
    }
  };
}

function handlePostCompact(deps: HookRouteDeps): HookResponse {
  // Side-effect-only per real PostCompact capability — logging, no decision control.
  const referencedIds = deps.compactionLog.lastPreCompactEnvelopeIds();
  if (referencedIds.length > 0) {
    deps.compactionLog.recordPostCompact(referencedIds);
  }
  return {};
}

/**
 * Phase 0 behavior: every hook event is logged raw and gets back the minimal no-op shape.
 * Phase 1 adds PostToolUse ranking; Phase 2 adds PostToolUse fit() (compression/delegation)
 * and PreCompact/PostCompact (surfacing + logging stored summaries across compaction).
 */
export function handleHook(eventName: string, payload: unknown, deps: HookRouteDeps): HookResponse {
  deps.rawEventLog.append(eventName, payload);

  if (eventName === "PostToolUse" && isPostToolUsePayload(payload)) {
    return handlePostToolUse(payload, deps);
  }

  if (eventName === "PreCompact") {
    return handlePreCompact(deps);
  }

  if (eventName === "PostCompact") {
    return handlePostCompact(deps);
  }

  return {};
}
