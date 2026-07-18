import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./httpUtil.js";
import { handleHealth } from "./routes/health.js";
import { handleHook } from "./routes/hook.js";
import { handleGetContext, handlePutContext, handleDeleteContext } from "./routes/context.js";
import type { RawEventLog } from "./store/rawEventLog.js";
import type { EnvelopeStore } from "./store/envelopeStore.js";
import type { RankingLog } from "./store/rankingLog.js";

export interface RequestListenerDeps {
  rawEventLog: RawEventLog;
  envelopeStore: EnvelopeStore;
  rankingLog: RankingLog;
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
          rankingLog: deps.rankingLog
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

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  };
}
