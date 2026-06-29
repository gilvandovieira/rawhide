// Auto-generates docs/llms.txt following the https://llmstxt.org spec, from repo source.
// Dynamic bits (package version, persona counts/ids) are read from source so the file stays in
// sync. Runs on every commit via .githooks/pre-commit, and on demand via `deno task llms`.
import denoJson from "../deno.json" with { type: "json" };
import { presets } from "../core/presets.ts";
import { scenarioOf } from "../core/types.ts";

// Derived from the `origin` remote (git@github.com:gilvandovieira/rawhide.git) — override via env.
const REPO = Deno.env.get("RAWHIDE_REPO") ?? "https://github.com/gilvandovieira/rawhide";
const SITE = Deno.env.get("RAWHIDE_SITE") ?? "https://gilvandovieira.github.io/rawhide";
const BRANCH = "main";
const blob = (path: string) => `${REPO}/blob/${BRANCH}/${path}`;

const by: Record<"happy" | "edge" | "error", string[]> = { happy: [], edge: [], error: [] };
for (const p of presets) by[scenarioOf(p)].push(p.id);
const total = presets.length;

const md = `# Rawhide Identity

> A drop-in OpenID Connect provider for local dev and integration tests (Deno + Fresh 2.3): pick one of ${total} scenario personas and get conformant RS256 / PKCE tokens, so your relying party runs its genuine token verification — no real IdP, no accounts, no secrets, no mocks. A companion <rawhide-harness> Web Component drives and inspects the flow from the client side.

Rawhide is two packages — the provider \`@gilvandovieira/rawhideidentity\` (v${denoJson.version}) and the relying-party harness \`@gilvandovieira/rawhideharness\` — distributed via GitHub Releases (standalone provider binaries for every platform + the harness browser bundle); or run from source with \`deno task start\`. The OIDC core is framework-agnostic; Fresh is a thin adapter. It is strictly a localhost/dev tool — it will impersonate anyone on request, so never expose it on a shared host.

## Documentation
- [Documentation site](${SITE}/): overview, quick start, endpoints, and screenshots
- [README](${blob("README.md")}): install, CLI flags, personas & knobs, multi-tenant, testing
- [Provider spec](${blob("rawhideidentity.spec.md")}): OIDC provider design and HTTP surface
- [Harness spec](${blob("rawhide-harness.spec.md")}): the <rawhide-harness> Web Component design

## Downloads
- [GitHub Releases](${REPO}/releases): standalone provider binaries (per platform) + the harness browser bundle (\`rawhide-harness.min.js\`)
- [Source repository](${REPO}): run from a clone with \`deno task start\` (no build step)

## HTTP endpoints
- \`GET /.well-known/openid-configuration\`: discovery metadata
- \`GET /jwks\`: public RS256 signing keys
- \`GET /authorize\`: persona picker; issues an authorization code (append \`&persona=<id>\` to skip the picker)
- \`POST /token\`: authorization_code (PKCE) and refresh_token grants
- \`GET /userinfo\`: claims for a Bearer access token
- \`GET /personas\`: machine-readable persona list (powers the harness)
- \`GET /relay\`: postMessage relay for the harness popup flow
- \`GET /console\`: control console to author personas and flip behaviour knobs (disable with CONSOLE=off)

## Personas
${total} presets seed the store on first boot, grouped by what they exercise:
- Happy path (${by.happy.length}): ${by.happy.join(", ")}
- Edge cases (${by.edge.length}): ${by.edge.join(", ")}
- Error / failure (${by.error.length}): ${by.error.join(", ")}

## Optional
- [Fresh](https://usefresh.dev/): the Deno web framework the provider's UI is built on
- [Deno](https://deno.com/): the runtime
- [llms.txt spec](https://llmstxt.org/): the format of this file
`;

await Deno.writeTextFile(new URL("../docs/llms.txt", import.meta.url), md);
console.log(
  `wrote docs/llms.txt — ${total} personas (${by.happy.length}/${by.edge.length}/${by.error.length}), v${denoJson.version}`,
);
