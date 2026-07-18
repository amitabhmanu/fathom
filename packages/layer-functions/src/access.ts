import { randomUUID, createHash } from "node:crypto";
import { CONTEXT_ENVELOPE_SCHEMA_VERSION, type Envelope } from "@fathom/context-contract";
import { type CredentialContext, hasGrant } from "./credentials/credentialContext.js";
import { isUsableFormat, isPolicyBlocked, redactSensitiveContent } from "./redaction/policyLayer.js";

export type { CredentialContext };

export interface AccessInput {
  source_uri: string;
  /** Added during Phase 3 implementation: fathom-api-spec.md's access() input lacked this,
   *  but the format and redaction sub-checks both need the actual content to inspect. */
  content: string;
  credential_ctx: CredentialContext;
}

export type AccessResult =
  | { kind: "granted"; envelope: Envelope }
  | { kind: "denied"; reason: "credentials" | "format" | "policy"; escalation_required: boolean };

const LAYER3_TTL_SECONDS = 3600;

/**
 * Layer 3 (inaccessible): all three sub-checks — credentials, format, policy — must clear
 * together. Order matters: credentials first (nothing else is checkable without them
 * conceptually being present), then format (unusable content can't be redacted or judged),
 * then policy/redaction against content that's actually readable.
 */
export function access(input: AccessInput): AccessResult {
  if (!hasGrant(input.credential_ctx)) {
    return { kind: "denied", reason: "credentials", escalation_required: true };
  }

  if (!isUsableFormat(input.content)) {
    return { kind: "denied", reason: "format", escalation_required: false };
  }

  if (isPolicyBlocked(input.content)) {
    return { kind: "denied", reason: "policy", escalation_required: false };
  }

  const { redactedContent, redactedFields } = redactSensitiveContent(input.content);
  const now = new Date().toISOString();

  const envelope: Envelope = {
    schema_version: CONTEXT_ENVELOPE_SCHEMA_VERSION,
    envelope_id: randomUUID(),
    content: redactedContent,
    content_hash: createHash("sha256").update(redactedContent).digest("hex"),
    source_uri: input.source_uri,
    origin_layer: "3",
    provenance: redactedFields.length > 0 ? "redacted" : "system-authoritative",
    confidence: 1,
    timestamp: now,
    freshness_contract: { ttl_seconds: LAYER3_TTL_SECONDS },
    access_provenance: {
      granted_by: "credential-grant",
      scope: input.credential_ctx.requesting_scope,
      ...(redactedFields.length > 0 ? { redacted_fields: redactedFields } : {})
    }
  };

  return { kind: "granted", envelope };
}
