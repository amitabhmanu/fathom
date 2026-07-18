export interface CredentialContext {
  available_grants: string[];
  requesting_scope: string;
}

export function hasGrant(ctx: CredentialContext): boolean {
  return ctx.available_grants.includes(ctx.requesting_scope);
}
