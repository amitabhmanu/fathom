import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/testServer.js";

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.cleanup();
    server = undefined;
  }
});

describe("POST /reconcile (Phase 6 registry auto-promotion)", () => {
  it("promotes a recurring reconciliation winner into the registry after the win threshold, with an audit trail", async () => {
    server = await startTestServer();

    const candidates = (round: number) => [
      { source_uri: "file:///pricing/canonical.md", content: `v${round}`, last_modified: `2026-0${round}-02T00:00:00.000Z` },
      { source_uri: "file:///pricing/stale-copy.md", content: `old${round}`, last_modified: `2026-0${round}-01T00:00:00.000Z` }
    ];

    const first = await server.request("POST", "/reconcile", { data_type: "pricing", candidates: candidates(1) });
    const second = await server.request("POST", "/reconcile", { data_type: "pricing", candidates: candidates(2) });
    const third = await server.request("POST", "/reconcile", { data_type: "pricing", candidates: candidates(3) });

    expect((first.body as { promoted: boolean }).promoted).toBe(false);
    expect((second.body as { promoted: boolean }).promoted).toBe(false);
    expect((third.body as { promoted: boolean; chosen_source_uri: string }).promoted).toBe(true);
    expect((third.body as { chosen_source_uri: string }).chosen_source_uri).toBe("file:///pricing/canonical.md");

    const entry = server.registryStore.getEntry("pricing");
    const promotedRule = entry?.rules.find((r) => r.uri_prefix === "file:///pricing/canonical.md");
    expect(promotedRule?.auto_promoted).toBe(true);
    expect(promotedRule?.promoted_at).toBeTruthy();

    const history = server.registryPromotionStore.promotionHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ data_type: "pricing", source_uri: "file:///pricing/canonical.md" });
  });

  it("does not promote (and keeps no audit entry) when reconciliation requires a human tiebreak", async () => {
    server = await startTestServer();
    const ambiguousCandidates = [
      { source_uri: "file:///ambiguous/a.md", content: "a" },
      { source_uri: "file:///ambiguous/b.md", content: "b" }
    ];

    for (let i = 0; i < 3; i++) {
      const res = await server.request("POST", "/reconcile", { data_type: "org_chart", candidates: ambiguousCandidates });
      expect((res.body as { requires_human_tiebreak: boolean }).requires_human_tiebreak).toBe(true);
      expect((res.body as { promoted: boolean }).promoted).toBe(false);
    }

    expect(server.registryStore.getEntry("org_chart")).toBeUndefined();
    expect(server.registryPromotionStore.promotionHistory()).toHaveLength(0);
  });

  it("does not add a duplicate promotion rule on further wins once already promoted", async () => {
    server = await startTestServer();
    const candidates = (round: number) => [
      { source_uri: "file:///roster/canonical.md", content: `v${round}`, last_modified: `2026-0${round}-02T00:00:00.000Z` },
      { source_uri: "file:///roster/stale.md", content: `old${round}`, last_modified: `2026-0${round}-01T00:00:00.000Z` }
    ];

    for (let round = 1; round <= 3; round++) {
      await server.request("POST", "/reconcile", { data_type: "roster", candidates: candidates(round) });
    }
    const fourth = await server.request("POST", "/reconcile", { data_type: "roster", candidates: candidates(4) });
    expect((fourth.body as { promoted: boolean }).promoted).toBe(false);

    const entry = server.registryStore.getEntry("roster");
    const matchingRules = entry?.rules.filter((r) => r.uri_prefix === "file:///roster/canonical.md") ?? [];
    expect(matchingRules).toHaveLength(1);
    expect(server.registryPromotionStore.promotionHistory()).toHaveLength(1);
  });

  it("distinguishes an auto-promoted rule from a hand-edited one via auto_promoted/promoted_at, not a separate log format", async () => {
    server = await startTestServer();

    const handEdit = await server.request("PUT", "/registry/manual_type", {
      rules: [{ uri_prefix: "file:///manual/source.md", priority: 5 }],
      rationale: "Hand-picked by an admin, not learned from recurrence."
    });
    expect((handEdit.body as { ok: boolean }).ok).toBe(true);

    const handEntry = server.registryStore.getEntry("manual_type");
    const handRule = handEntry?.rules.find((r) => r.uri_prefix === "file:///manual/source.md");
    expect(handRule?.auto_promoted).toBeUndefined();
    expect(handRule?.promoted_at).toBeUndefined();

    const candidates = (round: number) => [
      { source_uri: "file:///auto/canonical.md", content: `v${round}`, last_modified: `2026-0${round}-02T00:00:00.000Z` },
      { source_uri: "file:///auto/stale.md", content: `old${round}`, last_modified: `2026-0${round}-01T00:00:00.000Z` }
    ];
    for (let round = 1; round <= 3; round++) {
      await server.request("POST", "/reconcile", { data_type: "auto_type", candidates: candidates(round) });
    }

    const autoEntry = server.registryStore.getEntry("auto_type");
    const autoRule = autoEntry?.rules.find((r) => r.uri_prefix === "file:///auto/canonical.md");
    expect(autoRule?.auto_promoted).toBe(true);
    expect(autoRule?.promoted_at).toBeTruthy();

    // The hand-edited data_type never appears in the promotion audit trail; only the
    // auto-promoted one does.
    const history = server.registryPromotionStore.promotionHistory();
    expect(history.some((h) => h.data_type === "manual_type")).toBe(false);
    expect(history.some((h) => h.data_type === "auto_type")).toBe(true);
  });
});
