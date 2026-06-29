/// <reference lib="deno.ns" />
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import {
  b64urlToBytes,
  bytesToB64url,
  decodeJwt,
  pkceChallenge,
  randomVerifier,
  verifyRs256,
} from "./crypto.ts";

/** Mint a genuine RS256 JWT + its public JWK, the way the provider does. */
async function mintRs256(
  payload: Record<string, unknown>,
): Promise<{ jwt: string; jwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const enc = new TextEncoder();
  const head = bytesToB64url(
    enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    enc.encode(`${head}.${body}`),
  );
  return {
    jwt: `${head}.${body}.${bytesToB64url(sig)}`,
    jwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

Deno.test("b64url roundtrips arbitrary bytes", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  assertEquals([...b64urlToBytes(bytesToB64url(bytes))], [...bytes]);
});

Deno.test("b64url output is URL-safe (no + / =)", () => {
  assertFalse(
    /[+/=]/.test(bytesToB64url(new Uint8Array([251, 255, 254, 253, 0, 1, 2]))),
  );
});

Deno.test("pkceChallenge matches the RFC 7636 test vector", async () => {
  // RFC 7636 Appendix B
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assertEquals(
    await pkceChallenge(verifier),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

Deno.test("randomVerifier is URL-safe and 256-bit (~43 chars)", () => {
  const v = randomVerifier();
  assertFalse(/[+/=]/.test(v));
  assert(v.length >= 43);
});

Deno.test("decodeJwt extracts header and payload", async () => {
  const { jwt } = await mintRs256({ sub: "u1", role: "admin" });
  const { header, payload } = decodeJwt(jwt);
  assertEquals(header.alg, "RS256");
  assertEquals(payload.sub, "u1");
  assertEquals(payload.role, "admin");
});

Deno.test("decodeJwt rejects non-JWTs", () => {
  assertThrows(() => decodeJwt("not.a.jwt.really"), Error, "JWT");
  assertThrows(() => decodeJwt("only-one-part"), Error, "JWT");
});

Deno.test("verifyRs256 accepts a genuine token and rejects a tampered one", async () => {
  const { jwt, jwk } = await mintRs256({ sub: "u1" });
  assert(await verifyRs256(jwt, jwk), "a genuine token must verify");

  const [h, _p, s] = jwt.split(".");
  const forged = bytesToB64url(
    new TextEncoder().encode(JSON.stringify({ sub: "admin" })),
  );
  assertFalse(
    await verifyRs256(`${h}.${forged}.${s}`, jwk),
    "a tampered payload must fail",
  );
});
