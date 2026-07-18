import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface FathomEndpoint {
  projectRoot: string;
  projectHash: string;
  pipeName: string;
  tcpPort: number;
  stateDir: string;
  dbPath: string;
  endpointFilePath: string;
}

export interface EndpointFileContents {
  transport: "pipe" | "tcp";
  address: string;
  pid: number;
  projectHash: string;
}

/** Deterministic hash of a resolved project root, used to key the pipe name and state dir. */
export function projectHashFor(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function resolveEndpoint(projectRoot: string): FathomEndpoint {
  const resolved = path.resolve(projectRoot);
  const hash = projectHashFor(resolved);
  const stateDir = path.join(resolved, ".fathom", "state");
  const portOffset = parseInt(hash.slice(0, 4), 16) % 10000;
  return {
    projectRoot: resolved,
    projectHash: hash,
    pipeName: `\\\\.\\pipe\\fathomd-${hash}`,
    tcpPort: 49152 + portOffset,
    stateDir,
    dbPath: path.join(stateDir, "envelopes.db"),
    endpointFilePath: path.join(stateDir, "endpoint.json")
  };
}

export function writeEndpointFile(
  endpoint: FathomEndpoint,
  info: Omit<EndpointFileContents, "projectHash">
): void {
  fs.mkdirSync(endpoint.stateDir, { recursive: true });
  const contents: EndpointFileContents = { ...info, projectHash: endpoint.projectHash };
  fs.writeFileSync(endpoint.endpointFilePath, JSON.stringify(contents, null, 2));
}

export function readEndpointFile(endpoint: FathomEndpoint): EndpointFileContents | null {
  try {
    const raw = fs.readFileSync(endpoint.endpointFilePath, "utf-8");
    return JSON.parse(raw) as EndpointFileContents;
  } catch {
    return null;
  }
}
