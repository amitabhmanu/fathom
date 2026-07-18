import { randomUUID, createHash } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope, type RetrievalHook } from "@fathom/context-contract";
import { selectBudgetDecision } from "./summarizer/budgetSelector.js";
import { buildHierarchy } from "./summarizer/hierarchical.js";
import { buildSubagentTask } from "./delegate/subagentTask.js";

export interface FitInput {
  content: string;
  /** Added during Phase 2 implementation: fathom-api-spec.md's fit() input lacked this,
   *  but building a correct envelope/retrieval_hook requires knowing where the content
   *  came from. */
  source_uri: string;
  budget_tokens: number;
  /**
   * Accepted per fathom-api-spec.md for forward compatibility. Phase 2 always rebuilds
   * the hierarchy from `content` — reusing a previously-computed hierarchy would require
   * fit() to fetch stored envelope content, which pure layer functions deliberately don't
   * do (storage access is fathomd's job, per the sidecar architecture). Deferred to
   * whichever later phase actually needs cache-reuse, rather than built speculatively now.
   */
  existing_hierarchy?: RetrievalHook[];
}

export type FitResult =
  | { kind: "pass"; envelope: Envelope }
  | { kind: "summarize"; envelope: Envelope }
  | { kind: "delegate"; subagent_task: string; expected_return_shape: string };

const LAYER2_HALF_LIFE_SECONDS = 3600;

/**
 * Wraps content verbatim in a layer-2 envelope, unmodified. Used for the "pass" branch,
 * and exported so callers (e.g. fathomd) can store the original raw content under its own
 * source_uri when a "summarize" result's retrieval_hook needs something real to resolve to.
 */
export function wrapContentEnvelope(content: string, sourceUri: string): Envelope {
  const now = new Date().toISOString();
  return {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: randomUUID(),
    content,
    content_hash: createHash("sha256").update(content).digest("hex"),
    source_uri: sourceUri,
    origin_layer: "2",
    provenance: "system-authoritative",
    confidence: 1,
    timestamp: now,
    freshness_contract: { half_life_seconds: LAYER2_HALF_LIFE_SECONDS }
  };
}

/**
 * Layer 2 (doesn't fit the window): decides whether content passes through unchanged,
 * gets compressed into a hierarchical summary with a retrieval hook back to the full
 * source, or is too large/interlinked to summarize linearly and gets delegated instead.
 */
export function fit(input: FitInput): FitResult {
  const decision = selectBudgetDecision(input.content, input.budget_tokens);

  if (decision === "pass") {
    return { kind: "pass", envelope: wrapContentEnvelope(input.content, input.source_uri) };
  }

  if (decision === "delegate") {
    const { subagent_task, expected_return_shape } = buildSubagentTask(
      input.content,
      input.source_uri,
      input.budget_tokens
    );
    return { kind: "delegate", subagent_task, expected_return_shape };
  }

  const { doc } = buildHierarchy(input.content, input.source_uri);
  return { kind: "summarize", envelope: doc };
}
