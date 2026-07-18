import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Routed through process.getBuiltinModule rather than a static `import ... from "node:sqlite"`:
// Vite/vite-node (which Vitest uses to transform test files) doesn't yet recognize "node:sqlite"
// as a Node builtin and tries to resolve it as a bare package named "sqlite", which fails. A
// runtime lookup sidesteps Vite's static import analysis entirely.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS raw_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_name TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS envelopes (
     envelope_id TEXT PRIMARY KEY,
     source_uri TEXT NOT NULL,
     envelope_json TEXT NOT NULL,
     supersedes TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_envelopes_source_uri ON envelopes(source_uri)`
];

export function openDb(dbPath: string): DatabaseSyncType {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  for (const statement of MIGRATIONS) {
    db.exec(statement);
  }
  return db;
}
