import type { DatabaseSync } from "node:sqlite";

const DOCUMENTATION_PRIORITY_THRESHOLD = 3;

/**
 * Tracks how often the same topic surfaces a layer-5/6 gap. Repeated hits on the same
 * topic are themselves a signal per docs/fathom-context-engineering-layers.md: "repeated
 * gaps signal a documentation priority."
 */
export class RecurrenceStore {
  constructor(private readonly db: DatabaseSync) {}

  recordGap(topic: string): number {
    const stmt = this.db.prepare("INSERT INTO gap_events (topic, created_at) VALUES (?, ?)");
    stmt.run(topic, new Date().toISOString());
    return this.count(topic);
  }

  count(topic: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM gap_events WHERE topic = ?").get(topic) as {
      c: number;
    };
    return row.c;
  }

  isDocumentationPriority(topic: string): boolean {
    return this.count(topic) >= DOCUMENTATION_PRIORITY_THRESHOLD;
  }

  /** Every topic that has crossed the documentation-priority threshold, for session reporting. */
  documentationPriorityTopics(): string[] {
    const rows = this.db
      .prepare("SELECT topic FROM gap_events GROUP BY topic HAVING COUNT(*) >= ?")
      .all(DOCUMENTATION_PRIORITY_THRESHOLD) as unknown as { topic: string }[];
    return rows.map((r) => r.topic);
  }
}
