// Rawhide Identity — Knobs defaults + FormData parsing.
// Knobs are global, runtime behaviour dials read at mint time (knob beats persona).
import type { Knobs } from "./types.ts";

export const defaultKnobs: Knobs = {
  autoPersona: null,
  idTokenTTLOverride: null,
  clockSkewSeconds: 0,
  latencyMs: 0,
  forceAuthorizeError: null,
  refreshEnabled: true,
  extraClaims: {},
};

/** Parse the `/console/knobs` form into a `Knobs`, falling back to `prev` for absent fields. */
export function parseKnobs(form: FormData, prev: Knobs = defaultKnobs): Knobs {
  const str = (k: string) => {
    const v = form.get(k);
    return v == null ? "" : String(v).trim();
  };
  const numOrNull = (k: string, fallback: number | null) => {
    const v = str(k);
    if (v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const num = (k: string, fallback: number) => numOrNull(k, fallback) as number;

  const fae = str("forceAuthorizeError");

  let extraClaims = prev.extraClaims ?? {};
  const ec = str("extraClaims");
  if (ec) {
    try {
      const parsed = JSON.parse(ec);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        extraClaims = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid JSON — keep the previous value
    }
  } else {
    extraClaims = {};
  }

  return {
    autoPersona: str("autoPersona") || null,
    idTokenTTLOverride: numOrNull("idTokenTTLOverride", null),
    clockSkewSeconds: num("clockSkewSeconds", 0),
    latencyMs: num("latencyMs", 0),
    forceAuthorizeError: fae ? { error: fae } : null,
    refreshEnabled: form.get("refreshEnabled") != null,
    extraClaims,
  };
}
