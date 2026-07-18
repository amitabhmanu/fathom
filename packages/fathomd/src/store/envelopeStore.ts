import type { DatabaseSync } from "node:sqlite";
import { validateEnvelopeWrite, type Envelope, type WriteValidationResult } from "@fathom/context-contract";

export type PutResult = { ok: true; envelope: Envelope } | { ok: false; reason: string };

export class EnvelopeStore {
  constructor(private readonly db: DatabaseSync) {}

  getById(envelopeId: string): Envelope | null {
    const row = this.db
      .prepare("SELECT envelope_json FROM envelopes WHERE envelope_id = ?")
      .get(envelopeId) as { envelope_json: string } | undefined;
    return row ? (JSON.parse(row.envelope_json) as Envelope) : null;
  }

  getBySourceUri(sourceUri: string): Envelope[] {
    const rows = this.db
      .prepare("SELECT envelope_json FROM envelopes WHERE source_uri = ? ORDER BY created_at ASC")
      .all(sourceUri) as { envelope_json: string }[];
    return rows.map((r) => JSON.parse(r.envelope_json) as Envelope);
  }

  put(next: unknown): PutResult {
    const candidate = next as Partial<Envelope>;
    const prev = candidate.supersedes ? this.getById(candidate.supersedes) : null;

    const validation: WriteValidationResult = validateEnvelopeWrite(prev, next);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason };
    }

    const envelope = next as Envelope;
    const stmt = this.db.prepare(
      `INSERT INTO envelopes (envelope_id, source_uri, envelope_json, supersedes, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(envelope_id) DO UPDATE SET
         source_uri = excluded.source_uri,
         envelope_json = excluded.envelope_json,
         supersedes = excluded.supersedes`
    );
    stmt.run(
      envelope.envelope_id,
      envelope.source_uri,
      JSON.stringify(envelope),
      envelope.supersedes ?? null,
      new Date().toISOString()
    );
    return { ok: true, envelope };
  }

  delete(envelopeId: string): boolean {
    const result = this.db.prepare("DELETE FROM envelopes WHERE envelope_id = ?").run(envelopeId);
    return Number(result.changes) > 0;
  }

  /**
   * Every stored envelope. Used by PreCompact to find layer-2 doc-tier summaries in scope
   * for the session — a full-table scan is fine at this scale (single local project store);
   * revisit with dedicated indexed columns if it ever isn't.
   */
  listAll(): Envelope[] {
    const rows = this.db.prepare("SELECT envelope_json FROM envelopes").all() as { envelope_json: string }[];
    return rows.map((r) => JSON.parse(r.envelope_json) as Envelope);
  }
}
