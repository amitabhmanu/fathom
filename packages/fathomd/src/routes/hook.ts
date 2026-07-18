import { rank } from "@fathom/layer-functions";
import type { RawEventLog } from "../store/rawEventLog.js";
import type { EnvelopeStore } from "../store/envelopeStore.js";
import type { RankingLog } from "../store/rankingLog.js";
import { isRankableToolUse, extractRankInput } from "./postToolUseRanking.js";

export interface HookRouteDeps {
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
}

interface PostToolUsePayloadShape {
  tool_name?: unknown;
  tool_input?: unknown;
  tool_output?: unknown;
}

function isPostToolUsePayload(payload: unknown): payload is PostToolUsePayloadShape {
  return typeof payload === "object" && payload !== null;
}

/**
 * Phase 0 behavior: every hook event is logged raw and gets back the minimal
 * no-op shape.
 *
 * Phase 1 adds: a PostToolUse for Read/Grep/Glob is additionally run through
 * layer-functions' rank(), storing the resulting envelopes and a ranking log
 * entry. The response shape is still the Phase 0 no-op — nothing is injected
 * back into Claude Code's context yet; that starts with Phase 2's fit().
 */
export function handleHook(eventName: string, payload: unknown, deps: HookRouteDeps): Record<string, never> {
  deps.rawEventLog.append(eventName, payload);

  if (eventName === "PostToolUse" && isPostToolUsePayload(payload)) {
    const { tool_name: toolName, tool_input: toolInput, tool_output: toolOutput } = payload;
    if (isRankableToolUse(toolName) && typeof toolOutput === "string") {
      const { query, candidates } = extractRankInput(
        toolName,
        (toolInput ?? {}) as Record<string, unknown>,
        toolOutput
      );
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
  }

  return {};
}
