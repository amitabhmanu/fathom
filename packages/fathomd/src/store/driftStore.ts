import type { DatabaseSync } from "node:sqlite";
import type { DriftSignalType, ReEntryLayer } from "@fathom/layer-functions";

export interface DriftEventRow {
  id: number;
  source_uri: string;
  signal_type: DriftSignalType;
  re_entry_layer: ReEntryLayer;
  cascade_json: string;
  resolved: number;
  created_at: string;
}

/**
 * Records detected drift events. The two-hop mechanism (see fathom-architecture.md's
 * FileChanged row) means a detector can record an *unresolved* event without being able to
 * act on it (FileChanged has no decision control) — a later decision-capable hook
 * (PreToolUse) finds it here, runs the cascade, and marks it resolved.
 */
export class DriftStore {
  constructor(private readonly db: DatabaseSync) {}

  record(sourceUri: string, signalType: DriftSignalType, reEntryLayer: ReEntryLayer, cascade: ReEntryLayer[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO drift_events (source_uri, signal_type, re_entry_layer, cascade_json, resolved, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    );
    const result = stmt.run(sourceUri, signalType, reEntryLayer, JSON.stringify(cascade), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  /** The most recent unresolved drift event for a source_uri, if any. */
  unresolvedFor(sourceUri: string): DriftEventRow | null {
    const row = this.db
      .prepare(
        "SELECT * FROM drift_events WHERE source_uri = ? AND resolved = 0 ORDER BY id DESC LIMIT 1"
      )
      .get(sourceUri) as DriftEventRow | undefined;
    return row ?? null;
  }

  resolve(id: number): void {
    this.db.prepare("UPDATE drift_events SET resolved = 1 WHERE id = ?").run(id);
  }

  tail(limit = 20): DriftEventRow[] {
    return this.db
      .prepare("SELECT * FROM drift_events ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as DriftEventRow[];
  }
}
