import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveEndpoint,
  openDb,
  RawEventLog,
  EnvelopeStore,
  RankingLog,
  createRequestListener,
  startServer,
  type FathomEndpoint,
  type FathomServerHandle
} from "@fathom/fathomd";

export interface RunningTestDaemon {
  endpoint: FathomEndpoint;
  handle: FathomServerHandle;
  rawEventLog: RawEventLog;
  cleanup(): Promise<void>;
}

/** Spins up a real fathomd-shaped server (same code fathomd's own CLI uses) for client tests. */
export async function startRunningTestDaemon(): Promise<RunningTestDaemon> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fathomd-client-test-"));
  const endpoint = resolveEndpoint(projectRoot);
  const db = openDb(endpoint.dbPath);
  const rawEventLog = new RawEventLog(db);
  const envelopeStore = new EnvelopeStore(db);
  const rankingLog = new RankingLog(db);
  const listener = createRequestListener({ rawEventLog, envelopeStore, rankingLog });
  const handle = await startServer(endpoint, listener);

  async function cleanup(): Promise<void> {
    await handle.close();
    db.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }

  return { endpoint, handle, rawEventLog, cleanup };
}
