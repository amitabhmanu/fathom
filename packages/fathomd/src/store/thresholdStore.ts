import type { DatabaseSync } from "node:sqlite";
import { defaultThresholdFor, type ReEntryLayer } from "@fathom/layer-functions";

/**
 * Persists per-layer confidence-threshold overrides so a tuning adjustment (Phase 6's
 * adjustThreshold(), applied via POST /drift/outcome) survives a daemon restart instead of
 * silently resetting to the router's hardcoded defaults every time the process cycles.
 */
export class ThresholdStore {
  constructor(private readonly db: DatabaseSync) {}

  get(layer: ReEntryLayer): number {
    const row = this.db.prepare("SELECT threshold FROM layer_thresholds WHERE layer = ?").get(layer) as
      | { threshold: number }
      | undefined;
    return row?.threshold ?? defaultThresholdFor(layer);
  }

  set(layer: ReEntryLayer, threshold: number): void {
    const stmt = this.db.prepare(
      `INSERT INTO layer_thresholds (layer, threshold, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(layer) DO UPDATE SET threshold = excluded.threshold, updated_at = excluded.updated_at`
    );
    stmt.run(layer, threshold, new Date().toISOString());
  }

  /** Only layers with a stored override — routeDrift() falls back to its own defaults for the rest. */
  overridesSnapshot(): Partial<Record<ReEntryLayer, number>> {
    const rows = this.db.prepare("SELECT layer, threshold FROM layer_thresholds").all() as unknown as {
      layer: ReEntryLayer;
      threshold: number;
    }[];
    const snapshot: Partial<Record<ReEntryLayer, number>> = {};
    for (const row of rows) {
      snapshot[row.layer] = row.threshold;
    }
    return snapshot;
  }
}
