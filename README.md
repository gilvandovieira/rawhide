# Rawhide Identity

**`@gilvandovieira/rawhideidentity`** — a drop-in **OpenID Connect provider for local dev and
integration tests**, built on **Deno + Fresh 2.3**. A relying party (RP) redirects the browser
here, the human picks a **persona** (a test scenario), and the provider mints conformant
RS256-signed tokens and bounces back. Point `openid-client` at the issuer URL and it just works —
no pre-registration, no secrets, no real users.

> Strictly a localhost/dev tool. It will happily impersonate an admin for anyone who asks.

```bash
deno task start                 # serve on http://localhost:9000
deno task dev                   # same, with --watch reload
```

Then send your app's login through `http://localhost:9000` (discovery at
`/.well-known/openid-configuration`). No build step — it runs straight from `main.tsx`.

## Quick start

```bash
deno task start --port 9000               # single instance
deno task start --tenant acme --port 9001 # tenant-aware (injects tenant_id, namespaces the store)
deno task start --store memory            # nothing persists — deterministic, every run starts at presets
deno task start --help                    # all flags
```

Open in a browser:

- **`/`** — landing page (endpoint index)
- **`/authorize?…`** — the persona **picker** (where RPs land)
- **`/console`** — the control **console**: author personas, flip behaviour knobs, rotate the key

### CLI flags

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `9000` | Port to serve on. Issuer becomes `http://localhost:<port>`. |
| `--tenant <id>` | — | Tenant-aware mode: inject a tenant claim and namespace the store file. |
| `--tenant-claim <k>` | `tenant_id` | Claim name used for `--tenant`. |
| `--store memory\|<path>` | `./.oidc-personas[.<tenant>].json` | Persona/knob store backing. `memory` persists nothing. |
| `--issuer <url>` | `http://localhost:<port>` | Override the issuer origin. |

Environment: `ISSUER=<url>` (same as `--issuer`), `CONSOLE=off` (disable `/console` entirely).

## HTTP surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/openid-configuration` | Discovery metadata |
| GET | `/jwks` | Public signing keys (RS256) |
| GET | `/authorize` | Persona picker → issues an auth code (or `&persona=<id>` to skip the picker) |
| POST | `/token` | `authorization_code` (PKCE) and `refresh_token` grants |
| GET | `/userinfo` | Claims for a Bearer access token |
| GET | `/theme?set=light\|dark&to=<path>` | Sets the UI theme cookie, redirects back |
| GET/POST | `/console`, `/console/*` | Control console (gated off with `CONSOLE=off`) |

The JSON surface sends permissive CORS (`*`) and answers preflight, so a browser-based RP on
another origin can drive the full flow.

## Personas & knobs

A **persona** is a scenario, not just a user (a valid user, an admin, an about-to-expire token,
a denied-consent flow…). Ten presets seed the store on first boot; create your own in the console
(raw-JSON claims, must include `sub`). Presets are read-only; custom personas are editable/deletable
and persist to the store file.

**Knobs** are global runtime dials applied at mint time (knob beats persona): `autoPersona`
(skip the picker — headless/CI), `idTokenTTLOverride`, `clockSkewSeconds`, `latencyMs`,
`forceAuthorizeError`, `refreshEnabled`, `extraClaims`. Plus two actions: **rotate signing key**
(new `kid`, previous kept for a grace window) and **reset** (clear custom personas + default knobs).

## Theming

Both surfaces ship a **leather/gold** theme in light and dark. Use the toggle in the header (it
sets a cookie via `/theme` — zero client JS) or pass `mode` to the components directly. Dark is the
default.

## `openid-client` note

`openid-client` enforces HTTPS by default; over plain `http://localhost` opt in with
`allowInsecureRequests` (or serve the provider behind a TLS dev proxy).

## Project layout

```
.
├── deno.json              # manifest: imports (fresh/preact/@std/cli), tasks, JSX config
├── main.tsx               # Fresh App — HTTP surface, CLI args, theme cookie, static serving (adapter)
├── core/                  # framework-agnostic OIDC core (no Fresh imports)
│   ├── oidc.ts            #   createProvider: discovery, authorize, token/exchange/refresh, userinfo, PKCE
│   ├── keys.ts            #   RS256 keypair + JWKS + JWT signing (Web Crypto), rotatable
│   ├── store.ts           #   createStore: seeded persona store + knobs (JSON file | memory)
│   ├── knobs.ts           #   Knobs defaults + FormData parsing
│   ├── presets.ts         #   the ten seed personas
│   ├── types.ts           #   Persona, Knobs, Mode + scenario/chips helpers
│   └── theme.ts           #   leather/gold tokens (light + dark) → CSS variables
├── components/            # Fresh/Preact SSR screens (zero islands)
│   ├── Picker.tsx         #   persona picker (RP lands here)
│   ├── Console.tsx        #   control console (plain forms)
│   └── ThemeToggle.tsx    #   light/dark switch (cookie-based, zero-JS)
└── static/brand/          # hat logo + favicon/app-icon set (served at /brand/*)
```

`deno.json` exposes two entry points: `.` runs the provider; `./core` exports the
framework-agnostic primitives (`createProvider`, `createStore`, the OIDC functions and types) for
embedding the issuer in your own process.

## Specs & roadmap

- [`rawhideidentity.spec.md`](./rawhideidentity.spec.md) — the provider design (this package).
- [`rawhide-harness.spec.md`](./rawhide-harness.spec.md) — `@gilvandovieira/rawhideharness`, a
  drop-in `<rawhide-harness>` Web Component that drives this provider and inspects the tokens.
  **Planned — not yet implemented.**
