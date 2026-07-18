import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

describe("GET /health", () => {
  it("responds ok with a version, over whichever transport bound", async () => {
    server = await startTestServer();
    const res = await server.request("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: expect.any(String) });
  });

  it("binds the named pipe transport on Windows", async () => {
    server = await startTestServer();
    if (process.platform === "win32") {
      expect(server.handle.transport).toBe("pipe");
    }
  });
});
