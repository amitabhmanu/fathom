import type { DatabaseSync } from "node:sqlite";

/**
 * Records human-approved access grants. This store is only ever written by a human/admin
 * path (see routes/accessGrant.ts's PUT /access/grant) — the read path used by
 * fathom_request_access can only check it, never write to it, which is the mechanical
 * enforcement of "never auto-grants."
 */
export class AccessGrantStore {
  constructor(private readonly db: DatabaseSync) {}

  isApproved(sourceUri: string, scope: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM access_grants WHERE source_uri = ? AND scope = ?")
      .get(sourceUri, scope);
    return row !== undefined;
  }

  approve(sourceUri: string, scope: string, approvedBy: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO access_grants (source_uri, scope, approved_by, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(source_uri, scope) DO UPDATE SET approved_by = excluded.approved_by, created_at = excluded.created_at`
    );
    stmt.run(sourceUri, scope, approvedBy, new Date().toISOString());
  }
}
