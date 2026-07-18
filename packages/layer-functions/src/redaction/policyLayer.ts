/**
 * Phase 3's redaction/policy sub-checks. Deliberately simple, deterministic heuristics —
 * not a real policy DSL or format-transform pipeline (OCR, schema mapping). Documented as
 * placeholders so a later phase can replace them without anyone mistaking this for a real
 * policy engine.
 */

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

export interface RedactionResult {
  redactedContent: string;
  redactedFields: string[];
}

/** Redacts SSN-shaped patterns. `redactedFields` names the redaction *type* found (e.g.
 *  "ssn"), not a structured JSON field path — Phase 3's access() operates on flat text,
 *  not records with named fields. */
export function redactSensitiveContent(content: string): RedactionResult {
  const redactedFields: string[] = [];
  const redactedContent = content.replace(SSN_PATTERN, () => {
    redactedFields.push("ssn");
    return "[REDACTED-SSN]";
  });
  return { redactedContent, redactedFields };
}

const CONTROL_CHAR_RATIO_THRESHOLD = 0.1;

/** Simulates "is this usable text, or something a real OCR/parser pipeline would be needed
 *  for" (scanned PDF, binary blob) via a control-character ratio heuristic. */
export function isUsableFormat(content: string): boolean {
  if (content.length === 0) {
    return true;
  }
  let controlChars = 0;
  for (const ch of content) {
    const code = ch.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32) || code === 127) {
      controlChars += 1;
    }
  }
  return controlChars / content.length < CONTROL_CHAR_RATIO_THRESHOLD;
}

const POLICY_BLOCK_MARKER = "[LEGAL_HOLD]";

/** Stands in for a real policy engine: content explicitly tagged as under legal hold (or
 *  similar outright-restricted category) is blocked outright, not redacted-and-granted. */
export function isPolicyBlocked(content: string): boolean {
  return content.includes(POLICY_BLOCK_MARKER);
}
