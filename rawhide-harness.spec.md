# rawhide-harness

**`@gilvandovieira/rawhideharness`** — a drop-in **Web Component** that drives and inspects an [`@gilvandovieira/rawhideidentity`](./rawhideidentity.spec.md) instance, so anyone integrating OIDC can test their relying-party (RP) side against a fake IdP without writing client code.

```html
<rawhide-harness server="localhost:9999"></rawhide-harness>
```

If rawhideidentity is the instrumented **provider**, this is the instrumented **client** — the RP-side counterpart. It runs a real Authorization Code + PKCE flow against `server`, then renders an inspector (decoded ID token, claims, signature/claim validation, access token, userinfo) and emits the tokens as DOM events so a host app can wire real behavior.

---

## Feasibility

**Possible — yes.** It works because of three rawhideidentity design choices, and it carries one inherent constraint plus a few small provider additions.

### Why it's possible

- **Public client + PKCE + `token_endpoint_auth_methods: none`.** The browser can perform the `code → token` exchange itself (`POST /token` with the `code_verifier`, no secret). No backend, no server component. This is the load-bearing enabler — a confidential-client-only provider could not be driven by a pure front-end widget.
- **Open client model.** The component self-assigns a `client_id` and `redirect_uri`; nothing needs pre-registration. Zero setup beyond the `server` attribute.
- **Discovery.** Everything (endpoints, JWKS, supported algs) comes from `<server>/.well-known/openid-configuration`, so `server` really is the only required input.

### The one inherent constraint

You **cannot avoid a browser navigation** for a faithful test. `/authorize` issues the code via a `302`; a cross-origin `fetch` can't read an opaque redirect's `Location`, and the picker is HTML, not JSON. So the component must do a real navigation — a **popup** (default) or a **top-level redirect**. Even "headless" (persona fixed in the URL) still round-trips through `/authorize` and back; it just doesn't pause on the picker. The only way to skip the navigation entirely is a non-OIDC mint backdoor (below), which tests token *consumption* but not your *login integration* — a different tool, not this component.

### Additions required in rawhideidentity

These are small, and all localhost-dev-only. They should be folded back into the provider spec.

1. **CORS on the JSON surface.** The component fetches discovery, `/jwks`, `/token`, and `/userinfo` from a different origin than `localhost:9999`. The provider must send permissive CORS — `Access-Control-Allow-Origin: *` is fine for a dev tool. The token `POST` (urlencoded) is a CORS-safelisted request (no preflight), but `/userinfo` sends an `Authorization` header → preflight, so the provider must answer `OPTIONS` and include `Access-Control-Allow-Headers: authorization`. Fresh ships CORS middleware; one `app.use(cors({ origin: "*" }))` covers it.
2. **A machine-readable personas list.** `GET /personas → [{ id, label, description }]` (labels only, no claims/secrets). Personas currently live only in the HTML console; the component needs JSON to render its picker and validate ids.
3. **A postMessage relay** (popup flow). `GET /relay` returns a tiny HTML page that forwards the callback query to `window.opener` and closes — so the consumer hosts **no** callback file. Optional if you instead accept a consumer-hosted callback page or the redirect-takes-over-the-page mode.

### Optional, separate from the component

4. **A direct mint backdoor.** `POST /test/mint { persona, client_id }` → tokens, skipping the whole redirect dance. Great for programmatic/CI token-shape tests, but it bypasses the real flow, so it validates token handling only. Belongs in test *code*, not in a rendered component.

---

## Element API

A custom element. All attributes are strings (custom-element convention).

| Attribute | Default | Meaning |
|---|---|---|
| `server` (required) | — | Provider origin. Bare `host:port` is accepted; `http://` is assumed when no scheme is given. |
| `persona` | — | Persona id to use. Omit to show the provider's picker inside the popup. When set, the component appends `&persona=<id>` to the authorize request and skips the picker. |
| `client-id` | `rawhide-harness` | The `client_id` sent (and the expected `aud`). |
| `scope` | `openid profile email` | Requested scopes. |
| `flow` | `popup` | `popup` (embeddable) or `redirect` (takes over the host page; resumes via `sessionStorage`). |
| `auto` | absent | Present ⇒ run on connect. Note: popups need a user gesture, so `auto` pairs best with `flow="redirect"`; otherwise the built-in button (a gesture) is the reliable trigger. |
| `redirect-uri` | provider `/relay` | Override the callback target. |
| `headless` | absent | Render nothing; emit events only (no inspector UI). |

**Events** (`CustomEvent`, bubbling + composed):

- `rawhide:tokens` — `detail: { idToken, accessToken, refreshToken?, claims, userinfo?, valid: boolean }`
- `rawhide:error` — `detail: { stage, message }` where `stage ∈ {discovery, authorize, token, validate, userinfo}`

**Methods:** `el.run()` triggers the flow programmatically; `el.reset()` clears state.

**Styling:** the inspector renders in Shadow DOM; expose `::part(panel | token | claim | status)` for host theming.

---

## Flow

```
host page                  <rawhide-harness>            popup            rawhideidentity
   │  click / auto ───────────▶│                          │                    │
   │                           │  GET /.well-known + /personas (fetch, CORS) ──▶│
   │                           │◀───────── discovery + persona list ───────────│
   │                           │  window.open(authorize URL) ─▶│  GET /authorize?…&persona ─▶│
   │                           │                          │◀── 302 /relay?code&state ──│
   │                           │◀── postMessage{code,state} (relay) ──│  (popup closes)
   │                           │  POST /token (code+verifier, CORS) ───────────▶│
   │                           │◀──────────── id_token + access_token ─────────│
   │                           │  GET /jwks (CORS) → verify RS256 + iss/aud/exp/nonce
   │                           │  GET /userinfo (CORS, Bearer) ────────────────▶│
   │◀─ rawhide:tokens event ───│  render inspector panel                       │
```

The component instance holds `state`, `nonce`, and the PKCE `verifier` in instance fields across the popup — only the popup navigates, so no storage is needed. In `flow="redirect"` the whole page navigates away, so those are persisted in `sessionStorage` and restored when the page reloads with `?code=`.

---

## Implementation sketch

Vanilla custom element + Shadow DOM, zero dependencies. (Lit is a reasonable ergonomic upgrade if the UI grows.) Same Web Crypto `b64url` / PKCE primitives as the provider, run in reverse to verify.

```ts
class RawhideHarness extends HTMLElement {
  #state = ""; #nonce = ""; #verifier = "";

  connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML = this.hasAttribute("headless")
      ? "" : `<button part="panel">Test login →</button><div id="out"></div>`;
    this.shadowRoot!.querySelector("button")?.addEventListener("click", () => this.run());
    if (this.hasAttribute("auto")) this.run();
  }

  get #origin() {
    const s = this.getAttribute("server") ?? "";
    return /^https?:\/\//.test(s) ? s : `http://${s}`;
  }

  async run() {
    try {
      const meta = await (await fetch(`${this.#origin}/.well-known/openid-configuration`)).json();
      this.#state = crypto.randomUUID();
      this.#nonce = crypto.randomUUID();
      this.#verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.#verifier)));

      const redirectUri = this.getAttribute("redirect-uri") ?? `${this.#origin}/relay`;
      const url = new URL(meta.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: this.getAttribute("client-id") ?? "rawhide-harness",
        redirect_uri: redirectUri,
        scope: this.getAttribute("scope") ?? "openid profile email",
        state: this.#state, nonce: this.#nonce,
        code_challenge: challenge, code_challenge_method: "S256",
        ...(this.getAttribute("persona") ? { persona: this.getAttribute("persona")! } : {}),
      }).toString();

      const { code } = await this.#authorize(url, redirectUri);          // popup or redirect
      const tokens = await this.#exchange(meta.token_endpoint, code, redirectUri);
      const claims = await this.#verify(meta, tokens.id_token);          // RS256 + iss/aud/exp/nonce
      const userinfo = await this.#userinfo(meta.userinfo_endpoint, tokens.access_token);

      this.#render({ ...tokens, claims, userinfo, valid: true });
      this.dispatchEvent(new CustomEvent("rawhide:tokens", {
        bubbles: true, composed: true,
        detail: { idToken: tokens.id_token, accessToken: tokens.access_token,
                  refreshToken: tokens.refresh_token, claims, userinfo, valid: true },
      }));
    } catch (e) {
      this.dispatchEvent(new CustomEvent("rawhide:error", {
        bubbles: true, composed: true, detail: { stage: (e as any).stage, message: String(e) },
      }));
    }
  }

  #authorize(url: string, redirectUri: string): Promise<{ code: string }> {
    if (this.getAttribute("flow") === "redirect") { /* persist verifier/state, location.assign(url) */ return new Promise(() => {}); }
    return new Promise((resolve, reject) => {
      const popup = window.open(url, "rawhide", "width=460,height=640");
      const onMsg = (ev: MessageEvent) => {
        if (ev.origin !== this.#origin || ev.data?.source !== "rawhideidentity") return;
        const p = new URLSearchParams(ev.data.query);
        if (p.get("state") !== this.#state) return reject(Object.assign(new Error("state mismatch"), { stage: "authorize" }));
        if (p.get("error")) return reject(Object.assign(new Error(p.get("error")!), { stage: "authorize" }));
        window.removeEventListener("message", onMsg);
        resolve({ code: p.get("code")! });
      };
      window.addEventListener("message", onMsg);
    });
  }
  // #exchange: POST /token (urlencoded: grant_type, code, redirect_uri, client_id, code_verifier)
  // #verify:   fetch /jwks → importKey(jwk) → crypto.subtle.verify("RSASSA-PKCS1-v1_5") + check iss/aud/exp/nonce
  // #userinfo: fetch /userinfo with Authorization: Bearer
}
customElements.define("rawhide-harness", RawhideHarness);
```

Provider-side relay page (the addition to rawhideidentity):

```html
<!-- GET /relay -->
<!doctype html><meta charset=utf-8><script>
  if (window.opener) {
    window.opener.postMessage({ source: "rawhideidentity", query: location.search }, "*");
    window.close();
  } else { document.body.textContent = "open this via the harness popup"; }
</script>
```

`targetOrigin: "*"` is acceptable here — localhost dev tool, the `code` is single-use and PKCE-bound. Tighten by passing an expected opener origin as a `/relay` param if you want.

---

## Framework interop

Because it's a custom element with string attributes, it drops into anything:

- **Plain HTML:** `<script type="module" src="https://esm.sh/jsr/@gilvandovieira/rawhideharness"></script>` then place the tag. Importing the module registers the element.
- **React:** attributes are strings, so it works directly; for the events, attach via a `ref` + `addEventListener` (or natively in React 19+).
- **Vue / Svelte / Angular:** native custom-element support; bind attributes and `@rawhide:tokens` / `on:` listeners as usual.

Published on JSR as `@gilvandovieira/rawhideharness`; a single default import has the side effect of defining `rawhide-harness`.

---

## Non-goals

- Not for production auth. It impersonates whoever the provider will mint — strictly a localhost/dev testing aid.
- No token storage, session management, or silent renew. It runs a flow and shows you the result; persistence is the host app's job.
- Single provider per element instance. Multitenancy (silo) testing = one element per `server` (point each at the matching rawhideidentity instance/port).

---

## Open decisions

1. **Component model.** Web Component / custom element (default — portable across frameworks) vs a Preact/Fresh component (tighter for that ecosystem, but not drop-in elsewhere).
2. **Default flow.** `popup` (embeddable, needs the relay, needs a gesture) vs `redirect` (works with `auto`, but takes over the host page and needs `sessionStorage` resume).
3. **Callback strategy.** Provider `/relay` (zero consumer config — default) vs consumer-hosted callback file vs same-page redirect detection.
4. **Validation locus.** Verify signature + claims inside the component and surface a status (default — useful for testing) vs emit raw tokens and leave validation to the host.
5. **UI surface.** Built-in Shadow DOM inspector (default) vs `headless` events-only vs slotted/`::part` theming as the primary mode.
6. **Provider mint backdoor.** Add `POST /test/mint` for non-UI/CI tests (fast, but bypasses the real flow) or keep the component as the only path (always exercises the full integration).
