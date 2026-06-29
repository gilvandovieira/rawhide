// Rawhide Identity — RS256 signing keys, JWKS, and JWT signing on Web Crypto.
// The keypair is ephemeral per process and rotatable at runtime. On rotation we keep
// the previous public key in the JWKS set for a grace window so in-flight tokens still verify.

export interface KeyStore {
  /** Public JWK set served at /jwks (current key first, plus grace keys). */
  jwks(): { keys: JsonWebKey[] };
  /** Sign a JWT (RS256) with the current key; header carries its kid. */
  signJwt(payload: Record<string, unknown>): Promise<string>;
  /** Generate a fresh keypair + kid and make it current. */
  rotateKey(): Promise<void>;
  /** The kid of the current signing key. */
  currentKid(): string;
}

const b64url = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

interface KeyEntry {
  kid: string;
  pair: CryptoKeyPair;
  publicJwk: JsonWebKey;
}

async function generate(): Promise<KeyEntry> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const kid = crypto.randomUUID();
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = { ...jwk, kid, use: "sig", alg: "RS256" } as JsonWebKey;
  return { kid, pair, publicJwk };
}

/**
 * Create a key store. `graceKeys` is how many previous public keys to keep in the
 * JWKS set after a rotation (default 1 → current + one previous).
 */
export async function createKeyStore(graceKeys = 1): Promise<KeyStore> {
  let entries: KeyEntry[] = [await generate()]; // entries[0] is always current

  return {
    jwks() {
      return { keys: entries.map((e) => e.publicJwk) };
    },
    currentKid() {
      return entries[0].kid;
    },
    async signJwt(payload) {
      const cur = entries[0];
      const enc = new TextEncoder();
      const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: cur.kid })));
      const body = b64url(enc.encode(JSON.stringify(payload)));
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cur.pair.privateKey, enc.encode(`${head}.${body}`));
      return `${head}.${body}.${b64url(sig)}`;
    },
    async rotateKey() {
      const fresh = await generate();
      entries = [fresh, ...entries].slice(0, 1 + graceKeys);
    },
  };
}

export { b64url };
