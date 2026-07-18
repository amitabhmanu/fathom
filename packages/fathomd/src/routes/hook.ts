import { rank } from "@fathom/layer-functions";
import type { RawEventLog } from "../store/rawEventLog.js";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RankingLog } from "../store/rankingLog.js";
import type { CompactionLog } from "../store/compactionLog.js";
import type { AccessStatusStore, AccessStatusKind } from "../store/accessStatusStore.js";
import { isRankableToolUse, extractRankInput } from "./postToolUseRanking.js";
import { applyFitToToolOutput, buildPostToolUseFitResponse, makeRawSourceEnvelope } from "./postToolUseFit.js";
import { deriveToolSourceUri } from "./toolSourceUri.js";

export interface HookRouteDeps {
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
  compactionLog: CompactionLog;
  accessStatusStore: AccessStatusStore;
}

export type HookResponse =
  | Record<string, never>
  | {
      decision?: "block";
      reason?: string;
      hookSpecificOutput?: {
        hookEventName: string;
        updatedToolOutput?: string;
        additionalContext?: string;
        permissionDecision?: "allow" | "deny" | "ask" | "defer";
        permissionDecisionReason?: string;
        retry?: boolean;
      };
    };

function isRecordPayload(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}

interface PostToolUsePayloadShape {
  tool_name?: unknown;
  tool_input?: unknown;
  tool_output?: unknown;
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
 * Layer 3, PreToolUse side: before letting a tool call proceed, check whether Fathom
 * already knows (from an earlier PostToolUseFailure/PermissionDenied in this project) that
 * this source is inaccessible, and gate proactively instead of letting the same failure
 * happen twice. Credential issues get "ask" (a human might resolve it); format/policy
 * issues get "deny" (asking again won't fix a scanned PDF or a legal hold).
 */
function handlePreToolUse(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput } = payload;
  if (typeof toolName !== "string") {
    return {};
  }
  const sourceUri = deriveToolSourceUri(toolName, (toolInput ?? {}) as Record<string, unknown>);
  const status = deps.accessStatusStore.get(sourceUri);
  if (!status) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: status.status === "credentials" ? "ask" : "deny",
      permissionDecisionReason: `Fathom previously marked "${sourceUri}" inaccessible (${status.status}): ${status.reason}`
    }
  };
}

function classifyToolError(toolError: string): AccessStatusKind | "not-found" | "unknown" {
  const lower = toolError.toLowerCase();
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return "credentials";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "not-found";
  }
  if (lower.includes("parse") || lower.includes("format") || lower.includes("corrupt")) {
    return "format";
  }
  return "unknown";
}

/**
 * Real PostToolUseFailure shape: tool_name, tool_input, tool_error. A failed fetch is a
 * first-class inaccessibility signal, not just an error — but a 404/"not found" is a
 * *relocation* signal (layer 4), deliberately left untagged here and deferred fully to
 * Phase 4, per docs/fathom-roadmap.md's Phase 3 scope.
 */
function handlePostToolUseFailure(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput, tool_error: toolError } = payload;
  if (typeof toolName !== "string" || typeof toolError !== "string") {
    return {};
  }

  const classification = classifyToolError(toolError);
  if (classification === "not-found" || classification === "unknown") {
    return {};
  }

  const sourceUri = deriveToolSourceUri(toolName, (toolInput ?? {}) as Record<string, unknown>);
  deps.accessStatusStore.markInaccessible(sourceUri, classification, toolError);

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext:
        `Fathom detected a layer-3 ${classification} issue accessing "${sourceUri}": ${toolError}. ` +
        `Future attempts at this source will be gated until this is resolved.`
    }
  };
}

/** Real PermissionDenied shape: tool_name, tool_input, denial_reason. */
function handlePermissionDenied(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput, denial_reason: denialReason } = payload;
  if (typeof toolName !== "string") {
    return {};
  }
  const sourceUri = deriveToolSourceUri(toolName, (toolInput ?? {}) as Record<string, unknown>);
  const reason = typeof denialReason === "string" ? denialReason : "denied by policy";
  deps.accessStatusStore.markInaccessible(sourceUri, "policy", reason);

  return {
    hookSpecificOutput: {
      hookEventName: "PermissionDenied",
      retry: false
    }
  };
}

/**
 * Phase 0 behavior: every hook event is logged raw and gets back the minimal no-op shape.
 * Phase 1 adds PostToolUse ranking; Phase 2 adds PostToolUse fit() and PreCompact/
 * PostCompact; Phase 3 adds PreToolUse/PostToolUseFailure/PermissionDenied layer-3 gating.
 */
export function handleHook(eventName: string, payload: unknown, deps: HookRouteDeps): HookResponse {
  deps.rawEventLog.append(eventName, payload);

  if (!isRecordPayload(payload)) {
    return {};
  }

  if (eventName === "PostToolUse") {
    return handlePostToolUse(payload, deps);
  }

  if (eventName === "PreCompact") {
    return handlePreCompact(deps);
  }

  if (eventName === "PostCompact") {
    return handlePostCompact(deps);
  }

  if (eventName === "PreToolUse") {
    return handlePreToolUse(payload, deps);
  }

  if (eventName === "PostToolUseFailure") {
    return handlePostToolUseFailure(payload, deps);
  }

  if (eventName === "PermissionDenied") {
    return handlePermissionDenied(payload, deps);
  }

  return {};
}
