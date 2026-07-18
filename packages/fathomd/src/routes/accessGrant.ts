import type { AccessGrantStore } from "../store/accessGrantStore.js";

export interface AccessGrantRouteDeps {
  accessGrantStore: AccessGrantStore;
}

export function handleCheckAccessGrant(
  sourceUri: string,
  scope: string,
  deps: AccessGrantRouteDeps
): { granted: boolean } {
  return { granted: deps.accessGrantStore.isApproved(sourceUri, scope) };
}

/**
 * The human/admin path: approves a grant so a later fathom_request_access check succeeds.
 * Never called by the MCP tool itself — that's the mechanical guarantee behind
 * "fathom_request_access never auto-grants."
 */
export function handleApproveAccessGrant(
  sourceUri: string,
  scope: string,
  approvedBy: string,
  deps: AccessGrantRouteDeps
): { ok: true } {
  deps.accessGrantStore.approve(sourceUri, scope, approvedBy);
  return { ok: true };
}
