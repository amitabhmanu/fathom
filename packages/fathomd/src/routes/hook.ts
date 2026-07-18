import fs from "node:fs";
import { createHash } from "node:crypto";
import { rank, rewriteQuery, routeDrift, type ReEntryLayer } from "@fathom/layer-functions";
import type { RawEventLog } from "../store/rawEventLog.js";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RankingLog } from "../store/rankingLog.js";
import type { CompactionLog } from "../store/compactionLog.js";
import type { AccessStatusStore, AccessStatusKind } from "../store/accessStatusStore.js";
import type { DriftStore } from "../store/driftStore.js";
import type { ThresholdStore } from "../store/thresholdStore.js";
import { isRankableToolUse, extractRankInput } from "./postToolUseRanking.js";
import { applyFitToToolOutput, buildPostToolUseFitResponse, makeRawSourceEnvelope } from "./postToolUseFit.js";
import { deriveToolSourceUri } from "./toolSourceUri.js";
import { runCascadeFrom } from "./driftCascade.js";

export interface HookRouteDeps {
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
  compactionLog: CompactionLog;
  accessStatusStore: AccessStatusStore;
  driftStore: DriftStore;
  thresholdStore: ThresholdStore;
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
  tool_response?: unknown;
}

function handlePostToolUse(payload: PostToolUsePayloadShape, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput, tool_response: toolResponse } = payload;
  const toolInputRecord = (toolInput ?? {}) as Record<string, unknown>;

  // Phase 1: layer-1 ranking for Read/Grep/Glob.
  if (isRankableToolUse(toolName)) {
    const { query, candidates } = extractRankInput(toolName, toolInputRecord, toolResponse);
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

  // Phase 2: layer-2 fit for any tool whose tool_response has real, extractable content.
  if (typeof toolName === "string") {
    const application = applyFitToToolOutput(toolName, toolInputRecord, toolResponse);
    if (application) {
      const { fitResult, sourceUri, content } = application;
      if (fitResult.kind === "summarize") {
        // Store the original content under its own key so the summary's retrieval_hook has
        // something real to resolve back to (see docs/fathom-context-contract.md's
        // "compression is a one-way door without this" invariant).
        deps.envelopeStore.put(makeRawSourceEnvelope(content, sourceUri));
        deps.envelopeStore.put(fitResult.envelope);
      }
      return buildPostToolUseFitResponse(fitResult);
    }
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
 * Layer 3/layer-router, PreToolUse side: before letting a tool call proceed, checks two
 * independent things Fathom might already know about the target source:
 * 1. Known-inaccessible (from an earlier PostToolUseFailure/PermissionDenied) — deny/ask.
 * 2. Unresolved drift (from an earlier FileChanged/ConfigChange, neither of which has
 *    decision control) — this is hop 2 of the two-hop mechanism: run the cascade now that
 *    we're at a decision-capable hook, mark it resolved, and surface what changed.
 */
function handlePreToolUse(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput } = payload;
  if (typeof toolName !== "string") {
    return {};
  }
  const sourceUri = deriveToolSourceUri(toolName, (toolInput ?? {}) as Record<string, unknown>);

  const status = deps.accessStatusStore.get(sourceUri);
  if (status) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: status.status === "credentials" ? "ask" : "deny",
        permissionDecisionReason: `Fathom previously marked "${sourceUri}" inaccessible (${status.status}): ${status.reason}`
      }
    };
  }

  // Specific-source drift (FileChanged) takes priority; a global marker (ConfigChange,
  // which has no per-source_uri to attach to) is checked as a fallback so a policy change
  // still gets surfaced on the very next tool call, regardless of which source it targets.
  const drift = deps.driftStore.unresolvedFor(sourceUri) ?? deps.driftStore.unresolvedFor("*");
  if (drift) {
    let refreshedNote = "";
    if (drift.source_uri === sourceUri && fs.existsSync(sourceUri)) {
      const freshContent = fs.readFileSync(sourceUri, "utf-8");
      const cascade = JSON.parse(drift.cascade_json) as ReEntryLayer[];
      const cascadeResult = runCascadeFrom(cascade, sourceUri, freshContent, {
        envelopeStore: deps.envelopeStore,
        rankingLog: deps.rankingLog
      });
      refreshedNote =
        cascadeResult.layers_executed.length > 0
          ? ` Refreshed layers: ${cascadeResult.layers_executed.join(", ")}.`
          : "";
      if (cascadeResult.layers_surfaced.length > 0) {
        refreshedNote += ` Layers needing your attention (can't be auto-resolved): ${cascadeResult.layers_surfaced.join(", ")}.`;
      }
    } else if (drift.source_uri === "*") {
      refreshedNote = " This affects access grants generally, not just this source — consider reconfirming any credential-gated access.";
    }
    deps.driftStore.resolve(drift.id);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `Fathom detected drift (${drift.signal_type}) on "${drift.source_uri}".${refreshedNote}`
      }
    };
  }

  return {};
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
 * first-class inaccessibility/relocation signal, not just an error. Phase 5 completes the
 * Phase 3 deferral: a 404/"not found" is now routed as "source-moved" drift (layer 4).
 * PostToolUseFailure supports additionalContext directly, so this surfaces in one hop —
 * no two-hop dance needed here, unlike FileChanged/ConfigChange.
 */
function handlePostToolUseFailure(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const { tool_name: toolName, tool_input: toolInput, tool_error: toolError } = payload;
  if (typeof toolName !== "string" || typeof toolError !== "string") {
    return {};
  }

  const classification = classifyToolError(toolError);
  const sourceUri = deriveToolSourceUri(toolName, (toolInput ?? {}) as Record<string, unknown>);

  if (classification === "not-found") {
    const routed = routeDrift({ type: "source-moved", confidence: 0.8 }, deps.thresholdStore.overridesSnapshot());
    if (!routed.triggered) {
      return {};
    }
    deps.driftStore.record(sourceUri, "source-moved", routed.re_entry_layer, routed.cascade);
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUseFailure",
        additionalContext:
          `Fathom detected "${sourceUri}" may have moved or been renamed (${toolError}). ` +
          `Consider rediscovering its location rather than retrying the same path.`
      }
    };
  }

  if (classification === "unknown") {
    return {};
  }

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
 * Real FileChanged shape (per code.claude.com/docs/en/hooks): only the common input
 * fields — no dedicated "which file" field is documented. This tries the conventional
 * `file_path` field defensively; if a real deployment's shape differs, this simply finds
 * nothing to compare and logs the raw event without attempting drift detection, rather
 * than guessing or crashing.
 *
 * FileChanged has **no decision control at all** (confirmed: side-effect/logging only) —
 * this is hop 1 of the two-hop mechanism: detect and record, never surface directly.
 */
function handleFileChanged(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const filePath = payload.file_path;
  if (typeof filePath !== "string" || !fs.existsSync(filePath)) {
    return {};
  }

  const existing = deps.envelopeStore.getBySourceUri(filePath);
  if (existing.length === 0) {
    return {};
  }

  const freshContent = fs.readFileSync(filePath, "utf-8");
  const freshHash = createHash("sha256").update(freshContent).digest("hex");
  const latest = existing[existing.length - 1];
  if (latest.content_hash === freshHash) {
    return {};
  }

  // Does this "new" content actually match some OTHER already-known source verbatim? That's
  // a competing-source-appeared signal (layer 3f), not a simple edit (layer 2).
  const allEnvelopes = deps.envelopeStore.listAll();
  const duplicateElsewhere = allEnvelopes.find(
    (e) => e.source_uri !== filePath && e.content_hash === freshHash
  );

  const overrides = deps.thresholdStore.overridesSnapshot();
  const routed = duplicateElsewhere
    ? routeDrift({ type: "competing-source-appeared", confidence: 0.85 }, overrides)
    : routeDrift({ type: "content-edited", confidence: 0.9 }, overrides);

  if (routed.triggered) {
    deps.driftStore.record(filePath, duplicateElsewhere ? "competing-source-appeared" : "content-edited", routed.re_entry_layer, routed.cascade);
  }

  return {};
}

/**
 * Real ConfigChange shape: common fields + `matcher` describing which config source
 * changed (user_settings/project_settings/local_settings/policy_settings/skills).
 * ConfigChange supports **only** top-level `decision:"block"` — no additionalContext — so,
 * like FileChanged, this can only record the drift (hop 1); PreToolUse surfaces it (hop 2).
 * Never blocks a config change outright here: that would be far more disruptive than the
 * layer-3 re-check it's actually for.
 */
function handleConfigChange(deps: HookRouteDeps): HookResponse {
  const routed = routeDrift({ type: "policy-changed", confidence: 0.9 }, deps.thresholdStore.overridesSnapshot());
  if (routed.triggered) {
    deps.driftStore.record("*", "policy-changed", routed.re_entry_layer, routed.cascade);
  }
  return {};
}

/**
 * Real UserPromptSubmit shape: common fields + `user_message`. Unlike FileChanged/
 * ConfigChange, this hook supports additionalContext directly — a single-hop detector.
 * Compares the new prompt's rewritten query tokens against the most recently ranked
 * query; low overlap suggests the conversation's intent shifted (layer 1 — cheapest
 * re-entry, matches the layers doc's own framing of this as the lightest drift case).
 */
function handleUserPromptSubmit(payload: Record<string, unknown>, deps: HookRouteDeps): HookResponse {
  const userMessage = payload.user_message;
  if (typeof userMessage !== "string") {
    return {};
  }

  const recentRanking = deps.rankingLog.tail(1)[0];
  if (!recentRanking) {
    return {};
  }

  const newTokens = new Set(rewriteQuery(userMessage));
  const oldTokens = new Set(rewriteQuery(recentRanking.query));
  if (oldTokens.size === 0) {
    return {};
  }
  const overlap = [...newTokens].filter((t) => oldTokens.has(t)).length;
  const overlapRatio = overlap / oldTokens.size;
  if (overlapRatio >= 0.2) {
    return {};
  }

  const routed = routeDrift(
    { type: "query-intent-shifted", confidence: 1 - overlapRatio },
    deps.thresholdStore.overridesSnapshot()
  );
  if (!routed.triggered) {
    return {};
  }

  deps.driftStore.record("*session*", "query-intent-shifted", routed.re_entry_layer, routed.cascade);

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `Fathom detected this prompt may have shifted intent from the last ranked query ` +
        `("${recentRanking.query}"). Prior rankings may no longer reflect what's relevant.`
    }
  };
}

/**
 * Phase 0 behavior: every hook event is logged raw and gets back the minimal no-op shape.
 * Phase 1 adds PostToolUse ranking; Phase 2 adds PostToolUse fit() and PreCompact/
 * PostCompact; Phase 3 adds PreToolUse/PostToolUseFailure/PermissionDenied layer-3 gating;
 * Phase 5 adds explicit drift detectors (FileChanged, ConfigChange, PostToolUseFailure's
 * not-found case, UserPromptSubmit) and the two-hop re-entry mechanism via PreToolUse.
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

  if (eventName === "FileChanged") {
    return handleFileChanged(payload, deps);
  }

  if (eventName === "ConfigChange") {
    return handleConfigChange(deps);
  }

  if (eventName === "UserPromptSubmit") {
    return handleUserPromptSubmit(payload, deps);
  }

  return {};
}
