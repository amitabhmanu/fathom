import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface ElicitedQuestionRow {
  question_hash: string;
  source_uri: string;
  content: string;
  updated_at: string;
}

function hashQuestion(question: string): string {
  return createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
}

/**
 * Indexes elicited answers by their question text, so a later fathom_elicit call for the
 * *same* question with a *different* answer can be recognized as "the real-world fact
 * itself changed" drift (layer 5 re-entry — the old artifact is void), per the layers
 * doc's drift-signature table.
 */
export class ElicitedQuestionIndex {
  constructor(private readonly db: DatabaseSync) {}

  get(question: string): ElicitedQuestionRow | null {
    const row = this.db
      .prepare("SELECT * FROM elicited_questions WHERE question_hash = ?")
      .get(hashQuestion(question)) as ElicitedQuestionRow | undefined;
    return row ?? null;
  }

  set(question: string, sourceUri: string, content: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO elicited_questions (question_hash, source_uri, content, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(question_hash) DO UPDATE SET source_uri = excluded.source_uri, content = excluded.content, updated_at = excluded.updated_at`
    );
    stmt.run(hashQuestion(question), sourceUri, content, new Date().toISOString());
  }
}
