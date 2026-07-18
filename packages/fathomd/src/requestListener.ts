import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./httpUtil.js";
import { handleHealth } from "./routes/health.js";
import { handleHook } from "./routes/hook.js";
import { handleGetContext, handlePutContext, handleDeleteContext } from "./routes/context.js";
import { handleGetRegistryEntry, handlePutRegistryEntry } from "./routes/registry.js";
import { handleCheckAccessGrant, handleApproveAccessGrant } from "./routes/accessGrant.js";
import { handleReportGap } from "./routes/gap.js";
import { handleElicit } from "./routes/elicitRoute.js";
import type { RawEventLog } from "./store/rawEventLog.js";
import type { EnvelopeStore } from "./store/envelopeStore.js";
import type { RankingLog } from "./store/rankingLog.js";
import type { CompactionLog } from "./store/compactionLog.js";
import type { AccessStatusStore } from "./store/accessStatusStore.js";
import type { RegistryStore } from "./store/registryStore.js";
import type { AccessGrantStore } from "./store/accessGrantStore.js";
import type { RecurrenceStore } from "./store/recurrenceStore.js";

export interface RequestListenerDeps {
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
  compactionLog: CompactionLog;
  accessStatusStore: AccessStatusStore;
  registryStore: RegistryStore;
  accessGrantStore: AccessGrantStore;
  recurrenceStore: RecurrenceStore;
}

export function createRequestListener(deps: RequestListenerDeps): RequestListener {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://fathomd.local");
      const segments = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && segments.length === 1 && segments[0] === "health") {
        sendJson(res, 200, handleHealth());
        return;
      }

      if (method === "POST" && segments[0] === "hook" && segments.length === 2) {
        const eventName = decodeURIComponent(segments[1]);
        const payload = await readJsonBody(req);
        const result = handleHook(eventName, payload, {
          rawEventLog: deps.rawEventLog,
          envelopeStore: deps.envelopeStore,
          rankingLog: deps.rankingLog,
          compactionLog: deps.compactionLog,
          accessStatusStore: deps.accessStatusStore
        });
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments[0] === "context" && segments.length === 2) {
        const sourceUri = decodeURIComponent(segments[1]);
        const envelopes = handleGetContext(sourceUri, { envelopeStore: deps.envelopeStore });
        if (envelopes.length === 0) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, envelopes.length === 1 ? envelopes[0] : envelopes);
        return;
      }

      if (method === "PUT" && segments.length === 1 && segments[0] === "context") {
        const body = await readJsonBody(req);
        const result = handlePutContext(body, { envelopeStore: deps.envelopeStore });
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (method === "DELETE" && segments[0] === "context" && segments.length === 2) {
        const envelopeId = decodeURIComponent(segments[1]);
        const result = handleDeleteContext(envelopeId, { envelopeStore: deps.envelopeStore });
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET" && segments[0] === "registry" && segments.length === 2) {
        const dataType = decodeURIComponent(segments[1]);
        const entry = handleGetRegistryEntry(dataType, { registryStore: deps.registryStore });
        if (!entry) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, entry);
        return;
      }

      if (method === "PUT" && segments[0] === "registry" && segments.length === 2) {
        const dataType = decodeURIComponent(segments[1]);
        const body = await readJsonBody(req);
        const result = handlePutRegistryEntry(dataType, body, { registryStore: deps.registryStore });
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (method === "POST" && segments.length === 2 && segments[0] === "access" && segments[1] === "check") {
        const body = (await readJsonBody(req)) as { source_uri?: string; scope?: string };
        const result = handleCheckAccessGrant(body.source_uri ?? "", body.scope ?? "", {
          accessGrantStore: deps.accessGrantStore
        });
        sendJson(res, 200, result);
        return;
      }

      if (method === "PUT" && segments.length === 2 && segments[0] === "access" && segments[1] === "grant") {
        const body = (await readJsonBody(req)) as { source_uri?: string; scope?: string; approved_by?: string };
        const result = handleApproveAccessGrant(
          body.source_uri ?? "",
          body.scope ?? "",
          body.approved_by ?? "unknown",
          { accessGrantStore: deps.accessGrantStore }
        );
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" && segments.length === 2 && segments[0] === "gap" && segments[1] === "report") {
        const body = (await readJsonBody(req)) as {
          description?: string;
          task_context?: string;
          checklist_ref?: string;
        };
        const result = handleReportGap(
          {
            description: body.description ?? "",
            task_context: body.task_context ?? "",
            checklist_ref: body.checklist_ref
          },
          { envelopeStore: deps.envelopeStore, recurrenceStore: deps.recurrenceStore }
        );
        sendJson(res, 200, result);
        return;
      }

      if (method === "POST" && segments.length === 1 && segments[0] === "elicit") {
        const body = (await readJsonBody(req)) as { question?: string; human_answer?: string };
        const result = handleElicit(
          { question: body.question ?? "", human_answer: body.human_answer },
          { envelopeStore: deps.envelopeStore }
        );
        sendJson(res, result.ok ? 200 : 422, result);
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  };
}
