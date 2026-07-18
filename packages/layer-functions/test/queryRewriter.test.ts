import { describe, expect, it } from "vitest";
import { rewriteQuery } from "../src/queryRewriter.js";

describe("rewriteQuery", () => {
  it("strips stopwords and normalizes casing", () => {
    expect(rewriteQuery("the fetch function in api client")).toEqual([
      "fetch",
      "function",
      "api",
      "client"
    ]);
  });

  it("splits camelCase identifiers into separate tokens", () => {
    expect(rewriteQuery("the fetchApiClient helper")).toEqual(["fetch", "api", "client", "helper"]);
  });

  it("splits snake_case and punctuation into separate tokens", () => {
    expect(rewriteQuery("read_stdin_json() helper")).toEqual(["read", "stdin", "json", "helper"]);
  });

  it("returns an empty array for a query that is entirely stopwords", () => {
    expect(rewriteQuery("the a of")).toEqual([]);
  });
});
