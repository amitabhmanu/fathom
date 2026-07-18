#!/usr/bin/env node
import { resolveEndpoint, readEndpointFile } from "./endpoint.js";
import { openDb } from "./store/db.js";
import { RawEventLog } from "./store/rawEventLog.js";
import { EnvelopeStore } from "./store/envelopeStore.js";
import { RankingLog } from "./store/rankingLog.js";
import { CompactionLog } from "./store/compactionLog.js";
import { AccessStatusStore } from "./store/accessStatusStore.js";
import { RegistryStore } from "./store/registryStore.js";
import { AccessGrantStore } from "./store/accessGrantStore.js";
import { RecurrenceStore } from "./store/recurrenceStore.js";
import { DriftStore } from "./store/driftStore.js";
import { ElicitedQuestionIndex } from "./store/elicitedQuestionIndex.js";
import { RegistryPromotionStore } from "./store/registryPromotionStore.js";
import { ThresholdStore } from "./store/thresholdStore.js";
import { createRequestListener } from "./requestListener.js";
import { buildSessionReport } from "./routes/sessionReport.js";
import { startServer } from "./server.js";

function projectRootFromEnv(): string {
  return process.env.FATHOM_PROJECT_ROOT ?? process.cwd();
}

async function cmdStart(): Promise<void> {
  const projectRoot = projectRootFromEnv();
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
  const driftStore = new DriftStore(db);
  const elicitedQuestionIndex = new ElicitedQuestionIndex(db);
  const registryPromotionStore = new RegistryPromotionStore(db);
  const thresholdStore = new ThresholdStore(db);
  const listener = createRequestListener({
    rawEventLog,
    envelopeStore,
    rankingLog,
    compactionLog,
    accessStatusStore,
    registryStore,
    accessGrantStore,
    recurrenceStore,
    driftStore,
    elicitedQuestionIndex,
    registryPromotionStore,
    thresholdStore
  });
  const handle = await startServer(endpoint, listener);
  process.stdout.write(`fathomd listening on ${handle.transport} ${handle.address} (pid ${process.pid})\n`);
}

function cmdStop(): void {
  const endpoint = resolveEndpoint(projectRootFromEnv());
  const info = readEndpointFile(endpoint);
  if (!info) {
    process.stdout.write("fathomd is not running (no endpoint file found)\n");
    return;
  }
  try {
    process.kill(info.pid);
    process.stdout.write(`sent stop signal to fathomd pid ${info.pid}\n`);
  } catch (err) {
    process.stdout.write(`could not stop fathomd pid ${info.pid}: ${(err as Error).message}\n`);
  }
}

function cmdInspect(sourceUri: string): void {
  const endpoint = resolveEndpoint(projectRootFromEnv());
  const db = openDb(endpoint.dbPath);
  const envelopeStore = new EnvelopeStore(db);
  const rankingLog = new RankingLog(db);
  const envelopes = envelopeStore.getBySourceUri(sourceUri);
  const rankingHistory = rankingLog.forSourceUri(sourceUri);
  process.stdout.write(`${JSON.stringify({ envelopes, rankingHistory }, null, 2)}\n`);
}

function cmdLogTail(limit: number): void {
  const endpoint = resolveEndpoint(projectRootFromEnv());
  const db = openDb(endpoint.dbPath);
  const rawEventLog = new RawEventLog(db);
  const rows = rawEventLog.tail(limit).reverse();
  for (const row of rows) {
    process.stdout.write(`[${row.created_at}] ${row.event_name} ${row.payload_json}\n`);
  }
}

function cmdReport(): void {
  const projectRoot = projectRootFromEnv();
  const endpoint = resolveEndpoint(projectRoot);
  const db = openDb(endpoint.dbPath);
  const report = buildSessionReport({
    rankingLog: new RankingLog(db),
    compactionLog: new CompactionLog(db),
    driftStore: new DriftStore(db),
    accessStatusStore: new AccessStatusStore(db),
    recurrenceStore: new RecurrenceStore(db),
    registryPromotionStore: new RegistryPromotionStore(db)
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "start":
      await cmdStart();
      break;
    case "stop":
      cmdStop();
      break;
    case "inspect":
      if (!rest[0]) throw new Error("usage: fathomd inspect <source_uri>");
      cmdInspect(rest[0]);
      break;
    case "log":
      if (rest[0] === "tail") {
        cmdLogTail(rest[1] ? parseInt(rest[1], 10) : 20);
      } else {
        throw new Error("usage: fathomd log tail [limit]");
      }
      break;
    case "report":
      cmdReport();
      break;
    default:
      process.stderr.write("usage: fathomd start|stop|inspect <source_uri>|log tail [limit]|report\n");
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
});
