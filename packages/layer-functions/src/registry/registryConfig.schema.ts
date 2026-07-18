import { z } from "zod";

export const RegistryRuleSchema = z.object({
  uri_prefix: z.string(),
  priority: z.number(),
  /** Phase 6 addition (additive, optional): distinguishes a rule fathomd added itself
   *  after observing recurring reconciliation wins from one a human hand-edited. */
  auto_promoted: z.boolean().optional(),
  promoted_at: z.string().optional()
});

export const RegistryEntrySchema = z.object({
  rules: z.array(RegistryRuleSchema),
  rationale: z.string()
});

/** The hand-maintained `.fathom/registry.json` shape: data_type -> ranking rules + rationale. */
export const RegistryConfigSchema = z.record(z.string(), RegistryEntrySchema);

export type RegistryRule = z.infer<typeof RegistryRuleSchema>;
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;

export type RegistryConfigParseResult =
  | { ok: true; config: RegistryConfig }
  | { ok: false; issues: z.ZodIssue[] };

export function parseRegistryConfig(input: unknown): RegistryConfigParseResult {
  const result = RegistryConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data };
  }
  return { ok: false, issues: result.error.issues };
}
