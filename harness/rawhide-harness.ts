/**
 * `@gilvandovieira/rawhideharness`
 *
 * A drop-in Web Component that drives and inspects a `@gilvandovieira/rawhideidentity`
 * instance. It runs a real Authorization Code + PKCE flow against `server`, verifies the
 * tokens (RS256 + iss/aud/exp/nonce), and renders an inspector — so you can test your
 * relying-party integration against a fake IdP without writing any client code.
 *
 *   <rawhide-harness server="localhost:9000"></rawhide-harness>
 *
 * Importing this module registers the `<rawhide-harness>` element as a side effect.
 * Zero dependencies — vanilla custom element + Shadow DOM + Web Crypto.
 */

type Stage = "discovery" | "authorize" | "token" | "validate" | "userinfo";
type Flow = "popup" | "redirect";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface PersonaSummary {
  id: string;
  label: string;
  description?: string;
  scenario?: string;
}

type Claims = Record<string, unknown>;

interface StagedError extends Error {
  stage: Stage;
}

const SESSION_KEY = "rawhide:flow";

// --- base64url helpers -------------------------------------------------------
const bytesToB64url = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const decodeSegment = (seg: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));

const staged = (stage: Stage, e: unknown): StagedError => {
  const err = (e instanceof Error ? e : new Error(String(e))) as StagedError;
  err.stage = stage;
  return err;
};

// --- inspector styling (self-contained leather/gold, Shadow DOM) -------------
const STYLE = `
:host { all: initial; display: block; font-family: 'IBM Plex Sans', system-ui, sans-serif; color: #F0E7D4; }
* { box-sizing: border-box; }
.panel { background: #1C140D; border: 1px solid #34281B; border-radius: 14px; padding: 18px 20px; max-width: 640px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.title { font: 700 16px 'Bitter', serif; color: #E8C679; }
.sub { font: 600 9px 'IBM Plex Sans'; letter-spacing: 1.4px; text-transform: uppercase; color: #7E7059; }
.spacer { flex: 1; }
.pill { display: inline-flex; align-items: center; gap: 6px; font: 600 11px 'IBM Plex Mono'; border-radius: 20px; padding: 4px 11px; border: 1px solid #3A2C1D; color: #B6A88E; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.ok { color: #A6CE6A; border-color: #2f3d20; }
.bad { color: #E87A5A; border-color: #4A2E26; }
.run { color: #E3B45C; border-color: #4a3a1d; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
button, select { font: 600 12.5px 'IBM Plex Sans'; border-radius: 8px; cursor: pointer; }
button.go { height: 36px; padding: 0 16px; border: none; background: #E3B45C; color: #1A1208; }
button.go:disabled { opacity: .6; cursor: default; }
button.ghost { height: 36px; padding: 0 14px; border: 1px solid #3A2C1D; background: #241A12; color: #F0E7D4; }
select { height: 36px; padding: 0 9px; border: 1px solid #34281B; background: #140E08; color: #F0E7D4; font-family: 'IBM Plex Mono'; }
.section { font: 600 10px 'IBM Plex Sans'; letter-spacing: .8px; text-transform: uppercase; color: #B6A88E; margin: 16px 0 8px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 5px 8px; border-bottom: 1px solid #271d13; font: 12px 'IBM Plex Mono'; vertical-align: top; }
td.k { color: #7E7059; white-space: nowrap; width: 1%; }
td.v { color: #F0E7D4; word-break: break-word; }
.tok { font: 11px/1.5 'IBM Plex Mono'; color: #B6A88E; background: #140E08; border: 1px solid #271d13; border-radius: 8px; padding: 9px 10px; word-break: break-all; margin-bottom: 8px; }
.tok b { color: #E8C679; font-weight: 600; display: block; margin-bottom: 3px; font-family: 'IBM Plex Sans'; font-size: 10px; letter-spacing: .5px; text-transform: uppercase; }
.issue { color: #E87A5A; font: 11.5px 'IBM Plex Sans'; margin: 2px 0; }
.err { color: #E87A5A; font: 12.5px 'IBM Plex Sans'; background: #241510; border: 1px solid #3A241D; border-radius: 8px; padding: 10px 12px; }
.muted { color: #7E7059; font: 11.5px 'IBM Plex Sans'; }
`;

export class RawhideHarness extends HTMLElement {
  static get observedAttributes(): string[] {
    return [
      "server",
      "persona",
      "client-id",
      "scope",
      "flow",
      "redirect-uri",
      "headless",
    ];
  }

  #state = "";
  #nonce = "";
  #verifier = "";
  #busy = false;
  #personas: PersonaSummary[] = [];
  #onMessage?: (ev: MessageEvent) => void;

  connectedCallback(): void {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.#renderShell();
    // Resume is self-detected from the sessionStorage record + ?code in the URL, so it works
    // even though the redirect drops this element's own query string (flow/persona/etc.).
    const cb = new URLSearchParams(location.search);
    const isCallback = cb.has("code") || cb.has("error");
    void this.#maybeResumeRedirect();
    if (!this.hasAttribute("headless")) void this.#loadPersonas();
    if (this.hasAttribute("auto") && !isCallback) void this.run();
  }

  disconnectedCallback(): void {
    if (this.#onMessage) {
      globalThis.removeEventListener("message", this.#onMessage);
    }
  }

  attributeChangedCallback(): void {
    if (this.isConnected && !this.hasAttribute("headless")) this.#renderShell();
  }

  // --- attribute getters -----------------------------------------------------
  get #origin(): string {
    const s = (this.getAttribute("server") ?? "").trim().replace(/\/+$/, "");
    if (!s) return "";
    return /^https?:\/\//.test(s) ? s : `http://${s}`;
  }
  get #flow(): Flow {
    return this.getAttribute("flow") === "redirect" ? "redirect" : "popup";
  }
  get #clientId(): string {
    return this.getAttribute("client-id") ?? "rawhide-harness";
  }
  get #scope(): string {
    return this.getAttribute("scope") ?? "openid profile email";
  }
  get #headless(): boolean {
    return this.hasAttribute("headless");
  }
  get #redirectUri(): string {
    const explicit = this.getAttribute("redirect-uri");
    if (explicit) return explicit;
    // popup → provider relay; redirect → come back to this very page
    return this.#flow === "redirect"
      ? location.origin + location.pathname
      : `${this.#origin}/relay`;
  }
  /** The persona to use: explicit attr, else the in-UI selection, else none (provider picker). */
  #selectedPersona(): string | null {
    const attr = this.getAttribute("persona");
    if (attr) return attr;
    const sel = this.shadowRoot?.querySelector<HTMLSelectElement>("#persona");
    return sel && sel.value ? sel.value : null;
  }

  // --- public API ------------------------------------------------------------
  reset(): void {
    this.#state = this.#nonce = this.#verifier = "";
    this.#busy = false;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
    this.#renderShell();
  }

  async run(): Promise<void> {
    if (this.#busy) return;
    if (!this.#origin) {
      this.#fail(staged("discovery", new Error('missing "server" attribute')));
      return;
    }
    this.#busy = true;
    this.#renderStatus("run", "running…");
    try {
      const meta = await this.#discovery();

      this.#state = crypto.randomUUID();
      this.#nonce = crypto.randomUUID();
      this.#verifier = bytesToB64url(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const challenge = bytesToB64url(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(this.#verifier),
        ),
      );
      const redirectUri = this.#redirectUri;

      const url = new URL(meta.authorization_endpoint);
      const persona = this.#selectedPersona();
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: this.#clientId,
        redirect_uri: redirectUri,
        scope: this.#scope,
        state: this.#state,
        nonce: this.#nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(persona ? { persona } : {}),
      }).toString();

      const { code } = await this.#authorize(url.toString(), redirectUri); // redirect flow never resolves
      await this.#finish(meta, code, redirectUri);
    } catch (e) {
      this.#fail(e as StagedError);
    } finally {
      this.#busy = false;
    }
  }

  // --- flow steps ------------------------------------------------------------
  async #discovery(): Promise<Discovery> {
    try {
      const r = await fetch(`${this.#origin}/.well-known/openid-configuration`);
      if (!r.ok) throw new Error(`discovery returned ${r.status}`);
      return await r.json() as Discovery;
    } catch (e) {
      throw staged("discovery", e);
    }
  }

  #authorize(url: string, redirectUri: string): Promise<{ code: string }> {
    if (this.#flow === "redirect") {
      try {
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            state: this.#state,
            nonce: this.#nonce,
            verifier: this.#verifier,
            redirectUri,
          }),
        );
      } catch { /* ignore */ }
      location.assign(url);
      return new Promise<{ code: string }>(() => {}); // page navigates away
    }

    return new Promise((resolve, reject) => {
      const popup = globalThis.open(url, "rawhide", "width=480,height=680");
      if (!popup) {
        reject(
          staged(
            "authorize",
            new Error(
              'popup blocked — trigger run() from a click, or use flow="redirect"',
            ),
          ),
        );
        return;
      }
      const cleanup = () => {
        clearInterval(timer);
        if (this.#onMessage) {
          globalThis.removeEventListener("message", this.#onMessage);
        }
        this.#onMessage = undefined;
        try {
          popup.close();
        } catch { /* ignore */ }
      };
      this.#onMessage = (ev: MessageEvent) => {
        if (ev.origin !== this.#origin) return;
        const data = ev.data as { source?: string; query?: string } | null;
        if (!data || data.source !== "rawhideidentity") return;
        const p = new URLSearchParams(data.query ?? "");
        cleanup();
        if (p.get("error")) {
          reject(
            staged(
              "authorize",
              new Error(
                p.get("error_description") || p.get("error") ||
                  "authorize error",
              ),
            ),
          );
        } else if (p.get("state") !== this.#state) {
          reject(staged("authorize", new Error("state mismatch")));
        } else {
          resolve({ code: p.get("code") ?? "" });
        }
      };
      globalThis.addEventListener("message", this.#onMessage);
      const timer = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(
            staged("authorize", new Error("popup closed before completing")),
          );
        }
      }, 500);
    });
  }

  /** Resume a redirect-flow run after the provider sent us back with ?code=. */
  async #maybeResumeRedirect(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const error = params.get("error");
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(SESSION_KEY);
    } catch { /* ignore */ }
    if ((!code && !error) || !stored) return;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }

    const { state, nonce, verifier, redirectUri } = JSON.parse(stored);
    this.#state = state;
    this.#nonce = nonce;
    this.#verifier = verifier;
    history.replaceState(null, "", location.origin + location.pathname); // scrub ?code from the URL

    this.#busy = true;
    this.#renderStatus("run", "resuming…");
    try {
      if (error) {
        throw staged(
          "authorize",
          new Error(params.get("error_description") || error),
        );
      }
      if (params.get("state") !== state) {
        throw staged("authorize", new Error("state mismatch"));
      }
      const meta = await this.#discovery();
      await this.#finish(meta, code ?? "", redirectUri);
    } catch (e) {
      this.#fail(e as StagedError);
    } finally {
      this.#busy = false;
    }
  }

  /** code → tokens → verify → userinfo → emit + render. */
  async #finish(
    meta: Discovery,
    code: string,
    redirectUri: string,
  ): Promise<void> {
    const tokens = await this.#exchange(meta.token_endpoint, code, redirectUri);
    const { claims, valid, issues } = await this.#verify(meta, tokens.id_token);
    const userinfo = await this.#userinfo(
      meta.userinfo_endpoint,
      tokens.access_token,
    );

    this.dispatchEvent(
      new CustomEvent("rawhide:tokens", {
        bubbles: true,
        composed: true,
        detail: {
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          claims,
          userinfo: userinfo.ok ? userinfo.data : undefined,
          valid,
        },
      }),
    );
    this.#renderResult(tokens, claims, valid, issues, userinfo);
  }

  async #exchange(
    tokenEndpoint: string,
    code: string,
    redirectUri: string,
  ): Promise<TokenResponse> {
    try {
      const r = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: this.#clientId,
          code_verifier: this.#verifier,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(
          data.error_description || data.error || `token returned ${r.status}`,
        );
      }
      return data as TokenResponse;
    } catch (e) {
      throw staged("token", e);
    }
  }

  /** Verify RS256 against JWKS and check iss/aud/exp/nonce. Soft-fails: collects issues, never aborts. */
  async #verify(
    meta: Discovery,
    idToken: string,
  ): Promise<{ claims: Claims; valid: boolean; issues: string[] }> {
    let header: Record<string, unknown>, claims: Claims;
    try {
      const parts = idToken.split(".");
      if (parts.length !== 3) throw new Error("id_token is not a JWT");
      header = decodeSegment(parts[0]);
      claims = decodeSegment(parts[1]);
    } catch (e) {
      throw staged("validate", e);
    }

    const issues: string[] = [];
    try {
      const jwks = await (await fetch(meta.jwks_uri)).json() as {
        keys: JsonWebKey[];
      };
      const jwk = jwks.keys.find((k) =>
        (k as { kid?: string }).kid === (header.kid as string)
      ) ?? jwks.keys[0];
      if (!jwk) {
        issues.push("no JWK to verify against");
      } else {
        const key = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        const [h, p, s] = idToken.split(".");
        const ok = await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          key,
          b64urlToBytes(s),
          new TextEncoder().encode(`${h}.${p}`),
        );
        if (!ok) {
          issues.push("RS256 signature did not verify");
        }
      }
    } catch (e) {
      issues.push(
        `JWKS fetch/verify failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    if (meta.issuer && claims.iss !== meta.issuer) {
      issues.push(`iss mismatch (${String(claims.iss)})`);
    }
    if (claims.aud !== this.#clientId) {
      issues.push(`aud mismatch (${String(claims.aud)} ≠ ${this.#clientId})`);
    }
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
      issues.push("token is expired (exp in the past)");
    }
    if (
      this.#nonce && claims.nonce !== undefined && claims.nonce !== this.#nonce
    ) issues.push("nonce mismatch");

    return { claims, valid: issues.length === 0, issues };
  }

  async #userinfo(
    endpoint: string,
    accessToken: string,
  ): Promise<{ ok: boolean; data?: Claims; error?: string }> {
    try {
      const r = await fetch(endpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return {
          ok: false,
          error: data.error_description || data.error ||
            `userinfo returned ${r.status}`,
        };
      }
      return { ok: true, data: data as Claims };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async #loadPersonas(): Promise<void> {
    if (!this.#origin || this.getAttribute("persona")) return;
    try {
      const r = await fetch(`${this.#origin}/personas`);
      if (!r.ok) return;
      this.#personas = await r.json();
      this.#renderShell();
    } catch { /* personas list is optional — provider picker still works */ }
  }

  // --- rendering -------------------------------------------------------------
  #emitError(err: StagedError): void {
    this.dispatchEvent(
      new CustomEvent("rawhide:error", {
        bubbles: true,
        composed: true,
        detail: { stage: err.stage, message: err.message },
      }),
    );
  }

  #fail(err: StagedError): void {
    this.#emitError(err);
    if (this.#headless || !this.shadowRoot) return;
    const out = this.shadowRoot.querySelector("#out");
    if (out) {
      out.innerHTML = `<div class="err" part="status">✗ <b>${err.stage}</b> — ${
        escapeHtml(err.message)
      }</div>`;
    }
    this.#renderStatus("bad", `failed: ${err.stage}`);
  }

  #renderShell(): void {
    if (this.#headless || !this.shadowRoot) return;
    const personaOptions =
      this.getAttribute("persona") || this.#personas.length === 0
        ? ""
        : `<select id="persona" part="control">
           <option value="">▾ provider picker</option>
           ${
          this.#personas.map((p) =>
            `<option value="${escapeAttr(p.id)}">${escapeHtml(p.label)} — ${
              escapeAttr(p.id)
            }</option>`
          ).join("")
        }
         </select>`;
    const target = this.getAttribute("persona")
      ? ` · persona=${escapeHtml(this.getAttribute("persona")!)}`
      : "";

    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="panel" part="panel">
        <div class="head">
          <span class="title">Rawhide Harness</span>
          <span class="spacer"></span>
          <span class="pill" id="status" part="status"><span class="dot"></span>idle</span>
        </div>
        <div class="muted" style="margin-bottom:12px">RP-side tester → <b style="color:#B6A88E">${
      escapeHtml(this.#origin || "(set server)")
    }</b> · ${this.#flow} flow${target}</div>
        <div class="row">
          <button class="go" id="go" part="button">Test login →</button>
          ${personaOptions}
          <button class="ghost" id="reset" part="button">Reset</button>
        </div>
        <div id="out"></div>
      </div>`;

    this.shadowRoot.querySelector("#go")?.addEventListener(
      "click",
      () => void this.run(),
    );
    this.shadowRoot.querySelector("#reset")?.addEventListener(
      "click",
      () => this.reset(),
    );
  }

  #renderStatus(kind: "ok" | "bad" | "run", label: string): void {
    const el = this.shadowRoot?.querySelector("#status");
    if (!el) return;
    el.className = `pill ${kind}`;
    el.innerHTML = `<span class="dot"></span>${escapeHtml(label)}`;
  }

  #renderResult(
    tokens: TokenResponse,
    claims: Claims,
    valid: boolean,
    issues: string[],
    userinfo: { ok: boolean; data?: Claims; error?: string },
  ): void {
    this.#renderStatus(valid ? "ok" : "bad", valid ? "valid ✓" : "invalid ✗");
    if (this.#headless || !this.shadowRoot) return;
    const out = this.shadowRoot.querySelector("#out");
    if (!out) return;

    const claimRows = Object.entries(claims)
      .map(([k, v]) =>
        `<tr part="claim"><td class="k">${escapeHtml(k)}</td><td class="v">${
          escapeHtml(fmt(v))
        }</td></tr>`
      )
      .join("");

    const issuesHtml = issues.length
      ? `<div class="section">Validation</div>${
        issues.map((i) =>
          `<div class="issue" part="status">✗ ${escapeHtml(i)}</div>`
        ).join("")
      }`
      : `<div class="section">Validation</div><div class="issue" part="status" style="color:#A6CE6A">✓ signature, iss, aud, exp${
        this.#nonce ? ", nonce" : ""
      } all check out</div>`;

    const userinfoHtml = userinfo.ok
      ? `<div class="section">/userinfo</div><table>${
        Object.entries(userinfo.data ?? {}).map(([k, v]) =>
          `<tr part="claim"><td class="k">${escapeHtml(k)}</td><td class="v">${
            escapeHtml(fmt(v))
          }</td></tr>`
        ).join("")
      }</table>`
      : `<div class="section">/userinfo</div><div class="issue" part="status">✗ ${
        escapeHtml(userinfo.error ?? "failed")
      }</div>`;

    out.innerHTML = `
      ${issuesHtml}
      <div class="section">ID token claims</div>
      <table>${claimRows}</table>
      ${userinfoHtml}
      <div class="section">Raw tokens</div>
      <div class="tok" part="token"><b>id_token</b>${
      escapeHtml(tokens.id_token)
    }</div>
      <div class="tok" part="token"><b>access_token</b>${
      escapeHtml(tokens.access_token)
    }</div>
      ${
      tokens.refresh_token
        ? `<div class="tok" part="token"><b>refresh_token</b>${
          escapeHtml(tokens.refresh_token)
        }</div>`
        : ""
    }`;
  }
}

// --- tiny formatting helpers -------------------------------------------------
const fmt = (
  v: unknown,
): string => (typeof v === "object" && v !== null
  ? JSON.stringify(v)
  : String(v));
const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const escapeAttr = (s: string): string =>
  escapeHtml(s).replaceAll("'", "&#39;");

if (!customElements.get("rawhide-harness")) {
  customElements.define("rawhide-harness", RawhideHarness);
}

export default RawhideHarness;
