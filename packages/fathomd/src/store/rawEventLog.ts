import type { DatabaseSync } from "node:sqlite";

export interface RawEventRow {
  id: number;
  event_name: string;
  payload_json: string;
  created_at: string;
}

export class RawEventLog {
  constructor(private readonly db: DatabaseSync) {}

  append(eventName: string, payload: unknown): number {
    const stmt = this.db.prepare(
      "INSERT INTO raw_events (event_name, payload_json, created_at) VALUES (?, ?, ?)"
    );
    const result = stmt.run(eventName, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM raw_events").get() as { c: number };
    return row.c;
  }

  tail(limit = 20): RawEventRow[] {
    return this.db
      .prepare("SELECT * FROM raw_events ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as RawEventRow[];
  }

  latest(): RawEventRow | undefined {
    return this.tail(1)[0];
  }
}
