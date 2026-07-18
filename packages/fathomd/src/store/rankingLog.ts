import type { DatabaseSync } from "node:sqlite";

export interface RankingLogResult {
  source_uri: string;
  score: number;
  rank: number;
}

export interface RankingEventRow {
  id: number;
  query: string;
  cutoff_applied: number;
  results_json: string;
  created_at: string;
}

/**
 * Records every rank() invocation's query, cutoff, and surviving results — the layer-1
 * "ranking log store" from docs/fathom-context-engineering-layers.md, queryable via
 * `fathomd inspect`. Distinct from EnvelopeStore, which only holds the current envelope
 * per source_uri: this is an append-only history of ranking decisions over time.
 */
export class RankingLog {
  constructor(private readonly db: DatabaseSync) {}

  append(query: string, cutoffApplied: number, results: RankingLogResult[]): number {
    const stmt = this.db.prepare(
      "INSERT INTO ranking_events (query, cutoff_applied, results_json, created_at) VALUES (?, ?, ?, ?)"
    );
    const result = stmt.run(query, cutoffApplied, JSON.stringify(results), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  tail(limit = 20): RankingEventRow[] {
    return this.db
      .prepare("SELECT * FROM ranking_events ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as RankingEventRow[];
  }

  /** Ranking events whose surviving results mention this source_uri, most recent first. */
  forSourceUri(sourceUri: string, limit = 20): RankingEventRow[] {
    const rows = this.db
      .prepare("SELECT * FROM ranking_events ORDER BY id DESC LIMIT 500")
      .all() as unknown as RankingEventRow[];
    const matches: RankingEventRow[] = [];
    for (const row of rows) {
      const results = JSON.parse(row.results_json) as RankingLogResult[];
      if (results.some((r) => r.source_uri === sourceUri)) {
        matches.push(row);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }
}
