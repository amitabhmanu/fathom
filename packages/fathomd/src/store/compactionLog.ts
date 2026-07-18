import type { DatabaseSync } from "node:sqlite";

export interface CompactionEventRow {
  id: number;
  phase: "pre" | "post";
  envelope_ids_json: string;
  created_at: string;
}

/**
 * Bridges PreCompact and PostCompact: PreCompact records which stored summary envelopes
 * it surfaced via additionalContext; PostCompact (side-effect-only, per real Claude Code
 * hook capability) reads that back to log which summary actually carried a session across
 * a compaction event. This is the feedback-store logging described for PostCompact in
 * docs/fathom-architecture.md's hook table.
 */
export class CompactionLog {
  constructor(private readonly db: DatabaseSync) {}

  recordPreCompact(envelopeIds: string[]): number {
    return this.append("pre", envelopeIds);
  }

  recordPostCompact(envelopeIds: string[]): number {
    return this.append("post", envelopeIds);
  }

  private append(phase: "pre" | "post", envelopeIds: string[]): number {
    const stmt = this.db.prepare(
      "INSERT INTO compaction_events (phase, envelope_ids_json, created_at) VALUES (?, ?, ?)"
    );
    const result = stmt.run(phase, JSON.stringify(envelopeIds), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  /** The envelope_ids most recently surfaced by a PreCompact handler, if any. */
  lastPreCompactEnvelopeIds(): string[] {
    const row = this.db
      .prepare("SELECT envelope_ids_json FROM compaction_events WHERE phase = 'pre' ORDER BY id DESC LIMIT 1")
      .get() as { envelope_ids_json: string } | undefined;
    return row ? JSON.parse(row.envelope_ids_json) : [];
  }

  tail(limit = 20): CompactionEventRow[] {
    return this.db
      .prepare("SELECT * FROM compaction_events ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as CompactionEventRow[];
  }
}
