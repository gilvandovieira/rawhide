// Pure crypto/encoding helpers shared by the harness component and its tests.
// Web Standards only (Web Crypto, atob/btoa, TextEncoder/Decoder) → runs unchanged in
// browsers and under Deno, so the same code the component uses is what the tests exercise.

export const bytesToB64url = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/** Decode (not verify) a JWT into its header + payload. Throws if it isn't a 3-part JWT. */
export const decodeJwt = (token: string): DecodedJwt => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("id_token is not a JWT");
  const seg = (s: string) =>
    JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as Record<
      string,
      unknown
    >;
  return { header: seg(parts[0]), payload: seg(parts[1]) };
};

/** A fresh 256-bit PKCE code_verifier (base64url). */
export const randomVerifier = (): string =>
  bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));

/** PKCE S256 challenge: BASE64URL(SHA256(verifier)). */
export const pkceChallenge = async (verifier: string): Promise<string> =>
  bytesToB64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );

/** Verify a JWT's RS256 signature against a public JWK (the check a real RP performs). */
export const verifyRs256 = async (
  idToken: string,
  jwk: JsonWebKey,
): Promise<boolean> => {
  const [h, p, s] = idToken.split(".");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
};
