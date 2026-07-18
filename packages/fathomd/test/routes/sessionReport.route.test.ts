import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

interface SessionReportBody {
  ranking: { event_count: number; recent_queries: string[] };
  compaction: { pre_count: number; post_count: number };
  drift: { event_count: number; unresolved_count: number; by_signal_type: Record<string, number> };
  access: { inaccessible_count: number; inaccessible_sources: { source_uri: string; status: string }[] };
  gaps: { documentation_priority_topics: string[] };
  registry_promotions: { count: number; recent: { data_type: string; source_uri: string }[] };
}

describe("GET /report/session (Phase 6 session reporting)", () => {
  it("aggregates ranking, compaction, drift, access, gap, and promotion activity into one snapshot", async () => {
    server = await startTestServer();

    server.rankingLog.append("resolveEndpoint pipe name", 0.08, [{ source_uri: "file:///a.ts", score: 0.9, rank: 0 }]);
    server.compactionLog.recordPreCompact(["env-1"]);
    server.compactionLog.recordPostCompact(["env-1"]);
    server.driftStore.record("file:///edited.md", "content-edited", "2", ["2", "1"]);
    server.accessStatusStore.markInaccessible("file:///secret.md", "credentials", "401 Unauthorized");

    for (let i = 0; i < 3; i++) {
      await server.request("POST", "/gap/report", { description: `gap ${i}`, task_context: "topic-x" });
    }

    const res = await server.request("GET", "/report/session");
    expect(res.status).toBe(200);
    const body = res.body as SessionReportBody;

    expect(body.ranking.event_count).toBe(1);
    expect(body.ranking.recent_queries).toContain("resolveEndpoint pipe name");
    expect(body.compaction.pre_count).toBe(1);
    expect(body.compaction.post_count).toBe(1);
    expect(body.drift.event_count).toBe(1);
    expect(body.drift.unresolved_count).toBe(1);
    expect(body.drift.by_signal_type["content-edited"]).toBe(1);
    expect(body.access.inaccessible_count).toBe(1);
    expect(body.access.inaccessible_sources[0]).toMatchObject({ source_uri: "file:///secret.md", status: "credentials" });
    expect(body.gaps.documentation_priority_topics).toContain("topic-x");
  });

  it("returns zeroed-out sections for a fresh daemon with no activity", async () => {
    server = await startTestServer();
    const res = await server.request("GET", "/report/session");
    const body = res.body as SessionReportBody;

    expect(body.ranking.event_count).toBe(0);
    expect(body.drift.event_count).toBe(0);
    expect(body.access.inaccessible_count).toBe(0);
    expect(body.registry_promotions.count).toBe(0);
    expect(body.gaps.documentation_priority_topics).toEqual([]);
  });
});
