import type { RankingLog } from "../store/rankingLog.js";
import type { CompactionLog } from "../store/compactionLog.js";
import type { DriftStore } from "../store/driftStore.js";
import type { AccessStatusStore } from "../store/accessStatusStore.js";
import type { RecurrenceStore } from "../store/recurrenceStore.js";
import type { RegistryPromotionStore } from "../store/registryPromotionStore.js";

export interface SessionReportDeps {
  rankingLog: RankingLog;
  compactionLog: CompactionLog;
  driftStore: DriftStore;
  accessStatusStore: AccessStatusStore;
  recurrenceStore: RecurrenceStore;
  registryPromotionStore: RegistryPromotionStore;
}

export interface SessionReport {
  ranking: { event_count: number; recent_queries: string[] };
  compaction: { pre_count: number; post_count: number };
  drift: { event_count: number; unresolved_count: number; by_signal_type: Record<string, number> };
  access: { inaccessible_count: number; inaccessible_sources: { source_uri: string; status: string }[] };
  gaps: { documentation_priority_topics: string[] };
  registry_promotions: { count: number; recent: { data_type: string; source_uri: string; promoted_at: string }[] };
}

// Not a hard cap on all-time history — a generous recent-activity window, since there is no
// separate concept of "session" boundaries stored anywhere in this system yet.
const REPORT_WINDOW = 1000;

/**
 * Aggregates the feedback-store data every prior phase has been logging (ranking,
 * compaction, drift, access denials, gaps, registry promotions) into one snapshot. This is
 * the "session report" component from docs/fathom-architecture.md's feedback-store list —
 * the first thing in this codebase that reads across all of them at once.
 */
export function buildSessionReport(deps: SessionReportDeps): SessionReport {
  const rankingEvents = deps.rankingLog.tail(REPORT_WINDOW);
  const compactionEvents = deps.compactionLog.tail(REPORT_WINDOW);
  const driftEvents = deps.driftStore.tail(REPORT_WINDOW);
  const inaccessible = deps.accessStatusStore.listAll();
  const promotions = deps.registryPromotionStore.promotionHistory(REPORT_WINDOW);

  const bySignalType: Record<string, number> = {};
  for (const event of driftEvents) {
    bySignalType[event.signal_type] = (bySignalType[event.signal_type] ?? 0) + 1;
  }

  return {
    ranking: {
      event_count: rankingEvents.length,
      recent_queries: rankingEvents.slice(0, 10).map((e) => e.query)
    },
    compaction: {
      pre_count: compactionEvents.filter((e) => e.phase === "pre").length,
      post_count: compactionEvents.filter((e) => e.phase === "post").length
    },
    drift: {
      event_count: driftEvents.length,
      unresolved_count: driftEvents.filter((e) => e.resolved === 0).length,
      by_signal_type: bySignalType
    },
    access: {
      inaccessible_count: inaccessible.length,
      inaccessible_sources: inaccessible.map((row) => ({ source_uri: row.source_uri, status: row.status }))
    },
    gaps: {
      documentation_priority_topics: deps.recurrenceStore.documentationPriorityTopics()
    },
    registry_promotions: {
      count: promotions.length,
      recent: promotions
        .slice(0, 10)
        .map((p) => ({ data_type: p.data_type, source_uri: p.source_uri, promoted_at: p.promoted_at }))
    }
  };
}
