import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { resolveEndpoint, type FathomEndpoint } from "../../src/endpoint.js";
import { openDb } from "../../src/store/db.js";
import { RawEventLog } from "../../src/store/rawEventLog.js";
import { EnvelopeStore } from "../../src/store/envelopeStore.js";
import { RankingLog } from "../../src/store/rankingLog.js";
import { CompactionLog } from "../../src/store/compactionLog.js";
import { AccessStatusStore } from "../../src/store/accessStatusStore.js";
import { RegistryStore } from "../../src/store/registryStore.js";
import { AccessGrantStore } from "../../src/store/accessGrantStore.js";
import { RecurrenceStore } from "../../src/store/recurrenceStore.js";
import { createRequestListener } from "../../src/requestListener.js";
import { startServer, type FathomServerHandle } from "../../src/server.js";

export interface TestServer {
  endpoint: FathomEndpoint;
  handle: FathomServerHandle;
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
  compactionLog: CompactionLog;
  accessStatusStore: AccessStatusStore;
  registryStore: RegistryStore;
  accessGrantStore: AccessGrantStore;
  recurrenceStore: RecurrenceStore;
  request(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  cleanup(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fathomd-test-"));
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

  function request(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions =
        handle.transport === "pipe"
          ? { socketPath: handle.address, path: urlPath, method }
          : { host: "127.0.0.1", port: endpoint.tcpPort, path: urlPath, method };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
        });
      });
      req.on("error", reject);
      if (payload) req.setHeader("Content-Type", "application/json");
      req.end(payload);
    });
  }

  async function cleanup(): Promise<void> {
    await handle.close();
    db.close();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }

  return {
    endpoint,
    handle,
    rawEventLog,
    envelopeStore,
    rankingLog,
    compactionLog,
    accessStatusStore,
    registryStore,
    accessGrantStore,
    recurrenceStore,
    request,
    cleanup
  };
}
