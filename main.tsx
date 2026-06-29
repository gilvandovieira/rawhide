/** @jsxImportSource preact */
// Rawhide Identity — Fresh 2 adapter. Thin HTTP surface over the framework-agnostic
// OIDC core in ./core. Run it directly: `deno task start` (or `deno task dev`).
import { App, createDefine } from "fresh";
import { parseArgs } from "@std/cli/parse-args";
import type { ComponentType } from "preact";

import { Picker } from "./components/Picker.tsx";
import { Console } from "./components/Console.tsx";
import { createStore } from "./core/store.ts";
import { presets } from "./core/presets.ts";
import { createProvider } from "./core/oidc.ts";
import type { Mode } from "./core/types.ts";

interface State {
  requestId: string;
  theme: Mode;
}
const define = createDefine<State>();

const THEME_RE = /(?:^|;\s*)theme=(light|dark)/;
const readTheme = (cookie: string | null): Mode => (THEME_RE.exec(cookie ?? "")?.[1] as Mode) ?? "dark";

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

// Static asset serving. Fresh 2.3's staticFiles() reads from a build cache that only
// exists after a build/dev-builder run; this project is intentionally build-step-free, so we
// stream files straight from ./static (resolved relative to this file, not the cwd).
const STATIC_DIR = new URL("./static/", import.meta.url);
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};
const contentType = (path: string) =>
  CONTENT_TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const serveStatic = define.middleware(async (ctx) => {
  if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return ctx.next();
  const rel = decodeURIComponent(ctx.url.pathname).replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) return ctx.next();
  const fileUrl = new URL(rel, STATIC_DIR);
  if (!fileUrl.href.startsWith(STATIC_DIR.href)) return ctx.next(); // no path traversal out of static/
  try {
    const data = await Deno.readFile(fileUrl);
    return new Response(data, {
      headers: { "content-type": contentType(rel), "cache-control": "public, max-age=3600" },
    });
  } catch {
    return ctx.next(); // not a static file — fall through to routes
  }
});

const USAGE = `Rawhide Identity — local OIDC test provider

  deno task start [--port 9000] [--tenant acme] [--store memory|<path>] [--tenant-claim tenant_id]

Flags
  --port <n>           Port to serve on (default 9000). Issuer is http://localhost:<port>.
  --tenant <id>        Tenant-aware mode: inject a tenant claim + namespace the store file.
  --tenant-claim <k>   Claim name for --tenant (default "tenant_id").
  --store memory|<p>   Persona store backing: "memory" (nothing persists) or a JSON path.
  --issuer <url>       Override the issuer origin (else http://localhost:<port>).
  --help               Show this help.

Env
  ISSUER=<url>         Same as --issuer.
  CONSOLE=off          Disable the /console control surface (do this anywhere shared).`;

/** Document shell: fonts, favicon, viewport, theme-aware page background. */
function Document({ Component, state }: { Component: ComponentType; state: State }) {
  const bg = state.theme === "light" ? "#EEE2CD" : "#140E08";
  return (
    <html lang="en" data-theme={state.theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Rawhide Identity</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bitter:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/brand/icon-32.png" />
        <link rel="apple-touch-icon" href="/brand/rawhide-apple-touch.png" />
      </head>
      <body style={`margin:0;background:${bg}`}>
        <Component />
      </body>
    </html>
  );
}

function Landing({ issuer, tenant, consoleOn }: { issuer: string; tenant?: string; consoleOn: boolean }) {
  const link = "color:#E8C679;text-decoration:none;font-family:'IBM Plex Mono',monospace";
  const row = "padding:8px 0;border-bottom:1px solid #34281B;font:13px 'IBM Plex Mono',monospace;color:#B6A88E";
  return (
    <main style="min-height:100vh;color:#F0E7D4;font-family:'IBM Plex Sans',system-ui,sans-serif;max-width:620px;margin:0 auto;padding:64px 30px">
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:24px">
        <img src="/brand/rawhide-hat.png" alt="" style="width:56px;height:56px;object-fit:contain" />
        <div>
          <div style="font:700 24px Bitter,serif;color:#E8C679;line-height:1">Rawhide Identity</div>
          <div style="font:600 10px 'IBM Plex Sans';letter-spacing:1.6px;text-transform:uppercase;color:#7E7059;margin-top:5px">
            OIDC test identity provider
          </div>
        </div>
      </div>
      <p style="font:14.5px/1.6 'IBM Plex Sans';color:#B6A88E">
        Issuer <code style="font-family:'IBM Plex Mono';color:#E8C679">{issuer}</code>
        {tenant
          ? (
            <>
              · tenant <code style="font-family:'IBM Plex Mono';color:#E8C679">{tenant}</code>
            </>
          )
          : null}
      </p>
      <div style="margin-top:22px">
        <div style={row}>
          GET <a style={link} href="/.well-known/openid-configuration">/.well-known/openid-configuration</a>
        </div>
        <div style={row}>
          GET <a style={link} href="/jwks">/jwks</a>
        </div>
        <div style={row}>
          GET <span style="color:#F0E7D4">/authorize</span> → persona picker
        </div>
        <div style={row}>
          POST <span style="color:#F0E7D4">/token</span> · GET <span style="color:#F0E7D4">/userinfo</span>
        </div>
        {consoleOn
          ? (
            <div style={row}>
              GET <a style={link} href="/console">/console</a> → control console
            </div>
          )
          : null}
      </div>
    </main>
  );
}

if (import.meta.main) {
  const flags = parseArgs(Deno.args, {
    string: ["tenant", "port", "tenant-claim", "store", "issuer"],
    boolean: ["help"],
    default: { port: "9000", "tenant-claim": "tenant_id" },
  });

  if (flags.help) {
    console.log(USAGE);
    Deno.exit(0);
  }

  const port = Number(flags.port) || 9000;
  const issuer = flags.issuer ?? Deno.env.get("ISSUER") ?? `http://localhost:${port}`;
  const host = new URL(issuer).host;
  const tenant = flags.tenant ?? null;
  const tenantClaim = flags["tenant-claim"];
  const injectedClaims = tenant ? { [tenantClaim]: tenant } : {};
  const storePath = flags.store === "memory"
    ? "memory"
    : (flags.store ?? `./.oidc-personas${tenant ? "." + tenant : ""}.json`);
  const consoleOn = Deno.env.get("CONSOLE") !== "off";

  const store = await createStore(storePath, presets);
  const provider = await createProvider({ issuer, store, injectedClaims });

  const requestId = define.middleware(async (ctx) => {
    ctx.state.requestId = ctx.req.headers.get("x-request-id") ?? crypto.randomUUID();
    ctx.state.theme = readTheme(ctx.req.headers.get("cookie"));
    const res = await ctx.next();
    res.headers.set("x-request-id", ctx.state.requestId);
    return res;
  });

  // Permissive CORS so a browser-based relying party / harness on another origin can
  // reach the JSON surface (discovery, jwks, token, userinfo). Dev tool — origin "*".
  const cors = define.middleware(async (ctx) => {
    if (ctx.req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const res = await ctx.next();
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  });

  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

  const app = new App<State>()
    .appWrapper(Document)
    .use(requestId)
    .use(cors)
    .use(serveStatic)
    // ---- theme toggle (sets a cookie, redirects back) ----
    .get("/theme", (ctx) => {
      const set: Mode = ctx.url.searchParams.get("set") === "light" ? "light" : "dark";
      const to = ctx.url.searchParams.get("to") ?? "/";
      const safeTo = to.startsWith("/") && !to.startsWith("//") ? to : "/"; // same-origin only
      return new Response(null, {
        status: 303,
        headers: { location: safeTo, "set-cookie": `theme=${set}; Path=/; Max-Age=31536000; SameSite=Lax` },
      });
    })
    // ---- OIDC surface ----
    .get("/", (ctx) => ctx.render(<Landing issuer={issuer} tenant={tenant ?? undefined} consoleOn={consoleOn} />))
    .get("/.well-known/openid-configuration", () => json(provider.discovery()))
    .get("/jwks", () => json(provider.jwks()))
    .get("/authorize", (ctx) => {
      let result;
      try {
        result = provider.authorize(ctx.url.searchParams);
      } catch (e) {
        return json({ error: "invalid_request", error_description: e instanceof Error ? e.message : String(e) }, 400);
      }
      if (result.type === "picker") {
        return ctx.render(
          <Picker
            search={ctx.url.search}
            personas={store.listPersonas()}
            tenant={tenant ?? undefined}
            issuer={host}
            mode={ctx.state.theme}
          />,
        );
      }
      if (result.type === "error") {
        return json({ error: "invalid_request", error_description: result.message }, result.status);
      }
      return redirect(result.location);
    })
    .post("/token", async (ctx) => {
      const { latencyMs } = store.knobs();
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const { status, body } = await provider.token(await ctx.req.formData());
      return json(body, status);
    })
    .get("/userinfo", (ctx) => {
      const { status, body } = provider.userinfo(ctx.req.headers.get("authorization"));
      return json(body, status);
    });

  // ---- control console (localhost-only; omit when CONSOLE=off) ----
  if (consoleOn) {
    const seeOther = (loc: string) => redirect(loc, 303);
    const consoleErr = (e: unknown) =>
      json({ error: "console_error", error_description: e instanceof Error ? e.message : String(e) }, 400);

    app
      .get("/console", (ctx) =>
        ctx.render(
          <Console
            personas={store.listPersonas()}
            knobs={store.knobs()}
            tenant={tenant ?? undefined}
            issuer={host}
            store={storePath}
            mode={ctx.state.theme}
          />,
        ))
      .post("/console/personas", async (ctx) => {
        try {
          await store.createPersona(await ctx.req.formData());
        } catch (e) {
          return consoleErr(e);
        }
        return seeOther("/console");
      })
      .post("/console/personas/:id/delete", async (ctx) => {
        try {
          await store.deletePersona(ctx.params.id);
        } catch (e) {
          return consoleErr(e);
        }
        return seeOther("/console");
      })
      .post("/console/knobs", async (ctx) => {
        await store.setKnobs(await ctx.req.formData());
        return seeOther("/console");
      })
      .post("/console/rotate-key", async () => {
        await provider.rotateKey();
        return seeOther("/console");
      })
      .post("/console/reset", async () => {
        await store.reset();
        return seeOther("/console");
      });
  }

  console.log(
    `%cRawhide Identity%c  ${issuer}${tenant ? `  ·  tenant=${tenant}` : ""}`,
    "color:#E3B45C;font-weight:bold",
    "color:inherit",
  );
  console.log(`  store    ${storePath}`);
  console.log(`  console  ${consoleOn ? `${issuer}/console` : "disabled (CONSOLE=off)"}`);
  await app.listen({ port });
}
