// Rawhide Identity — shared types (mirrors the spec)

export interface Persona {
  id: string; // URL-safe; used in ?persona=
  label: string;
  description?: string;
  source: "preset" | "custom";
  claims: Record<string, unknown>; // merged into id_token; MUST include `sub`
  idTokenTTL?: number; // seconds; negative => born expired
  accessTokenTTL?: number;
  refreshable?: boolean;
  authorizeError?: { error: string; error_description?: string };
  createdAt?: number;

  // ---- presentation hints (optional; used by the picker UI) ----
  scenario?: "happy" | "edge" | "error";
  chips?: string[]; // short claim previews; defaults to Object.keys(claims)
}

export interface Knobs {
  autoPersona: string | null;
  idTokenTTLOverride: number | null;
  clockSkewSeconds: number;
  latencyMs: number;
  forceAuthorizeError: { error: string; error_description?: string } | null;
  refreshEnabled: boolean;
  extraClaims: Record<string, unknown>;
}

export type Mode = "light" | "dark";

/** Derive the picker grouping when a persona has no explicit `scenario`. */
export function scenarioOf(p: Persona): "happy" | "edge" | "error" {
  if (p.scenario) return p.scenario;
  if (p.authorizeError || (p.idTokenTTL ?? 0) < 0) return "error";
  const roles = (p.claims?.roles as string[] | undefined) ?? [];
  if (p.id === "valid" || p.id === "admin" || roles.includes("admin")) return "happy";
  return "edge";
}

export function chipsOf(p: Persona): string[] {
  if (p.chips) return p.chips;
  return Object.keys(p.claims ?? {});
}
