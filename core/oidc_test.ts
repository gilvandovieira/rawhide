import { assert, assertEquals, assertExists, assertFalse, assertThrows } from "@std/assert";
import { createProvider, discoveryDocument, parseAuthRequest, type Provider, verifyPkce } from "./oidc.ts";
import { createStore } from "./store.ts";
import { presets } from "./presets.ts";
import { b64url } from "./keys.ts";

const ISSUER = "http://localhost:9000";
const REDIRECT = "http://rp.test/cb";

type TokenBody = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
};

async function mkProvider(injectedClaims?: Record<string, unknown>) {
  const store = await createStore("memory", presets);
  const provider = await createProvider({ issuer: ISSUER, store, injectedClaims });
  return { store, provider };
}

const b64urlDecode = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const claimsOf = (idToken: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(b64urlDecode(idToken.split(".")[1])));

const challenge = async (verifier: string): Promise<string> =>
  b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));

/** Verify an RS256 JWT against a JWKS — the exact check a relying party runs. */
async function verifyToken(idToken: string, jwks: { keys: JsonWebKey[] }): Promise<boolean> {
  const [h, p, s] = idToken.split(".");
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const jwk = jwks.keys.find((k) => (k as { kid?: string }).kid === header.kid) ?? jwks.keys[0];
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
}

function authParams(persona: string, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: "demo",
    redirect_uri: REDIRECT,
    scope: "openid profile email",
    state: "st",
    persona,
  });
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
}

function codeFrom(provider: Provider, persona: string, extra: Record<string, string> = {}): URL {
  const res = provider.authorize(authParams(persona, extra));
  assertEquals(res.type, "redirect");
  return new URL((res as { location: string }).location);
}

function exchangeForm(code: string, verifier?: string): FormData {
  const f = new FormData();
  f.set("grant_type", "authorization_code");
  f.set("code", code);
  f.set("redirect_uri", REDIRECT);
  f.set("client_id", "demo");
  if (verifier) f.set("code_verifier", verifier);
  return f;
}

Deno.test("discovery advertises the load-bearing capabilities", () => {
  const d = discoveryDocument(ISSUER);
  assertEquals(d.issuer, ISSUER);
  assertEquals(d.authorization_endpoint, `${ISSUER}/authorize`);
  assert(d.token_endpoint_auth_methods_supported.includes("none"), "public PKCE client needs none");
  assert(d.code_challenge_methods_supported.includes("S256"));
  assert(d.id_token_signing_alg_values_supported.includes("RS256"));
});

Deno.test("parseAuthRequest rejects malformed requests", () => {
  assertThrows(
    () => parseAuthRequest(new URLSearchParams("response_type=code&redirect_uri=http://rp/cb")),
    Error,
    "client_id",
  );
  assertThrows(() => parseAuthRequest(new URLSearchParams("response_type=code&client_id=demo")), Error, "redirect_uri");
  assertThrows(
    () => parseAuthRequest(new URLSearchParams("response_type=code&client_id=demo&redirect_uri=not-a-url")),
    Error,
    "absolute URL",
  );
  assertThrows(
    () => parseAuthRequest(new URLSearchParams("response_type=token&client_id=demo&redirect_uri=http://rp/cb")),
    Error,
    "response_type",
  );
  const ok = parseAuthRequest(
    new URLSearchParams("response_type=code&client_id=demo&redirect_uri=http://rp/cb&nonce=n"),
  );
  assertEquals(ok.clientId, "demo");
  assertEquals(ok.nonce, "n");
});

Deno.test("verifyPkce accepts the matching verifier only", async () => {
  const v = "the-code-verifier-value";
  const c = await challenge(v);
  assert(await verifyPkce(v, c));
  assertFalse(await verifyPkce("a-different-verifier", c));
});

Deno.test("authorization_code + PKCE mints a JWKS-verifiable RS256 token", async () => {
  const { provider } = await mkProvider({ tenant_id: "acme" });
  const verifier = "fixed-verifier-0123456789-abcdefghij";
  const loc = codeFrom(provider, "valid", {
    nonce: "n1",
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  });
  assertEquals(loc.searchParams.get("state"), "st");
  const code = loc.searchParams.get("code")!;
  assertExists(code);

  const { status, body } = await provider.token(exchangeForm(code, verifier));
  assertEquals(status, 200);
  const t = body as TokenBody;
  assertExists(t.id_token);
  assertExists(t.access_token);
  assert(await verifyToken(t.id_token!, provider.jwks()), "id_token must verify against /jwks");

  const claims = claimsOf(t.id_token!);
  assertEquals(claims.iss, ISSUER);
  assertEquals(claims.aud, "demo");
  assertEquals(claims.sub, "user-001");
  assertEquals(claims.nonce, "n1");
  assertEquals(claims.tenant_id, "acme", "injected tenant claim must be present");
});

Deno.test("PKCE: a wrong verifier is rejected with invalid_grant", async () => {
  const { provider } = await mkProvider();
  const loc = codeFrom(provider, "valid", {
    code_challenge: await challenge("right-verifier"),
    code_challenge_method: "S256",
  });
  const { status, body } = await provider.token(exchangeForm(loc.searchParams.get("code")!, "wrong-verifier"));
  assertEquals(status, 400);
  assertEquals((body as TokenBody).error, "invalid_grant");
});

Deno.test("authorization code is single-use", async () => {
  const { provider } = await mkProvider();
  const code = codeFrom(provider, "valid").searchParams.get("code")!;
  assertEquals((await provider.token(exchangeForm(code))).status, 200);
  assertEquals((await provider.token(exchangeForm(code))).status, 400);
});

Deno.test("redirect_uri must match the one bound at /authorize", async () => {
  const { provider } = await mkProvider();
  const code = codeFrom(provider, "valid").searchParams.get("code")!;
  const f = exchangeForm(code);
  f.set("redirect_uri", "http://evil.test/cb");
  assertEquals((await provider.token(f)).status, 400);
});

Deno.test("access-denied persona redirects with an error and no code", async () => {
  const { provider } = await mkProvider();
  const loc = codeFrom(provider, "access-denied");
  assertEquals(loc.searchParams.get("error"), "access_denied");
  assertFalse(loc.searchParams.has("code"));
});

Deno.test("expired persona issues a token whose exp is already in the past", async () => {
  const { provider } = await mkProvider();
  const code = codeFrom(provider, "expired").searchParams.get("code")!;
  const { body } = await provider.token(exchangeForm(code));
  const claims = claimsOf((body as TokenBody).id_token!);
  assert((claims.exp as number) < Math.floor(Date.now() / 1000), "exp should be in the past");
});

Deno.test("refresh grant re-mints for a refreshable persona", async () => {
  const { provider } = await mkProvider();
  const code = codeFrom(provider, "expiring").searchParams.get("code")!;
  const first = (await provider.token(exchangeForm(code))).body as TokenBody;
  assertExists(first.refresh_token);

  const rf = new FormData();
  rf.set("grant_type", "refresh_token");
  rf.set("refresh_token", first.refresh_token!);
  const { status, body } = await provider.token(rf);
  assertEquals(status, 200);
  assertExists((body as TokenBody).id_token);
});

Deno.test("userinfo returns claims for a live access token, 401 otherwise", async () => {
  const { provider } = await mkProvider();
  const code = codeFrom(provider, "valid").searchParams.get("code")!;
  const at = ((await provider.token(exchangeForm(code))).body as TokenBody).access_token!;
  const ok = provider.userinfo(`Bearer ${at}`);
  assertEquals(ok.status, 200);
  assertEquals((ok.body as Record<string, unknown>).sub, "user-001");
  assertEquals(provider.userinfo("Bearer not-a-real-token").status, 401);
  assertEquals(provider.userinfo(null).status, 401);
});

Deno.test("no persona + no autoPersona → picker; autoPersona → skip", async () => {
  const { store, provider } = await mkProvider();
  const base = new URLSearchParams({
    response_type: "code",
    client_id: "demo",
    redirect_uri: REDIRECT,
    scope: "openid",
  });
  assertEquals(provider.authorize(base).type, "picker");

  const fd = new FormData();
  fd.set("autoPersona", "valid");
  await store.setKnobs(fd);
  assertEquals(provider.authorize(base).type, "redirect");
});

Deno.test("knob idTokenTTLOverride beats the persona TTL", async () => {
  const { store, provider } = await mkProvider();
  const fd = new FormData();
  fd.set("idTokenTTLOverride", "10");
  await store.setKnobs(fd);
  const code = codeFrom(provider, "long-lived").searchParams.get("code")!; // persona TTL = 86400
  const claims = claimsOf(((await provider.token(exchangeForm(code))).body as TokenBody).id_token!);
  assertEquals((claims.exp as number) - (claims.iat as number), 10);
});

Deno.test("knob forceAuthorizeError makes every /authorize error out", async () => {
  const { store, provider } = await mkProvider();
  const fd = new FormData();
  fd.set("forceAuthorizeError", "server_error");
  await store.setKnobs(fd);
  assertEquals(codeFrom(provider, "valid").searchParams.get("error"), "server_error");
});

Deno.test("knob refreshEnabled=false suppresses refresh_token", async () => {
  const { store, provider } = await mkProvider();
  await store.setKnobs(new FormData()); // refreshEnabled checkbox absent → false
  const code = codeFrom(provider, "expiring").searchParams.get("code")!;
  assertEquals(((await provider.token(exchangeForm(code))).body as TokenBody).refresh_token, undefined);
});

Deno.test("claims are filtered by requested scope", async () => {
  const { provider } = await mkProvider();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "demo",
    redirect_uri: REDIRECT,
    scope: "openid", // no profile/email
    persona: "valid",
  });
  const code = new URL((provider.authorize(params) as { location: string }).location).searchParams.get("code")!;
  const claims = claimsOf(((await provider.token(exchangeForm(code))).body as TokenBody).id_token!);
  assertEquals(claims.sub, "user-001");
  assertEquals(claims.email, undefined, "email is gated behind the email scope");
  assertEquals(claims.name, undefined, "name is gated behind the profile scope");
});

Deno.test("unsupported grant_type → 400", async () => {
  const { provider } = await mkProvider();
  const f = new FormData();
  f.set("grant_type", "password");
  const { status, body } = await provider.token(f);
  assertEquals(status, 400);
  assertEquals((body as TokenBody).error, "unsupported_grant_type");
});
