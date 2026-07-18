import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveEndpoint,
  openDb,
  RawEventLog,
  EnvelopeStore,
  createRequestListener,
  startServer,
  type FathomEndpoint,
  type FathomServerHandle
} from "@fathom/fathomd";

export interface TestDaemon {
  endpoint: FathomEndpoint;
  handle: FathomServerHandle;
  rawEventLog: RawEventLog;
  cleanup(): Promise<void>;
}

/**
 * Starts a real fathomd-shaped server (same code the daemon's own CLI runs) bound to a
 * throwaway project root, so a compiled hook shim spawned with FATHOM_PROJECT_ROOT set to
 * that root finds it already healthy via the endpoint file and never needs to spawn its own.
 */
export async function startTestDaemon(): Promise<TestDaemon> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fathom-hooks-test-"));
  const endpoint = resolveEndpoint(projectRoot);
  const db = openDb(endpoint.dbPath);
  const rawEventLog = new RawEventLog(db);
  const envelopeStore = new EnvelopeStore(db);
  const listener = createRequestListener({ rawEventLog, envelopeStore });
  const handle = await startServer(endpoint, listener);

  async function cleanup(): Promise<void> {
    await handle.close();
    db.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }

  return { endpoint, handle, rawEventLog, cleanup };
}
