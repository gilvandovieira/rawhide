import { assertEquals } from "@std/assert";
import { defaultKnobs, parseKnobs } from "./knobs.ts";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

Deno.test("parseKnobs falls back to defaults for absent/blank fields", () => {
  const k = parseKnobs(new FormData());
  assertEquals(k.autoPersona, null);
  assertEquals(k.idTokenTTLOverride, null);
  assertEquals(k.clockSkewSeconds, 0);
  assertEquals(k.latencyMs, 0);
  assertEquals(k.forceAuthorizeError, null);
  assertEquals(k.refreshEnabled, false); // an unchecked checkbox is simply absent from the form
  assertEquals(k.extraClaims, {});
});

Deno.test("parseKnobs reads submitted values", () => {
  const k = parseKnobs(form({
    autoPersona: "admin",
    idTokenTTLOverride: "30",
    clockSkewSeconds: "-5",
    latencyMs: "200",
    forceAuthorizeError: "login_required",
    refreshEnabled: "on",
    extraClaims: JSON.stringify({ org: "acme" }),
  }));
  assertEquals(k.autoPersona, "admin");
  assertEquals(k.idTokenTTLOverride, 30);
  assertEquals(k.clockSkewSeconds, -5);
  assertEquals(k.latencyMs, 200);
  assertEquals(k.forceAuthorizeError, { error: "login_required" });
  assertEquals(k.refreshEnabled, true);
  assertEquals(k.extraClaims, { org: "acme" });
});

Deno.test("parseKnobs ignores invalid extraClaims JSON", () => {
  assertEquals(parseKnobs(form({ extraClaims: "{not json" })).extraClaims, {});
});

Deno.test("defaultKnobs ships refresh enabled", () => {
  assertEquals(defaultKnobs.refreshEnabled, true);
  assertEquals(defaultKnobs.autoPersona, null);
});
