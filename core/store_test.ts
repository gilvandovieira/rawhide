import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { createStore } from "./store.ts";
import { presets } from "./presets.ts";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

Deno.test("memory store seeds the presets", async () => {
  const s = await createStore("memory", presets);
  assertEquals(s.listPersonas().length, presets.length);
  assertExists(s.getPersona("valid"));
  assertEquals(s.getPersona("valid")?.source, "preset");
});

Deno.test("createPersona validates input and stores a custom persona", async () => {
  const s = await createStore("memory", presets);
  const p = await s.createPersona(form({ id: "qa", label: "QA", claims: JSON.stringify({ sub: "svc" }) }));
  assertEquals(p.source, "custom");
  assertEquals(s.getPersona("qa")?.label, "QA");
  assertEquals(s.listPersonas().length, presets.length + 1);
});

Deno.test("createPersona rejects bad input", async () => {
  const s = await createStore("memory", presets);
  await assertRejects(() => s.createPersona(form({ id: "x", label: "x", claims: "{not json" })), Error, "valid JSON");
  await assertRejects(
    () => s.createPersona(form({ id: "x", label: "x", claims: JSON.stringify({ email: "a@b" }) })),
    Error,
    "sub",
  );
  await assertRejects(
    () => s.createPersona(form({ id: "valid", label: "x", claims: JSON.stringify({ sub: "s" }) })),
    Error,
    "preset",
  );
  await assertRejects(
    () => s.createPersona(form({ id: "has space", label: "x", claims: JSON.stringify({ sub: "s" }) })),
    Error,
    "URL-safe",
  );
});

Deno.test("deletePersona removes custom personas and refuses presets", async () => {
  const s = await createStore("memory", presets);
  await s.createPersona(form({ id: "qa", label: "QA", claims: JSON.stringify({ sub: "svc" }) }));
  await s.deletePersona("qa");
  assertEquals(s.getPersona("qa"), undefined);
  await assertRejects(() => s.deletePersona("admin"), Error, "preset");
});

Deno.test("file store persists custom personas + knobs across sessions, reset clears them", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/store.json`;
  try {
    const s1 = await createStore(path, presets);
    await s1.createPersona(
      form({ id: "qa", label: "QA", claims: JSON.stringify({ sub: "svc" }), idTokenTTL: "120", refreshable: "on" }),
    );
    await s1.setKnobs(form({ autoPersona: "valid", clockSkewSeconds: "5" }));

    const s2 = await createStore(path, presets);
    assertEquals(s2.getPersona("qa")?.refreshable, true);
    assertEquals(s2.getPersona("qa")?.source, "custom");
    assertEquals(s2.knobs().autoPersona, "valid");
    assertEquals(s2.knobs().clockSkewSeconds, 5);

    await s2.reset();
    const s3 = await createStore(path, presets);
    assertEquals(s3.getPersona("qa"), undefined);
    assertEquals(s3.knobs().autoPersona, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an empty or corrupt store file is tolerated (falls back to presets)", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/store.json`;
  try {
    await Deno.writeTextFile(path, "");
    assertEquals((await createStore(path, presets)).listPersonas().length, presets.length);

    await Deno.writeTextFile(path, "{not valid json");
    const s = await createStore(path, presets);
    assertEquals(s.listPersonas().length, presets.length);
    assert(s.getPersona("valid") !== undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
