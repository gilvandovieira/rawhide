# rawhideidentity

**`@gilvandovieira/rawhideidentity`** — a drop-in OpenID Connect provider for **local dev and integration tests**, distributed as standalone binaries via GitHub Releases. A relying party (RP) redirects the browser here; the human picks a **persona** (a test scenario); the provider mints tokens for that persona and bounces back. The headline goal: point `openid-client` at the issuer URL and it just works with no special-casing.

Stack: **Deno** + **Fresh 2.3** (`@fresh/core`). Token signing and JWKS use Web Crypto (`crypto.subtle`), no third-party deps required. The OIDC core is framework-agnostic; Fresh is only the adapter.

Two surfaces sit on top of that core: the **picker** RPs land on, and a separate **control console** (`/console`) for authoring personas on the fly and flipping behavior **knobs** at runtime. Personas are no longer a static array — a small seeded **store** holds ~10 presets plus anything you create, persisted to a local JSON file (or kept in-memory). Both surfaces are plain server-rendered forms with no islands, so the whole thing still runs with **no build step**.

---

## Goals

- **Self-negotiating.** RP discovers everything via `/.well-known/openid-configuration`. No pre-shared client config required.
- **Persona-driven.** A persona is a *scenario*, not just a user: a valid user, a valid-but-about-to-expire user, an admin, etc. The picker is the only human step.
- **Conformant happy path.** Authorization Code + PKCE, signed RS256 ID tokens, JWKS — enough that any spec-compliant client validates the tokens without complaint.

## Non-goals

- Not a real IdP. No password auth, no consent screen, no rate limiting. Tokens/sessions aren't persisted; only personas and knobs are (to a local file).
- No client authentication enforcement (open model). No implicit/hybrid flows.
- Not production-safe. It will happily impersonate an admin for anyone who asks.
- The control console can mint admin tokens for any RP. It is a **localhost-only** tool — never expose it on a shared or public host (gate it off with `CONSOLE=off`).

---

## Flow

```
RP                          Browser                          Provider
 │  302 → /authorize ──────────▶│                                │
 │                              │  GET /authorize?<oidc params> ─▶│
 │                              │◀──── 200  persona picker (HTML) │
 │                              │  click "Admin"                  │
 │                              │  GET /authorize?<same>&persona=admin ─▶│
 │                              │◀──── 302  redirect_uri?code=…&state=…  │
 │◀── GET /callback?code=&state │                                │
 │  POST /token (code + verifier) ───────────────────────────────▶│
 │◀──────────── { id_token, access_token, refresh_token? } ───────│
```

The picker preserves the **verbatim** authorize query string and appends `&persona=<id>` to each option link. Selecting a persona re-hits `/authorize`, which now skips the picker and completes the flow.

---

## HTTP surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/openid-configuration` | Discovery metadata |
| GET | `/jwks` | Public signing keys |
| GET | `/authorize` | Persona picker → issues auth code |
| POST | `/token` | Code → tokens; refresh grant |
| GET | `/userinfo` | Claims for a Bearer access token |

The OIDC surface is the contract RPs see. The control console adds its own `/console/*` routes — see [Control console](#control-console).

---

## Discovery document

Served at `<issuer>/.well-known/openid-configuration`. All endpoints absolute. Example for `issuer = http://localhost:9000`:

```json
{
  "issuer": "http://localhost:9000",
  "authorization_endpoint": "http://localhost:9000/authorize",
  "token_endpoint": "http://localhost:9000/token",
  "userinfo_endpoint": "http://localhost:9000/userinfo",
  "jwks_uri": "http://localhost:9000/jwks",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["openid", "profile", "email", "offline_access"],
  "claims_supported": ["sub", "name", "email", "email_verified", "roles"]
}
```

`"none"` in `token_endpoint_auth_methods_supported` is load-bearing: it's what lets a public PKCE client (the common `openid-client` config) talk to `/token` without a secret. Confidential clients that *do* send a secret are accepted too — the secret just isn't checked.

---

## `/authorize`

Accepts the standard request params: `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`, `nonce` (optional), `code_challenge`, `code_challenge_method=S256`.

Behavior:

1. **No `persona` param** → render the picker. One option per persona in the store (`label`, `description`). Each option is a link to the same path with the original query preserved plus `&persona=<id>`.
2. **`persona` param present** → resolve the persona, mint a single-use authorization **code**, bind it to the request, and `302` to `redirect_uri?code=<code>&state=<state>`.

Two knobs (see [Knobs](#knobs)) bend this. If `autoPersona` is set and no `persona` param is present, the picker is skipped and that persona is used — this is how you run fully **headless** in CI, where nothing can click a button. If `forceAuthorizeError` is set, every authorize redirects back with that OAuth error regardless of persona.

`state` is echoed verbatim on the redirect. `redirect_uri` is trusted as-is (open model) — validation reduced to "must be a syntactically valid absolute URL".

Code binding (in-memory, ~60s TTL, single-use):

```ts
interface AuthCode {
  personaId: string;
  clientId: string;        // becomes id_token aud
  redirectUri: string;     // must match at /token
  scope: string;
  nonce?: string;          // echoed into id_token if present
  codeChallenge?: string;  // verified at /token if present
  createdAt: number;
}
```

Error-injection personas (optional, see below) skip code issuance and instead `302` to `redirect_uri?error=<error>&error_description=…&state=<state>`.

---

## `/token`

`application/x-www-form-urlencoded`. Two grants.

**authorization_code**

```
grant_type=authorization_code
&code=<code>
&redirect_uri=<redirect_uri>
&client_id=<client_id>
&code_verifier=<verifier>
```

Checks, in order — any failure → `400 invalid_grant`:

- code exists, unexpired, unredeemed → delete it (single-use)
- `redirect_uri` matches the bound value
- if a `code_challenge` was bound: `BASE64URL(SHA256(code_verifier)) === code_challenge`

On success, mint tokens from the bound persona.

**refresh_token** (only for personas with `refreshable: true`)

```
grant_type=refresh_token&refresh_token=<token>
```

Re-mints `id_token` + `access_token` for the same persona. To keep the expiry loop testable, the refreshed `id_token` reuses the persona's (short) `idTokenTTL`.

**Response**

```json
{
  "access_token": "<opaque>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "<JWT>",
  "scope": "openid profile email",
  "refresh_token": "<opaque>"
}
```

`refresh_token` present only when the persona is `refreshable`. `access_token` is opaque by default, stored in-memory → persona, consumed by `/userinfo`.

**ID token**

```jsonc
// header
{ "alg": "RS256", "typ": "JWT", "kid": "<kid>" }
// payload
{
  "iss": "http://localhost:9000",
  "sub": "<persona claim>",
  "aud": "<client_id>",
  "iat": <now>,
  "exp": <now + idTokenTTL>,
  "auth_time": <now>,
  "nonce": "<bound nonce, if any>",
  // ...spread of persona.claims (name, email, roles, …)
}
```

`kid` in the header must match a key in `/jwks`. `aud` must equal the request's `client_id` or `openid-client` rejects the token.

---

## `/userinfo`

`Authorization: Bearer <access_token>`. Looks up the persona bound to the token, returns its claims as JSON (at minimum `sub`). `401` on unknown/expired token.

---

## Signing & JWKS

- **RS256** by default. Key generated **ephemerally at startup** and held in memory; the public half is published at `/jwks` with a stable `kid`. Because the client always fetches JWKS fresh, ephemeral keys need no coordination and survive nothing — exactly right for tests.
- `/jwks` returns standard JWK set:

```json
{ "keys": [ { "kty": "RSA", "use": "sig", "alg": "RS256", "kid": "<kid>", "n": "…", "e": "AQAB" } ] }
```

Optional: load a fixed PEM/JWK from config when you want reproducible tokens across runs.

The console can **rotate** the signing key at runtime (`rotateKey()`): generate a fresh keypair + `kid`, make it current; new tokens carry the new `kid` and `/jwks` serves the new key. Keep the previous public key in the set for a grace window so in-flight tokens still verify — or drop it immediately to test that the RP refetches JWKS and rejects the stale `kid`. (So the keypair is a mutable `let current`, not a `const`.)

---

## Personas

A persona is declarative config. `id` is URL-safe and used in `?persona=`. `claims` must include `sub`; everything else is spread into the ID token (and returned from `/userinfo`).

```ts
interface Persona {
  id: string;                  // URL-safe; used in ?persona=
  label: string;               // shown in picker + console
  description?: string;
  source: "preset" | "custom"; // presets are read-only; custom are editable/deletable

  claims: Record<string, unknown>; // merged into id_token; MUST include `sub`

  idTokenTTL?: number;         // seconds, default 3600 (negative ⇒ born expired, see `expired` preset)
  accessTokenTTL?: number;     // seconds, default 3600
  refreshable?: boolean;       // default false → issues refresh_token

  authorizeError?: { error: string; error_description?: string }; // redirect with an error instead of a code

  createdAt?: number;          // set for custom personas
}
```

### Presets

Ten scenarios seed the store on first boot. Each targets a distinct thing an RP has to handle:

| `id` | exercises | claims / settings |
|---|---|---|
| `valid` | happy path | `sub`, `name`, `email`, `email_verified: true`; 1h |
| `admin` | role-based authz | + `roles: ["admin"]` |
| `expiring` | refresh / expiry loop | id_token TTL 30s, `refreshable` |
| `long-lived` | long sessions | id_token TTL 24h |
| `minimal` | missing optional claims | `sub` only |
| `unverified-email` | email-verification gating | `email_verified: false` |
| `org-member` | multi-tenant / groups | `roles: ["editor"]`, `groups: ["acme/eng"]`, `org_id: "acme"` |
| `new-user` | sparse / onboarding profile | `sub` + `email`, no `name`, recent `updated_at` |
| `expired` | **token validation failure** | `idTokenTTL: -60` → `exp` in the past, RP must reject |
| `access-denied` | **user-cancels error path** | `authorizeError: { error: "access_denied" }` |

The two non-obvious ones:

```ts
{ id: "expired", source: "preset", label: "Expired token",
  description: "id_token is already past exp — the RP should reject it",
  claims: { sub: "user-009", email: "expired@example.test" }, idTokenTTL: -60 },

{ id: "access-denied", source: "preset", label: "Denies consent",
  description: "Simulates the user cancelling — redirects with access_denied",
  claims: { sub: "user-010" },
  authorizeError: { error: "access_denied", error_description: "user denied" } },
```

### Store

Personas live in a small store, not a static array. It's **seeded from the presets** on first run, then holds those plus anything created in the console.

```ts
interface PersonaStore {
  listPersonas(): Persona[];
  getPersona(id: string): Persona | undefined;
  createPersona(form: FormData): Promise<Persona>;   // validates claims JSON + `sub`; source: "custom"
  deletePersona(id: string): Promise<void>;          // refuses when source is "preset"
  knobs(): Knobs;
  setKnobs(form: FormData): Promise<void>;
  reset(): Promise<void>;                             // drop custom personas, restore default knobs
}
```

Default backing is a **local JSON file** (`./.oidc-personas.json`) — written on every mutation, gitignored, hand-inspectable. Alternatives: `"memory"` (nothing persists — fully deterministic, every run starts at the presets) or Deno KV for atomic concurrent writes. Presets are always re-merged on boot, so editing the preset list in code and restarting updates them even when a store file already exists.

---

## Config

```ts
interface ProviderConfig {
  issuer: string;                          // e.g. "http://localhost:9000" (per-tenant: derived from --port)
  presets?: Persona[];                     // store seed; default: the ten above
  store?: { path: string } | "memory";     // default: { path: "./.oidc-personas.json" }
  console?: boolean;                       // default true; false disables /console entirely
  signing?: { alg?: "RS256" | "ES256" };    // default RS256, ephemeral, rotatable
  clients?: "open" | { clientId: string; redirectUris: string[] }[]; // default "open"
  tenant?: string;                         // per-tenant mode (from --tenant); injects a tenant claim
  tenantClaim?: string;                    // claim name for `tenant`, default "tenant_id"
}
```

`clients: "open"` (default) accepts any `client_id` and any `redirect_uri`. Switch to an allow-list when you want the provider to reject unregistered RPs.

---

## Knobs

Knobs are **global, runtime behavior dials** — distinct from personas. A persona is a fixed scenario tied to one identity; a knob bends provider behavior across all of them, without a restart. They're set from the console and read at mint time.

```ts
interface Knobs {
  autoPersona: string | null;               // skip the picker, always use this persona (headless / CI)
  idTokenTTLOverride: number | null;         // seconds; overrides every persona's idTokenTTL when set
  clockSkewSeconds: number;                  // shift iat & exp by N (skew tolerance / future|past tokens); default 0
  latencyMs: number;                         // artificial delay on /token (timeouts & loading states); default 0
  forceAuthorizeError: { error: string; error_description?: string } | null; // every /authorize errors out
  refreshEnabled: boolean;                   // global gate on refresh_token issuance; default true
  extraClaims: Record<string, unknown>;      // merged into every id_token (e.g. inject tenant_id); default {}
}
```

Precedence at mint time — knob beats persona:

```ts
const k = store.knobs();
const ttl = k.idTokenTTLOverride ?? persona.idTokenTTL ?? 3600;
const now = Math.floor(Date.now() / 1000) + k.clockSkewSeconds;
const idToken = await signJwt({
  iss: ISSUER, sub: persona.claims.sub, aud: clientId,
  iat: now, exp: now + ttl, auth_time: now,
  ...(nonce ? { nonce } : {}),
  ...persona.claims, ...k.extraClaims,
});
const issueRefresh = (persona.refreshable ?? false) && k.refreshEnabled;
```

Where each lands: `autoPersona` and `forceAuthorizeError` act in `/authorize`; `latencyMs` wraps `/token`; the rest fold into the ID-token build above. Two more are *actions* rather than stored values — **rotate signing key** and **reset** (clear custom personas + restore default knobs) — exposed as console buttons.

The headline knob is `autoPersona`: with it set, an RP runs the full flow with **no human and no RP code change** — exactly the "point `openid-client` at it and it just works" path, now usable in CI where nothing can click the picker.

---

## Control console

A separate surface from the picker, at `/console`. Plain server-rendered forms — list personas, create one on the fly, flip knobs — each form POSTs, mutates the store, and `303`s back. No island, no build step.

| Method | Path | Purpose |
|---|---|---|
| GET | `/console` | The control UI |
| POST | `/console/personas` | Create a custom persona |
| POST | `/console/personas/:id/delete` | Delete a custom persona (presets can't be deleted) |
| POST | `/console/knobs` | Apply knob changes |
| POST | `/console/rotate-key` | Rotate the signing key |
| POST | `/console/reset` | Clear custom personas + reset knobs to defaults |

Plain HTML forms can't issue `DELETE`/`PUT`, so mutations are `POST` with a path suffix (`/delete`) — no client JS needed to fake verbs.

Persona creation takes a `claims` **raw-JSON textarea** (parsed and validated on submit — must be an object containing `sub`), plus fields for `id`, `label`, `description`, TTLs, and `refreshable`. A source textarea, not a rich/`contentEditable` editor — the input *is* the data and round-trips losslessly. New personas get `source: "custom"`; presets are `source: "preset"` and render read-only (clone-to-edit, never destroy).

```tsx
// components/Console.tsx — sketch (plain forms, zero JS)
export function Console({ personas, knobs }: { personas: Persona[]; knobs: Knobs }) {
  return (
    <main style="max-width:48rem;margin:2rem auto;font-family:system-ui">
      <h1>OIDC test console</h1>

      <h2>Personas</h2>
      <ul>
        {personas.map((p) => (
          <li>
            <code>{p.id}</code> — {p.label} <em>({p.source})</em>
            {p.source === "custom"
              ? (
                <form method="post" action={`/console/personas/${p.id}/delete`} style="display:inline">
                  <button>delete</button>
                </form>
              )
              : null}
          </li>
        ))}
      </ul>

      <h3>New persona</h3>
      <form method="post" action="/console/personas">
        <input name="id" placeholder="id" required />
        <input name="label" placeholder="label" required />
        <input name="description" placeholder="description" />
        <input name="idTokenTTL" type="number" placeholder="id_token TTL (s)" />
        <label><input name="refreshable" type="checkbox" /> refreshable</label>
        <textarea name="claims" rows={6} required>{`{ "sub": "user-123", "email": "x@example.test" }`}</textarea>
        <button>create</button>
      </form>

      <h2>Knobs</h2>
      <form method="post" action="/console/knobs">
        <input name="autoPersona" placeholder="autoPersona id (blank = picker)" value={knobs.autoPersona ?? ""} />
        <input name="idTokenTTLOverride" type="number" placeholder="TTL override (s)" value={knobs.idTokenTTLOverride ?? ""} />
        <input name="clockSkewSeconds" type="number" value={knobs.clockSkewSeconds} />
        <input name="latencyMs" type="number" value={knobs.latencyMs} />
        <label><input name="refreshEnabled" type="checkbox" checked={knobs.refreshEnabled} /> refresh enabled</label>
        <button>apply</button>
      </form>

      <form method="post" action="/console/rotate-key"><button>rotate signing key</button></form>
      <form method="post" action="/console/reset"><button>reset to defaults</button></form>
    </main>
  );
}
```

⚠️ **The console can mint admin tokens for any RP and impersonate any identity.** It is strictly a localhost dev tool. Bind the server to loopback, never expose `/console` on a shared/staging/public host, and disable it there — wrap the console routes behind `Deno.env.get("CONSOLE") !== "off"` (or omit them entirely) anywhere but a developer's machine.

---

## Implementation — Deno + Fresh 2.3

Fresh 2 ships as `@fresh/core` with a Hono-like `App` (`.use`/`.get`/`.post`, `ctx.render(jsx)`). Keep the OIDC logic in a framework-agnostic `core/` and let Fresh be a thin adapter, so the provider stays reusable and the dependency direction points one way (Fresh → core, never back).

### Layout

```
.
├── deno.json
├── main.tsx              # Fresh App — wires the HTTP surface (adapter)
├── components/
│   ├── Picker.tsx        # persona picker RPs land on (zero JS)
│   └── Console.tsx       # control console: personas + knobs (plain forms, zero JS)
└── core/
    ├── oidc.ts           # discovery doc, authorize parse, code/token issuance, PKCE
    ├── keys.ts           # RS256 keypair (rotatable) + JWKS + JWT signing (Web Crypto)
    ├── presets.ts        # the ten seed personas
    ├── store.ts          # seeded persona store + knobs (JSON file | memory)
    └── knobs.ts          # Knobs type + defaults + FormData parsing
```

### `deno.json`

```json
{
  "name": "@gilvandovieira/rawhideidentity",
  "version": "0.1.0",
  "exports": {
    ".": "./main.tsx",
    "./core": "./core/oidc.ts"
  },
  "tasks": {
    "dev": "deno run -A --watch main.tsx",
    "start": "deno run -A main.tsx"
  },
  "imports": {
    "fresh": "jsr:@fresh/core@^2.3.0",
    "preact": "npm:preact@^10",
    "@preact/signals": "npm:@preact/signals@^2",
    "@std/cli": "jsr:@std/cli@^1"
  },
  "compilerOptions": { "jsx": "precompile", "jsxImportSource": "preact" }
}
```

Both the picker and the console are plain server-rendered forms with no islands, so **no build step is needed** — run `main.tsx` directly with `deno run`. Reach for `deno task build` / Fresh's Vite dev flow only if you want live, no-reload knob updates (an island or Fresh Partials).

The two exports split the runnable tool from the embeddable core. `.` is the provider entry — the `import.meta.main` guard means importing the package doesn't start a server, but running it does:

```
deno run -A main.tsx --tenant acme --port 9001
# or a prebuilt binary from GitHub Releases (no Deno needed):
./rawhideidentity-<platform> --tenant acme --port 9001
```

`./core` exposes the framework-agnostic primitives (`createStore`, the OIDC functions, the `Persona`/`Knobs` types) for anyone who wants to embed the issuer in their own process rather than run the binary.

### Wiring — `main.tsx`

The whole HTTP surface is five routes. `parseAuthRequest` throws on a malformed request and `onError` maps that to a `400`.

```tsx
import { App, createDefine } from "fresh";
import { Picker } from "./components/Picker.tsx";
import { Console } from "./components/Console.tsx";
import { store } from "./core/store.ts";
import { discoveryDocument, parseAuthRequest, issueCode, exchangeCode, refresh, userinfo } from "./core/oidc.ts";
import { jwks, rotateKey } from "./core/keys.ts";

interface State { requestId: string }
const define = createDefine<State>();

// optional: request-id propagation — assigns/forwards x-request-id, mirrors your Gate A logging
const requestId = define.middleware(async (ctx) => {
  ctx.state.requestId = ctx.req.headers.get("x-request-id") ?? crypto.randomUUID();
  const res = await ctx.next();
  res.headers.set("x-request-id", ctx.state.requestId);
  return res;
});

const ISSUER = Deno.env.get("ISSUER") ?? "http://localhost:9000";

const seeOther = (loc: string) => new Response(null, { status: 303, headers: { location: loc } });
const consoleOn = Deno.env.get("CONSOLE") !== "off";

export const app = new App<State>()
  .use(requestId)
  // ---- OIDC ----
  .get("/.well-known/openid-configuration", () => Response.json(discoveryDocument(ISSUER)))
  .get("/jwks", async () => Response.json(await jwks()))
  .get("/authorize", async (ctx) => {
    const req = parseAuthRequest(ctx.url.searchParams);          // throws → 400
    const k = store.knobs();
    const id = ctx.url.searchParams.get("persona") ?? k.autoPersona;   // autoPersona = headless
    if (!id) return ctx.render(<Picker search={ctx.url.search} personas={store.listPersonas()} />);

    const persona = store.getPersona(id);
    if (!persona) return new Response("unknown persona", { status: 400 });

    const target = new URL(req.redirectUri);
    const err = k.forceAuthorizeError ?? persona.authorizeError;       // global error wins
    if (err) {
      target.searchParams.set("error", err.error);
      if (err.error_description) target.searchParams.set("error_description", err.error_description);
    } else {
      target.searchParams.set("code", issueCode(req, persona.id));
    }
    if (req.state) target.searchParams.set("state", req.state);
    return new Response(null, { status: 302, headers: { location: target.toString() } });
  })
  .post("/token", async (ctx) => {
    const { latencyMs } = store.knobs();
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));  // latency knob
    const form = await ctx.req.formData();
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return exchangeCode(ISSUER, form);
    if (grant === "refresh_token") return refresh(ISSUER, form);
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  })
  .get("/userinfo", (ctx) => userinfo(ctx.req.headers.get("authorization")));

// ---- control console (localhost-only; omit when CONSOLE=off) ----
if (consoleOn) {
  app
    .get("/console", (ctx) => ctx.render(<Console personas={store.listPersonas()} knobs={store.knobs()} />))
    .post("/console/personas", async (ctx) => { await store.createPersona(await ctx.req.formData()); return seeOther("/console"); })
    .post("/console/personas/:id/delete", async (ctx) => { await store.deletePersona(ctx.params.id); return seeOther("/console"); })
    .post("/console/knobs", async (ctx) => { await store.setKnobs(await ctx.req.formData()); return seeOther("/console"); })
    .post("/console/rotate-key", async () => { await rotateKey(); return seeOther("/console"); })
    .post("/console/reset", async () => { await store.reset(); return seeOther("/console"); });
}

app.onError((ctx) => Response.json(
  { error: "invalid_request", error_description: String(ctx.error) },
  { status: 400 },
));

if (import.meta.main) {
  await app.listen({ port: Number(new URL(ISSUER).port) || 9000 });
}
```

The `issuer` in config **must equal the origin Fresh actually serves on** (host + port), or `openid-client` rejects the discovery doc. Run it as a plain process on a fixed port and point `ISSUER` at that.

### The picker — `components/Picker.tsx`

Plain SSR. Each option is the verbatim authorize query string with `&persona=<id>` appended; clicking it re-enters `/authorize`, which now issues the code. No client JS, no form, no island.

```tsx
import type { Persona } from "../core/store.ts";

export function Picker({ search, personas }: { search: string; personas: Persona[] }) {
  return (
    <main style="max-width:32rem;margin:4rem auto;font-family:system-ui">
      <h1>Pick a persona</h1>
      <p>Selecting one issues an authorization code and returns you to the app.</p>
      <ul style="list-style:none;padding:0;display:grid;gap:.5rem">
        {personas.map((p) => (
          <li>
            <a
              href={`/authorize${search}&persona=${encodeURIComponent(p.id)}`}
              style="display:block;padding:1rem;border:1px solid #ccc;border-radius:.5rem;text-decoration:none;color:inherit"
            >
              <strong>{p.label}</strong>
              {p.description ? <div style="opacity:.7">{p.description}</div> : null}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

### Core primitives — the parts that are easy to get wrong

RS256 keypair, JWKS, and JWT signing on Web Crypto. The base64url encoding and the exact algorithm strings (`RSASSA-PKCS1-v1_5` + `SHA-256`) are the usual tripwires.

```ts
// core/keys.ts
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"],
);
const KID = crypto.randomUUID();

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export async function jwks() {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { keys: [{ ...jwk, kid: KID, use: "sig", alg: "RS256" }] };
}

export async function signJwt(payload: Record<string, unknown>) {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
```

```ts
// core/oidc.ts — PKCE S256 verification at /token
export async function verifyPkce(verifier: string, challenge: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest) === challenge; // b64url shared from keys.ts
}
```

`exchangeCode` redeems the single-use code (delete on read), resolves its bound persona from the store, checks `redirect_uri` match and `verifyPkce` when a challenge was bound, then applies knobs (TTL override, clock skew, `extraClaims`, refresh gate) and calls `signJwt` for the ID token. `refresh` re-mints for the bound persona; `userinfo` looks up the persona by opaque access token. Module-level singletons (the keypair, the code/token `Map`s, the store) are fine — this is a single-process dev tool.

Prefer not to hand-roll the JWT bits? `npm:jose` works under Deno and gives you `SignJWT` + `exportJWK`; the trade-off is one more dependency against the zero-dep Web Crypto path above.

---

## Per-tenant instances (silo model)

For the per-tenant-issuer model (each tenant brings its own realm/IdP), run **one process per tenant**. Each instance is a fully independent issuer — its own `iss`, JWKS, and **signing key**. That key isolation is free here (separate processes) and it's the property that makes the test real: a token minted by tenant A's instance won't validate against tenant B's JWKS, so you catch issuer/signature confusion instead of getting false confidence from a shared key.

### CLI

```
deno run -A main.tsx --tenant acme   --port 9001
deno run -A main.tsx --tenant globex --port 9002
```

`--port` distinguishes the issuer (`http://localhost:{port}`). `--tenant` makes the instance tenant-aware beyond that:

- **Injects a tenant claim** (`tenant_id: "acme"`) into every token, so tokens are self-describing. Rename it with `--tenant-claim org_id`.
- **Namespaces the store file** (`.oidc-personas.acme.json`) so instances don't clobber each other — or pass `--store memory` for deterministic, fully isolated runs.
- **Badges the console** so `localhost:9001/console` clearly belongs to acme.

In a pure silo model the real tenant signal is `iss`, not the claim — your app maps issuer → tenant. The injected claim is a convenience for assertions and for apps that also carry an org claim.

### Startup parsing (std, no deps)

Replaces the env-based `ISSUER`/store bootstrap in `main.tsx`:

```ts
import { parseArgs } from "@std/cli/parse-args";
import { presets } from "./core/presets.ts";
import { createStore } from "./core/store.ts";

const flags = parseArgs(Deno.args, {
  string: ["tenant", "port", "tenant-claim", "store"],
  default: { port: "9000", "tenant-claim": "tenant_id" },
});

const ISSUER = `http://localhost:${flags.port}`;
const tenant = flags.tenant ?? null;
const injectedClaims = tenant ? { [flags["tenant-claim"]]: tenant } : {};
const storePath = flags.store === "memory"
  ? "memory"
  : `./.oidc-personas${tenant ? "." + tenant : ""}.json`;

const store = createStore(storePath, presets);   // factory; single-tenant default is just createStore() with the default path
```

`injectedClaims` is a **fixed instance property, not a knob** — it's the tenant's identity, so it's merged at mint and survives a console reset, unlike the resettable `extraClaims` knob:

```ts
{ ...persona.claims, ...injectedClaims, ...knobs.extraClaims }
//                    ^ tenant identity    ^ still overridable for testing
```

(This is also why `core/store.ts` should expose a `createStore(path, presets)` factory rather than a hard singleton — the path has to be injectable per instance.)

### Launching several

```bash
deno run -A main.tsx --tenant acme   --port 9001 &
deno run -A main.tsx --tenant globex --port 9002 &
```

Or a small launcher that reads a `tenant:port` list and spawns children with `Deno.Command` — same effect, cross-platform, one task.

### What it exercises

Point each tenant context in your SaaS at the matching issuer (acme-subdomain → :9001, globex → :9002) and you're testing the real silo plumbing: per-tenant issuer/JWKS resolution and multiple `iss`/`aud` handling. The valuable case is the **cross-tenant negative test** — take a valid token from :9001 and assert your app accepts it in the acme context and **rejects** it in the globex context. Different signing keys make that rejection genuine even if your issuer-routing has a hole.

Still not modeled: a user in several tenants switching active org mid-session (each instance is one tenant — re-auth against the next issuer to switch), and SSO/IdP federation handshakes.

> Prefer not to run N processes? The single-process alternative is path-prefixed issuers — one port, `iss = http://localhost:9000/t/{tenant}`, endpoints namespaced under `/t/{tenant}`, **with a distinct signing key per tenant** (don't share — that's the bug you're testing for). More wiring; same guarantees.

---

## `openid-client` interop checklist

What the provider must get right for the "just point it at the URL" promise to hold:

1. Discovery served at `<issuer>/.well-known/openid-configuration`; `issuer` field exactly equals the issuer the client was given; all endpoints absolute.
2. `token_endpoint_auth_methods_supported` includes `"none"` → public PKCE client redeems without a secret.
3. `code_challenge_methods_supported` includes `"S256"`; provider verifies the challenge at `/token`.
4. ID token `iss`/`aud`/`exp`/`iat` correct; `aud` == request `client_id`; `nonce` echoed when sent.
5. ID token signed RS256 with a `kid` present in `/jwks`.
6. `state` echoed on the authorize redirect.

Concrete consumer side (panva `openid-client` v6 functional API — confirm against your installed version):

```ts
import * as oidc from "openid-client";

const issuer = new URL("http://localhost:9000");
const clientId = "anything"; // open model: any value works

const config = await oidc.discovery(issuer, clientId, undefined, undefined, {
  execute: [oidc.allowInsecureRequests], // localhost http; drop when serving https
});

// build authorization URL (PKCE), redirect the browser, handle the callback,
// then: const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, { pkceCodeVerifier, expectedNonce });
```

The one client-side gotcha that isn't the provider's fault: `openid-client` enforces HTTPS by default, so over plain `http://localhost` the consumer must opt in with `allowInsecureRequests`. Serve the provider over HTTPS (or behind a TLS dev proxy) and even that disappears.

---

## Open decisions

Real forks — pick before implementing:

1. **Client model.** Default open (accept anything). Alternatives: pre-registered allow-list, or Dynamic Client Registration (RFC 7591) so clients self-register. Open is simplest and matches "no intervention"; DCR is more faithful to a real IdP.
2. **Signing alg.** RS256 (max interop, default) vs ES256 (smaller keys, modern). Both trivial under Web Crypto.
3. **Key lifecycle.** Ephemeral per-process (default) vs fixed key from config for reproducible tokens across restarts.
4. **Expiry coverage.** Both ship as presets now: `expiring` (short-but-valid → refresh) and `expired` (born past `exp` → validation failure). Keep both or drop one.
5. **Access token shape.** Opaque + in-memory map (default, simplest `/userinfo`) vs self-contained JWT.
6. **Scope handling.** Always include all persona claims (default) vs filter claims by requested scope (`profile`/`email`) to mimic real providers.
7. **Persona persistence.** JSON file (default — inspectable, survives restarts) vs `"memory"` (deterministic, nothing persists) vs Deno KV (atomic/concurrent). Presets always re-seed on boot regardless.
8. **Preset mutability.** Presets read-only, custom editable (default). Or allow editing presets too — then "reset" re-seeds them from code.
9. **Console interactivity.** Plain forms with full-page reload (default, zero-build) vs an island / Fresh Partials for live, no-reload updates.
10. **Key-rotation grace.** On rotate, keep the previous public key in JWKS for a window (in-flight tokens still verify) vs drop it immediately (forces JWKS refetch / tests stale-`kid` rejection).
11. **Multitenancy model.** Tenant-as-claim (single instance, scope on `org_id`/`tenant_id` — default) vs per-tenant issuer (one instance per tenant via `--tenant`/`--port`, distinct `iss` + signing key each). Pick the one your SaaS actually uses; they exercise entirely different parts of the auth layer.
