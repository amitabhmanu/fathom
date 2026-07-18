import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rank } from "../src/rank.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = path.join(here, "fixtures", "relevance-regression-set.json");

interface RegressionCase {
  query: string;
  candidates: { source_uri: string; content: string }[];
  expected_top: string;
}

const cases: RegressionCase[] = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

const PASS_RATE_THRESHOLD = 0.8;

describe("relevance regression set", () => {
  it(`hits top-1 expected result for at least ${PASS_RATE_THRESHOLD * 100}% of hand-built cases`, () => {
    let passed = 0;
    const failures: string[] = [];

    for (const testCase of cases) {
      const result = rank({ query: testCase.query, candidates: testCase.candidates });
      const top = result.ranked[0]?.source_uri;
      if (top === testCase.expected_top) {
        passed += 1;
      } else {
        failures.push(`"${testCase.query}": expected top "${testCase.expected_top}", got "${top}"`);
      }
    }

    const passRate = passed / cases.length;
    expect(passRate, `pass rate ${passRate} (${passed}/${cases.length}). Failures:\n${failures.join("\n")}`).toBeGreaterThanOrEqual(
      PASS_RATE_THRESHOLD
    );
  });
});
