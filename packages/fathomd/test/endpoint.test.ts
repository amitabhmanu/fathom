import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEndpoint, writeEndpointFile, readEndpointFile } from "../src/endpoint.js";

describe("endpoint", () => {
  it("derives the same pipe name for the same project root across two calls", () => {
    const root = path.join(os.tmpdir(), "fathom-endpoint-test-a");
    const first = resolveEndpoint(root);
    const second = resolveEndpoint(root);
    expect(first.pipeName).toBe(second.pipeName);
    expect(first.projectHash).toBe(second.projectHash);
  });

  it("derives distinct pipe names for distinct project roots", () => {
    const a = resolveEndpoint(path.join(os.tmpdir(), "fathom-endpoint-test-a"));
    const b = resolveEndpoint(path.join(os.tmpdir(), "fathom-endpoint-test-b"));
    expect(a.pipeName).not.toBe(b.pipeName);
  });

  it("round-trips the endpoint discovery file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fathom-endpoint-test-"));
    try {
      const endpoint = resolveEndpoint(root);
      writeEndpointFile(endpoint, { transport: "tcp", address: "127.0.0.1:12345", pid: 999 });
      const read = readEndpointFile(endpoint);
      expect(read).toEqual({
        transport: "tcp",
        address: "127.0.0.1:12345",
        pid: 999,
        projectHash: endpoint.projectHash
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when no endpoint file exists yet", () => {
    const root = path.join(os.tmpdir(), "fathom-endpoint-test-never-created");
    const endpoint = resolveEndpoint(root);
    expect(readEndpointFile(endpoint)).toBeNull();
  });
});
