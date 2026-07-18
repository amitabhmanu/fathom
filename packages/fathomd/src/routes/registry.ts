import { RegistryEntrySchema, type RegistryEntry } from "@fathom/layer-functions";
import type { RegistryStore } from "../store/registryStore.js";

export interface RegistryRouteDeps {
  registryStore: RegistryStore;
}

export function handleGetRegistryEntry(dataType: string, deps: RegistryRouteDeps): RegistryEntry | null {
  return deps.registryStore.getEntry(dataType) ?? null;
}

export type PutRegistryResult = { ok: true } | { ok: false; reason: string };

export function handlePutRegistryEntry(dataType: string, body: unknown, deps: RegistryRouteDeps): PutRegistryResult {
  const parsed = RegistryEntrySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  deps.registryStore.setEntry(dataType, parsed.data);
  return { ok: true };
}
