import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.js";
import { EnvelopeStore } from "../../src/store/envelopeStore.js";
import { RankingLog } from "../../src/store/rankingLog.js";
import { runCascadeFrom } from "../../src/routes/driftCascade.js";

describe("runCascadeFrom", () => {
  it("layer 2 entry: executes fit and stores a fresh envelope whose hash matches the new content", () => {
    const db = openDb(":memory:");
    const envelopeStore = new EnvelopeStore(db);
    const rankingLog = new RankingLog(db);
    const freshContent = "updated file content after an edit";

    const result = runCascadeFrom(["2", "1"], "file:///a.md", freshContent, { envelopeStore, rankingLog });

    expect(result.layers_executed).toEqual(["2", "1"]);
    expect(result.layers_surfaced).toEqual([]);
    expect(result.stored_envelope_ids.length).toBeGreaterThan(0);

    const stored = envelopeStore.getBySourceUri("file:///a.md");
    const passEnvelope = stored.find((e) => e.content === freshContent);
    expect(passEnvelope?.content_hash).toBe(createHash("sha256").update(freshContent).digest("hex"));
  });

  it("uses the last known ranking query for this source_uri when re-ranking, if one exists", () => {
    const db = openDb(":memory:");
    const envelopeStore = new EnvelopeStore(db);
    const rankingLog = new RankingLog(db);
    rankingLog.append("resolveEndpoint", 0.08, [{ source_uri: "file:///a.ts", score: 0.9, rank: 0 }]);

    runCascadeFrom(["1"], "file:///a.ts", "export function resolveEndpoint(root) {}", {
      envelopeStore,
      rankingLog
    });

    const stored = envelopeStore.getBySourceUri("file:///a.ts");
    const rankedEnvelope = stored.find((e) => e.ranking_metadata);
    expect(rankedEnvelope?.ranking_metadata?.query).toBe("resolveEndpoint");
  });

  it("layers 3/3f/4/5/6 are surfaced, not auto-executed — no envelopes stored for them", () => {
    const db = openDb(":memory:");
    const envelopeStore = new EnvelopeStore(db);
    const rankingLog = new RankingLog(db);

    const result = runCascadeFrom(["3f", "3", "2", "1"], "file:///b.md", "content", {
      envelopeStore,
      rankingLog
    });

    expect(result.layers_surfaced).toEqual(["3f", "3"]);
    expect(result.layers_executed).toEqual(["2", "1"]);
  });

  it("a full 6-down-to-1 cascade surfaces 6/5/4/3f/3 and executes 2/1", () => {
    const db = openDb(":memory:");
    const envelopeStore = new EnvelopeStore(db);
    const rankingLog = new RankingLog(db);

    const result = runCascadeFrom(["6", "5", "4", "3f", "3", "2", "1"], "file:///c.md", "content", {
      envelopeStore,
      rankingLog
    });

    expect(result.layers_surfaced).toEqual(["6", "5", "4", "3f", "3"]);
    expect(result.layers_executed).toEqual(["2", "1"]);
  });
});
