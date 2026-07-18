import http, { type RequestListener } from "node:http";
import type { FathomEndpoint } from "./endpoint.js";
import { writeEndpointFile } from "./endpoint.js";

export interface FathomServerHandle {
  server: http.Server;
  transport: "pipe" | "tcp";
  address: string;
  close(): Promise<void>;
}

function listenOnce(server: http.Server, arg: string | number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      server.removeListener("listening", onListening);
      resolve(false);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    if (host) {
      server.listen(arg as number, host);
    } else {
      server.listen(arg);
    }
  });
}

/**
 * Binds to the Windows named pipe first; falls back to TCP on localhost if the
 * pipe bind fails (e.g. non-Windows dev, or a stale pipe held by a dead process).
 * Both paths were verified working directly in this environment before this
 * code was written (see docs/fathom-architecture.md's transport decision).
 */
export async function startServer(
  endpoint: FathomEndpoint,
  requestListener: RequestListener
): Promise<FathomServerHandle> {
  if (process.platform === "win32") {
    const pipeServer = http.createServer(requestListener);
    const pipeOk = await listenOnce(pipeServer, endpoint.pipeName);
    if (pipeOk) {
      writeEndpointFile(endpoint, { transport: "pipe", address: endpoint.pipeName, pid: process.pid });
      return {
        server: pipeServer,
        transport: "pipe",
        address: endpoint.pipeName,
        close: () => new Promise((resolve) => pipeServer.close(() => resolve()))
      };
    }
    pipeServer.removeAllListeners();
  }

  const tcpServer = http.createServer(requestListener);
  const tcpOk = await listenOnce(tcpServer, endpoint.tcpPort, "127.0.0.1");
  if (!tcpOk) {
    throw new Error(`fathomd failed to bind both named pipe and TCP port ${endpoint.tcpPort}`);
  }
  const address = `127.0.0.1:${endpoint.tcpPort}`;
  writeEndpointFile(endpoint, { transport: "tcp", address, pid: process.pid });
  return {
    server: tcpServer,
    transport: "tcp",
    address,
    close: () => new Promise((resolve) => tcpServer.close(() => resolve()))
  };
}
