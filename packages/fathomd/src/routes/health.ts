export interface HealthResponse {
  ok: true;
  version: string;
}

const VERSION = "0.1.0";

export function handleHealth(): HealthResponse {
  return { ok: true, version: VERSION };
}
