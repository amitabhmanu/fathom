import type { DatabaseSync } from "node:sqlite";

export type AccessStatusKind = "credentials" | "format" | "policy";

export interface AccessStatusRow {
  source_uri: string;
  status: AccessStatusKind;
  reason: string;
  created_at: string;
}

/**
 * Tracks sources known (from a real PostToolUseFailure/PermissionDenied) to be layer-3
 * inaccessible, so PreToolUse can gate proactively on a repeat attempt instead of letting
 * the same failure happen twice.
 */
export class AccessStatusStore {
  constructor(private readonly db: DatabaseSync) {}

  markInaccessible(sourceUri: string, status: AccessStatusKind, reason: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO access_status (source_uri, status, reason, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(source_uri) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         created_at = excluded.created_at`
    );
    stmt.run(sourceUri, status, reason, new Date().toISOString());
  }

  get(sourceUri: string): AccessStatusRow | null {
    const row = this.db.prepare("SELECT * FROM access_status WHERE source_uri = ?").get(sourceUri) as
      | AccessStatusRow
      | undefined;
    return row ?? null;
  }

  clear(sourceUri: string): void {
    this.db.prepare("DELETE FROM access_status WHERE source_uri = ?").run(sourceUri);
  }

  listAll(): AccessStatusRow[] {
    return this.db.prepare("SELECT * FROM access_status ORDER BY created_at DESC").all() as unknown as AccessStatusRow[];
  }
}
