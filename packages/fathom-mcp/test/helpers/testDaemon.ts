import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveEndpoint,
  openDb,
  RawEventLog,
  EnvelopeStore,
  RankingLog,
  CompactionLog,
  AccessStatusStore,
  RegistryStore,
  AccessGrantStore,
  RecurrenceStore,
  createRequestListener,
  startServer,
  type FathomEndpoint,
  type FathomServerHandle
} from "@fathom/fathomd";

export interface RunningTestDaemon {
  endpoint: FathomEndpoint;
  handle: FathomServerHandle;
  envelopeStore: EnvelopeStore;
  registryStore: RegistryStore;
  accessGrantStore: AccessGrantStore;
  recurrenceStore: RecurrenceStore;
  cleanup(): Promise<void>;
}

/** Spins up a real fathomd-shaped server (same code fathomd's own CLI uses) for MCP tool tests. */
export async function startRunningTestDaemon(): Promise<RunningTestDaemon> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fathom-mcp-test-"));
  const endpoint = resolveEndpoint(projectRoot);
  const db = openDb(endpoint.dbPath);
  const rawEventLog = new RawEventLog(db);
  const envelopeStore = new EnvelopeStore(db);
  const rankingLog = new RankingLog(db);
  const compactionLog = new CompactionLog(db);
  const accessStatusStore = new AccessStatusStore(db);
  const registryStore = new RegistryStore(projectRoot);
  const accessGrantStore = new AccessGrantStore(db);
  const recurrenceStore = new RecurrenceStore(db);
  const listener = createRequestListener({
    rawEventLog,
    envelopeStore,
    rankingLog,
    compactionLog,
    accessStatusStore,
    registryStore,
    accessGrantStore,
    recurrenceStore
  });
  const handle = await startServer(endpoint, listener);

  async function cleanup(): Promise<void> {
    await handle.close();
    db.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }

  return { endpoint, handle, envelopeStore, registryStore, accessGrantStore, recurrenceStore, cleanup };
}
