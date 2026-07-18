import type { DatabaseSync } from "node:sqlite";

const PROMOTION_THRESHOLD = 3;

export interface PromotionEventRow {
  id: number;
  data_type: string;
  source_uri: string;
  promoted_at: string;
}

/**
 * Tracks how often a specific source_uri wins reconciliation for a data_type. Once a
 * source recurs past a threshold, it's a candidate for permanent promotion into the
 * registry — "a source that fragments constantly should get promoted permanently into the
 * source-of-truth registry rather than reconciled fresh every time" (feedback store
 * component, docs/fathom-architecture.md).
 */
export class RegistryPromotionStore {
  constructor(private readonly db: DatabaseSync) {}

  recordWin(dataType: string, sourceUri: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO reconciliation_wins (data_type, source_uri, win_count) VALUES (?, ?, 1)
       ON CONFLICT(data_type, source_uri) DO UPDATE SET win_count = win_count + 1`
    );
    stmt.run(dataType, sourceUri);
    return this.winCount(dataType, sourceUri);
  }

  winCount(dataType: string, sourceUri: string): number {
    const row = this.db
      .prepare("SELECT win_count FROM reconciliation_wins WHERE data_type = ? AND source_uri = ?")
      .get(dataType, sourceUri) as { win_count: number } | undefined;
    return row?.win_count ?? 0;
  }

  isPromotionCandidate(dataType: string, sourceUri: string): boolean {
    return this.winCount(dataType, sourceUri) >= PROMOTION_THRESHOLD;
  }

  alreadyPromoted(dataType: string, sourceUri: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM registry_promotions WHERE data_type = ? AND source_uri = ?")
      .get(dataType, sourceUri);
    return row !== undefined;
  }

  recordPromotion(dataType: string, sourceUri: string): void {
    const stmt = this.db.prepare(
      "INSERT INTO registry_promotions (data_type, source_uri, promoted_at) VALUES (?, ?, ?)"
    );
    stmt.run(dataType, sourceUri, new Date().toISOString());
  }

  promotionHistory(limit = 20): PromotionEventRow[] {
    return this.db
      .prepare("SELECT * FROM registry_promotions ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as PromotionEventRow[];
  }
}
