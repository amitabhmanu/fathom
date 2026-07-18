import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.js";
import { ThresholdStore } from "../../src/store/thresholdStore.js";

let db: ReturnType<typeof openDb> | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("ThresholdStore", () => {
  it("falls back to the router's default when no override has been set", () => {
    db = openDb(":memory:");
    const store = new ThresholdStore(db);
    expect(store.get("1")).toBeCloseTo(0.3, 5);
    expect(store.overridesSnapshot()).toEqual({});
  });

  it("persists a set override and reflects it in both get() and overridesSnapshot()", () => {
    db = openDb(":memory:");
    const store = new ThresholdStore(db);
    store.set("4", 0.82);
    expect(store.get("4")).toBeCloseTo(0.82, 5);
    expect(store.overridesSnapshot()).toEqual({ "4": 0.82 });
  });

  it("overwrites a prior override for the same layer rather than duplicating rows", () => {
    db = openDb(":memory:");
    const store = new ThresholdStore(db);
    store.set("2", 0.5);
    store.set("2", 0.55);
    expect(store.get("2")).toBeCloseTo(0.55, 5);
    expect(Object.keys(store.overridesSnapshot())).toHaveLength(1);
  });
});
