// Rawhide Identity — persona store + knobs, seeded from presets.
// Backing is a local JSON file (written on every mutation) or "memory" (nothing persists).
// Presets are always re-merged on boot, so editing the preset list in code and restarting
// updates them even when a store file already exists. Presets are read-only; custom personas
// are editable/deletable and may not reuse a preset id.
import type { Knobs, Persona } from "./types.ts";
import { defaultKnobs, parseKnobs } from "./knobs.ts";

export interface PersonaStore {
  listPersonas(): Persona[];
  getPersona(id: string): Persona | undefined;
  createPersona(form: FormData): Promise<Persona>;
  deletePersona(id: string): Promise<void>;
  knobs(): Knobs;
  setKnobs(form: FormData): Promise<void>;
  reset(): Promise<void>;
}

interface Persisted {
  custom: Persona[];
  knobs: Knobs;
}

const ID_RE = /^[A-Za-z0-9._~-]+$/;

function personaFromForm(form: FormData): Persona {
  const id = String(form.get("id") ?? "").trim();
  const label = String(form.get("label") ?? "").trim();
  if (!id) throw new Error("id is required");
  if (!ID_RE.test(id)) throw new Error("id must be URL-safe (A-Z a-z 0-9 . _ ~ -)");
  if (!label) throw new Error("label is required");

  let claims: unknown;
  try {
    claims = JSON.parse(String(form.get("claims") ?? ""));
  } catch {
    throw new Error("claims must be valid JSON");
  }
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    throw new Error("claims must be a JSON object");
  }
  const sub = (claims as Record<string, unknown>).sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("claims must include a non-empty string 'sub'");
  }

  const ttl = String(form.get("idTokenTTL") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();

  return {
    id,
    label,
    description: description || undefined,
    source: "custom",
    claims: claims as Record<string, unknown>,
    idTokenTTL: ttl ? Number(ttl) : undefined,
    refreshable: form.get("refreshable") != null,
    createdAt: Date.now(),
  };
}

export async function createStore(path: string | "memory", presets: Persona[]): Promise<PersonaStore> {
  const isMemory = path === "memory";
  let custom: Persona[] = [];
  let knobs: Knobs = { ...defaultKnobs };

  const save = async () => {
    if (isMemory) return;
    const data: Persisted = { custom, knobs };
    await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
  };

  if (!isMemory) {
    let text: string | null = null;
    try {
      text = await Deno.readTextFile(path);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      // no file yet — start from presets + default knobs
    }
    if (text && text.trim()) {
      try {
        const data = JSON.parse(text) as Partial<Persisted>;
        custom = (data.custom ?? []).map((p) => ({ ...p, source: "custom" as const }));
        knobs = { ...defaultKnobs, ...(data.knobs ?? {}) };
      } catch {
        console.warn(`[rawhide] ignoring unparseable store file at ${path} — starting from presets`);
      }
    }
  }

  // Presets re-merged on every boot; custom personas can't shadow a preset id.
  const all = (): Persona[] => {
    const byId = new Map<string, Persona>();
    for (const p of presets) byId.set(p.id, { ...p, source: "preset" });
    for (const p of custom) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()];
  };

  return {
    listPersonas: () => all(),
    getPersona: (id) => all().find((p) => p.id === id),
    knobs: () => knobs,

    async createPersona(form) {
      const persona = personaFromForm(form);
      if (presets.some((p) => p.id === persona.id)) {
        throw new Error(`'${persona.id}' is a preset id — pick another`);
      }
      custom = custom.filter((p) => p.id !== persona.id); // replace if re-creating same id
      custom.push(persona);
      await save();
      return persona;
    },

    async deletePersona(id) {
      if (presets.some((p) => p.id === id)) throw new Error("presets can't be deleted");
      const before = custom.length;
      custom = custom.filter((p) => p.id !== id);
      if (custom.length !== before) await save();
    },

    async setKnobs(form) {
      knobs = parseKnobs(form, knobs);
      await save();
    },

    async reset() {
      custom = [];
      knobs = { ...defaultKnobs };
      await save();
    },
  };
}
