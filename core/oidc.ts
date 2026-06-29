// Rawhide Identity — framework-agnostic OIDC core.
// Authorization Code + PKCE, RS256 id_tokens, opaque access tokens, refresh grant.
// `createProvider` bundles a persona store + key store + issuer into the HTTP-shaped
// operations that the Fresh adapter (main.tsx) calls. All token/code state is held in
// closure (per provider instance), so multiple instances don't collide.
import type { Persona } from "./types.ts";
import type { PersonaStore } from "./store.ts";
import { b64url, createKeyStore, type KeyStore } from "./keys.ts";

export { createStore } from "./store.ts";
export type { Knobs, Persona } from "./types.ts";
export type { PersonaStore } from "./store.ts";

export interface AuthRequest {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

interface AuthCode {
  personaId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce?: string;
  codeChallenge?: string;
  createdAt: number;
}

export type AuthorizeResult =
  | { type: "picker" }
  | { type: "redirect"; location: string }
  | { type: "error"; status: number; message: string };

export interface TokenResult {
  status: number;
  body: unknown;
}

export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  response_modes_supported: string[];
  grant_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
  claims_supported: string[];
}

/** The HTTP-shaped operations the Fresh adapter calls. */
export interface Provider {
  store: PersonaStore;
  discovery(): DiscoveryDocument;
  jwks(): { keys: JsonWebKey[] };
  rotateKey(): Promise<void>;
  authorize(params: URLSearchParams): AuthorizeResult;
  token(form: FormData): Promise<TokenResult>;
  userinfo(authHeader: string | null): TokenResult;
}

export interface ProviderOptions {
  issuer: string;
  store: PersonaStore;
  /** Fixed per-instance claims merged into every token (e.g. tenant_id). Survives console reset. */
  injectedClaims?: Record<string, unknown>;
  keys?: KeyStore;
  /** Authorization code lifetime in ms (default 60s). */
  codeTtlMs?: number;
}

const CLAIM_FILTERS: Record<string, string[]> = {
  profile: [
    "name",
    "family_name",
    "given_name",
    "middle_name",
    "nickname",
    "preferred_username",
    "profile",
    "picture",
    "website",
    "gender",
    "birthdate",
    "zoneinfo",
    "locale",
    "updated_at",
  ],
  email: ["email", "email_verified"],
};

/** Discovery metadata served at <issuer>/.well-known/openid-configuration. */
export function discoveryDocument(issuer: string): DiscoveryDocument {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    claims_supported: ["sub", "name", "email", "email_verified", "roles"],
  };
}

/** Parse an /authorize request. Throws on a malformed request (adapter maps that to 400). */
export function parseAuthRequest(p: URLSearchParams): AuthRequest {
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  const responseType = p.get("response_type") ?? "code";
  if (!clientId) throw new Error("missing client_id");
  if (!redirectUri) throw new Error("missing redirect_uri");
  try {
    new URL(redirectUri);
  } catch {
    throw new Error("redirect_uri must be an absolute URL");
  }
  if (responseType !== "code") throw new Error(`unsupported response_type '${responseType}' (only 'code')`);
  const ccm = p.get("code_challenge_method") ?? undefined;
  if (ccm && ccm !== "S256") throw new Error(`unsupported code_challenge_method '${ccm}' (only S256)`);

  return {
    clientId,
    redirectUri,
    responseType,
    scope: p.get("scope") ?? "openid",
    state: p.get("state") ?? undefined,
    nonce: p.get("nonce") ?? undefined,
    codeChallenge: p.get("code_challenge") ?? undefined,
    codeChallengeMethod: ccm,
  };
}

/** PKCE S256 check: BASE64URL(SHA256(verifier)) === challenge. */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest) === challenge;
}

function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Keep only the claims permitted by the requested scopes (openid always allowed). */
function filterClaimsByScope(claims: Record<string, unknown>, scope: string): Record<string, unknown> {
  const scopes = new Set(scope.split(/\s+/).filter(Boolean));
  const allowed = new Set<string>(["sub"]);
  for (const s of scopes) for (const c of CLAIM_FILTERS[s] ?? []) allowed.add(c);
  // Any claim not covered by a known scope filter (e.g. roles, groups, org_id) passes through —
  // we only gate the standard profile/email claims, matching how most providers behave.
  const gated = new Set([...CLAIM_FILTERS.profile, ...CLAIM_FILTERS.email]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claims)) {
    if (allowed.has(k) || !gated.has(k)) out[k] = v;
  }
  return out;
}

export async function createProvider(opts: ProviderOptions): Promise<Provider> {
  const { issuer, store } = opts;
  const injectedClaims = opts.injectedClaims ?? {};
  const keys = opts.keys ?? await createKeyStore();
  const codeTtlMs = opts.codeTtlMs ?? 60_000;

  const codes = new Map<string, AuthCode>();
  const accessTokens = new Map<string, { personaId: string; scope: string; exp: number }>();
  const refreshTokens = new Map<string, { personaId: string; clientId: string; scope: string }>();

  const invalidGrant = (description: string): TokenResult => ({
    status: 400,
    body: { error: "invalid_grant", error_description: description },
  });

  function issueCode(req: AuthRequest, personaId: string): string {
    const code = randomToken();
    codes.set(code, {
      personaId,
      clientId: req.clientId,
      redirectUri: req.redirectUri,
      scope: req.scope,
      nonce: req.nonce,
      codeChallenge: req.codeChallenge,
      createdAt: Date.now(),
    });
    return code;
  }

  async function mintTokens(persona: Persona, clientId: string, scope: string, nonce?: string) {
    const k = store.knobs();
    const ttl = k.idTokenTTLOverride ?? persona.idTokenTTL ?? 3600;
    const now = Math.floor(Date.now() / 1000) + k.clockSkewSeconds;
    const personaClaims = filterClaimsByScope(persona.claims, scope);

    const idToken = await keys.signJwt({
      iss: issuer,
      sub: persona.claims.sub,
      aud: clientId,
      iat: now,
      exp: now + ttl,
      auth_time: now,
      ...(nonce ? { nonce } : {}),
      ...personaClaims,
      ...injectedClaims,
      ...k.extraClaims,
    });

    const accessTtl = persona.accessTokenTTL ?? 3600;
    const accessToken = randomToken();
    accessTokens.set(accessToken, { personaId: persona.id, scope, exp: Math.floor(Date.now() / 1000) + accessTtl });

    const issueRefresh = (persona.refreshable ?? false) && k.refreshEnabled;
    let refreshToken: string | undefined;
    if (issueRefresh) {
      refreshToken = randomToken();
      refreshTokens.set(refreshToken, { personaId: persona.id, clientId, scope });
    }

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: accessTtl,
      id_token: idToken,
      scope,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
  }

  async function exchangeCode(form: FormData): Promise<TokenResult> {
    const code = String(form.get("code") ?? "");
    const bound = codes.get(code);
    codes.delete(code); // single-use: delete on read
    if (!bound) return invalidGrant("unknown or already-used code");
    if (Date.now() - bound.createdAt > codeTtlMs) return invalidGrant("code expired");

    const redirectUri = String(form.get("redirect_uri") ?? "");
    if (redirectUri !== bound.redirectUri) return invalidGrant("redirect_uri mismatch");

    if (bound.codeChallenge) {
      const verifier = String(form.get("code_verifier") ?? "");
      if (!verifier) return invalidGrant("code_verifier required");
      if (!await verifyPkce(verifier, bound.codeChallenge)) return invalidGrant("PKCE verification failed");
    }

    const persona = store.getPersona(bound.personaId);
    if (!persona) return invalidGrant("persona no longer exists");
    return { status: 200, body: await mintTokens(persona, bound.clientId, bound.scope, bound.nonce) };
  }

  async function refreshGrant(form: FormData): Promise<TokenResult> {
    const token = String(form.get("refresh_token") ?? "");
    const bound = refreshTokens.get(token);
    if (!bound) return invalidGrant("unknown refresh_token");
    if (!store.knobs().refreshEnabled) return invalidGrant("refresh is disabled");
    const persona = store.getPersona(bound.personaId);
    if (!persona) return invalidGrant("persona no longer exists");
    refreshTokens.delete(token); // rotate: old refresh token is consumed
    return { status: 200, body: await mintTokens(persona, bound.clientId, bound.scope) };
  }

  return {
    store,
    discovery: () => discoveryDocument(issuer),
    jwks: () => keys.jwks(),
    rotateKey: () => keys.rotateKey(),

    /** Decide what /authorize should do: render the picker, redirect, or error. */
    authorize(params: URLSearchParams): AuthorizeResult {
      const req = parseAuthRequest(params); // throws → adapter returns 400
      const k = store.knobs();
      const id = params.get("persona") ?? k.autoPersona;
      if (!id) return { type: "picker" };

      const persona = store.getPersona(id);
      if (!persona) return { type: "error", status: 400, message: `unknown persona: ${id}` };

      const target = new URL(req.redirectUri);
      const err = k.forceAuthorizeError ?? persona.authorizeError;
      if (err) {
        target.searchParams.set("error", err.error);
        if (err.error_description) target.searchParams.set("error_description", err.error_description);
      } else {
        target.searchParams.set("code", issueCode(req, persona.id));
      }
      if (req.state) target.searchParams.set("state", req.state);
      return { type: "redirect", location: target.toString() };
    },

    async token(form: FormData): Promise<TokenResult> {
      const grant = form.get("grant_type");
      if (grant === "authorization_code") return await exchangeCode(form);
      if (grant === "refresh_token") return await refreshGrant(form);
      return { status: 400, body: { error: "unsupported_grant_type" } };
    },

    userinfo(authHeader: string | null): TokenResult {
      const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
      const bound = token ? accessTokens.get(token) : undefined;
      if (!bound) return { status: 401, body: { error: "invalid_token" } };
      if (bound.exp * 1000 < Date.now()) {
        accessTokens.delete(token);
        return { status: 401, body: { error: "invalid_token", error_description: "expired" } };
      }
      const persona = store.getPersona(bound.personaId);
      if (!persona) return { status: 401, body: { error: "invalid_token" } };
      return { status: 200, body: { ...filterClaimsByScope(persona.claims, bound.scope), ...injectedClaims } };
    },
  };
}
