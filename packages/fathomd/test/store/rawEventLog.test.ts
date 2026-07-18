import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.js";
import { RawEventLog } from "../../src/store/rawEventLog.js";

describe("RawEventLog", () => {
  it("appends events and counts them", () => {
    const db = openDb(":memory:");
    const log = new RawEventLog(db);
    expect(log.count()).toBe(0);
    log.append("PreToolUse", { tool_name: "Read" });
    log.append("PostToolUse", { tool_name: "Read", tool_response: "hi" });
    expect(log.count()).toBe(2);
  });

  it("tail() returns most recent first with the raw payload preserved", () => {
    const db = openDb(":memory:");
    const log = new RawEventLog(db);
    log.append("SessionStart", { source: "startup" });
    log.append("Stop", { last_assistant_message: "done" });
    const rows = log.tail(10);
    expect(rows).toHaveLength(2);
    expect(rows[0].event_name).toBe("Stop");
    expect(JSON.parse(rows[0].payload_json)).toEqual({ last_assistant_message: "done" });
    expect(rows[1].event_name).toBe("SessionStart");
  });

  it("latest() returns the single most recent row", () => {
    const db = openDb(":memory:");
    const log = new RawEventLog(db);
    log.append("A", {});
    log.append("B", {});
    expect(log.latest()?.event_name).toBe("B");
  });
});
