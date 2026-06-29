import { assert, assertEquals, assertFalse, assertNotEquals } from "@std/assert";
import { createKeyStore } from "./keys.ts";

const b64urlDecode = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const headerOf = (jwt: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split(".")[0])));

async function verify(idToken: string, jwk: JsonWebKey): Promise<boolean> {
  const [h, p, s] = idToken.split(".");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
}

Deno.test("signJwt produces a token verifiable against the published jwks", async () => {
  const ks = await createKeyStore();
  const jwt = await ks.signJwt({ sub: "x", iss: "i" });
  const { keys } = ks.jwks();
  assertEquals(keys.length, 1);
  assert(await verify(jwt, keys[0]));
});

Deno.test("the header kid matches the published key kid", async () => {
  const ks = await createKeyStore();
  const jwt = await ks.signJwt({});
  assertEquals(headerOf(jwt).kid, ks.currentKid());
  assertEquals((ks.jwks().keys[0] as { kid?: string }).kid, ks.currentKid());
});

Deno.test("a tampered token does not verify", async () => {
  const ks = await createKeyStore();
  const jwt = await ks.signJwt({ sub: "x" });
  const [h, _p, s] = jwt.split(".");
  const forged = `${h}.${btoa(JSON.stringify({ sub: "admin" })).replace(/=/g, "")}.${s}`;
  assertFalse(await verify(forged, ks.jwks().keys[0]));
});

Deno.test("rotateKey makes a fresh kid and keeps the previous for a grace window", async () => {
  const ks = await createKeyStore(); // graceKeys = 1
  const oldKid = ks.currentKid();
  const oldToken = await ks.signJwt({ n: 1 });

  await ks.rotateKey();
  const newKid = ks.currentKid();
  assertNotEquals(newKid, oldKid);

  const { keys } = ks.jwks();
  assertEquals(keys.length, 2, "current + one grace key");

  const oldJwk = keys.find((k) => (k as { kid?: string }).kid === oldKid)!;
  assert(await verify(oldToken, oldJwk), "in-flight token still verifies against the retained key");

  const newToken = await ks.signJwt({ n: 2 });
  assertEquals(headerOf(newToken).kid, newKid);
});

Deno.test("the grace window is bounded (never grows unbounded)", async () => {
  const ks = await createKeyStore(1);
  await ks.rotateKey();
  await ks.rotateKey();
  await ks.rotateKey();
  assertEquals(ks.jwks().keys.length, 2);
});
