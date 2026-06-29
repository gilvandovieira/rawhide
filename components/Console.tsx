/** @jsxImportSource preact */
import type { ComponentChildren } from "preact";
import type { Knobs, Mode, Persona } from "../core/types.ts";
import { scenarioOf } from "../core/types.ts";
import { cssVars, THEMES } from "../core/theme.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface ConsoleProps {
  personas: Persona[];
  knobs: Knobs;
  tenant?: string;
  issuer?: string;
  store?: string;   // backing store label (path or "memory")
  mode?: Mode;
}

const inputStyle = (t: string) =>
  `width:100%;box-sizing:border-box;height:34px;padding:0 10px;border:1px solid var(--border);border-radius:7px;background:var(--inset);color:var(--ink);font:12px ${t};outline:none`;

export function Console({ personas, knobs, tenant, issuer = "localhost:9000", store, mode = "dark" }: ConsoleProps) {
  const t = THEMES[mode];
  const root = `${cssVars(t)};min-height:100vh;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans',system-ui,sans-serif`;
  const storeLabel = store ?? `.oidc-personas${tenant ? "." + tenant : ""}.json`;
  const dotFor = (p: Persona) => {
    if (p.source === "custom") return "var(--gold)";
    return { happy: "var(--happy)", edge: "var(--edge)", error: "var(--error)" }[scenarioOf(p)];
  };

  return (
    <main style={root}>
      {/* header */}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="/brand/rawhide-hat.png" alt="Rawhide" style="width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 3px 7px rgba(0,0,0,.4))" />
          <div>
            <div style="font:700 17px Bitter,serif;color:var(--goldText);line-height:1">Rawhide</div>
            <div style="font:600 9px 'IBM Plex Sans';letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);margin-top:3px">OIDC test console</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <ThemeToggle mode={mode} to="/console" />
          {tenant
            ? <span style="display:flex;align-items:center;gap:6px;font:600 11px 'IBM Plex Mono';color:var(--gold);background:var(--surface);border:1px solid var(--border2);border-radius:20px;padding:4px 11px"><span style="width:7px;height:7px;border-radius:50%;background:var(--gold)"></span>{tenant}</span>
            : null}
          <span style="display:flex;align-items:center;gap:6px;font:600 10.5px 'IBM Plex Sans';color:var(--error);border:1px solid var(--error);border-radius:6px;padding:4px 9px"><span style="width:6px;height:6px;border-radius:50%;background:var(--error)"></span>Localhost only</span>
        </div>
      </div>

      {/* caution */}
      <div style="display:flex;align-items:center;gap:9px;padding:9px 22px;background:var(--errTint);color:var(--error);font:11.5px 'IBM Plex Sans'">
        <span style="width:15px;height:15px;border-radius:50%;border:1.5px solid var(--error);display:flex;align-items:center;justify-content:center;font:700 10px 'IBM Plex Sans';flex:none">!</span>
        Can mint admin tokens for any RP and impersonate any identity — keep it on a developer machine.
      </div>

      {/* instance ribbon */}
      <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:10px 22px;background:var(--inset);border-bottom:1px solid var(--border);font:11px 'IBM Plex Sans';color:var(--ink)">
        {tenant
          ? <span><b style="font:600 9px 'IBM Plex Sans';letter-spacing:.6px;text-transform:uppercase;color:var(--faint)">tenant</b> <code style="font:500 11px 'IBM Plex Mono'">{tenant}</code></span>
          : null}
        <span><b style="font:600 9px 'IBM Plex Sans';letter-spacing:.6px;text-transform:uppercase;color:var(--faint)">issuer</b> <code style="font:500 11px 'IBM Plex Mono'">http://{issuer}</code></span>
        {tenant
          ? <span><b style="font:600 9px 'IBM Plex Sans';letter-spacing:.6px;text-transform:uppercase;color:var(--faint)">injected claim</b> <code style="font:500 11px 'IBM Plex Mono'">tenant_id="{tenant}"</code> <span style="color:var(--faint)">· fixed</span></span>
          : null}
        <span><b style="font:600 9px 'IBM Plex Sans';letter-spacing:.6px;text-transform:uppercase;color:var(--faint)">store</b> <code style="font:500 11px 'IBM Plex Mono'">{storeLabel}</code></span>
      </div>

      {/* two-pane */}
      <div style="display:grid;grid-template-columns:340px 1fr;min-height:620px">
        {/* LEFT: personas */}
        <div style="padding:18px 20px;border-right:1px solid var(--border)">
          <div style="font:600 11px 'IBM Plex Sans';letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:11px">Personas <span style="font:500 11px 'IBM Plex Mono';color:var(--faint)">{personas.length}</span></div>

          {personas.map((p) => (
            <div key={p.id} style="display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--surface)">
              <span style={`width:9px;height:9px;border-radius:50%;background:${dotFor(p)};flex:none`}></span>
              <div style="flex:1;min-width:0">
                <div style="font:500 11.5px 'IBM Plex Mono';color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.id}</div>
                <div style="font:10.5px 'IBM Plex Sans';color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.label}</div>
              </div>
              {p.source === "custom"
                ? (
                  <form method="post" action={`/console/personas/${p.id}/delete`} style="display:inline;margin:0">
                    <button type="submit" title="delete" style="border:none;background:none;color:var(--error);font:13px 'IBM Plex Sans';cursor:pointer">✕</button>
                  </form>
                )
                : <span style="font:9.5px 'IBM Plex Sans';color:var(--faint);border:1px solid var(--border2);border-radius:4px;padding:1px 6px">preset</span>}
            </div>
          ))}

          {/* create */}
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
            <div style="font:600 11px 'IBM Plex Sans';letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:11px">New persona</div>
            <form method="post" action="/console/personas">
              <div style="display:flex;gap:8px;margin-bottom:8px">
                <input name="id" placeholder="id" required style={inputStyle("'IBM Plex Mono'")} />
                <input name="label" placeholder="label" required style={inputStyle("'IBM Plex Sans'")} />
              </div>
              <div style="font:9.5px 'IBM Plex Sans';color:var(--faint);margin-bottom:4px">claims (raw JSON — must include sub)</div>
              <textarea name="claims" rows={4} required style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:7px;background:var(--inset);color:var(--ink);font:11px/1.55 'IBM Plex Mono';outline:none;resize:vertical;margin-bottom:9px">{`{ "sub": "user-123", "email": "x@example.test" }`}</textarea>
              <div style="display:flex;align-items:center;gap:14px;margin-bottom:11px">
                <input name="idTokenTTL" type="number" placeholder="TTL (s)" style={inputStyle("'IBM Plex Mono'") + ";width:110px"} />
                <label style="display:flex;align-items:center;gap:7px;font:12px 'IBM Plex Sans';color:var(--muted);cursor:pointer"><input name="refreshable" type="checkbox" style="width:15px;height:15px;accent-color:var(--gold);cursor:pointer" /> refreshable</label>
              </div>
              <button type="submit" style="height:34px;padding:0 16px;border:none;border-radius:7px;background:var(--gold);color:var(--onGold);font:600 12.5px 'IBM Plex Sans';cursor:pointer">Create persona</button>
            </form>
          </div>
        </div>

        {/* RIGHT: knobs */}
        <div style="padding:18px 22px">
          <div style="font:600 11px 'IBM Plex Sans';letter-spacing:.7px;text-transform:uppercase;color:var(--muted)">Behavior knobs</div>
          <div style="font:11.5px 'IBM Plex Sans';color:var(--faint);margin:3px 0 6px">Global dials, applied at mint time — knob beats persona.</div>

          <form method="post" action="/console/knobs">
            <KnobRow name="autoPersona" desc="Skip the picker — headless / CI">
              <select name="autoPersona" style="width:184px;height:34px;padding:0 9px;border:1px solid var(--border);border-radius:7px;background:var(--inset);color:var(--ink);font:12px 'IBM Plex Mono';outline:none;cursor:pointer">
                <option value="">show picker (default)</option>
                {personas.map((p) => <option key={p.id} value={p.id} selected={knobs.autoPersona === p.id}>{p.id}</option>)}
              </select>
            </KnobRow>
            <KnobRow name="idTokenTTLOverride" desc="Override every persona's TTL">
              <div style="display:flex;align-items:center;gap:7px;width:184px"><input name="idTokenTTLOverride" type="number" placeholder="—" value={knobs.idTokenTTLOverride ?? ""} style={inputStyle("'IBM Plex Mono'") + ";flex:1"} /><span style="font:11px 'IBM Plex Mono';color:var(--faint)">s</span></div>
            </KnobRow>
            <KnobRow name="clockSkewSeconds" desc="Shift iat & exp by N seconds">
              <div style="display:flex;align-items:center;gap:7px;width:184px"><input name="clockSkewSeconds" type="number" value={knobs.clockSkewSeconds} style={inputStyle("'IBM Plex Mono'") + ";flex:1"} /><span style="font:11px 'IBM Plex Mono';color:var(--faint)">s</span></div>
            </KnobRow>
            <KnobRow name="latencyMs" desc="Artificial delay on /token">
              <div style="display:flex;align-items:center;gap:7px;width:184px"><input name="latencyMs" type="number" value={knobs.latencyMs} style={inputStyle("'IBM Plex Mono'") + ";flex:1"} /><span style="font:11px 'IBM Plex Mono';color:var(--faint)">ms</span></div>
            </KnobRow>
            <KnobRow name="forceAuthorizeError" desc="Every /authorize errors out">
              <select name="forceAuthorizeError" style="width:184px;height:34px;padding:0 9px;border:1px solid var(--border);border-radius:7px;background:var(--inset);color:var(--ink);font:12px 'IBM Plex Mono';outline:none;cursor:pointer">
                <option value="">none</option><option>access_denied</option><option>login_required</option><option>server_error</option>
              </select>
            </KnobRow>
            <KnobRow name="refreshEnabled" desc="Global gate on refresh_token issuance">
              <label style="display:flex;align-items:center;gap:8px;width:184px;justify-content:flex-end;font:12px 'IBM Plex Sans';color:var(--muted);cursor:pointer">
                <input name="refreshEnabled" type="checkbox" checked={knobs.refreshEnabled} style="width:17px;height:17px;accent-color:var(--happy);cursor:pointer" /> enabled
              </label>
            </KnobRow>
            <KnobRow name="extraClaims" desc="Merged into every id_token (resettable)">
              <textarea name="extraClaims" rows={2} style="width:184px;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border);border-radius:7px;background:var(--inset);color:var(--ink);font:11px/1.5 'IBM Plex Mono';outline:none;resize:vertical">{JSON.stringify(knobs.extraClaims ?? {})}</textarea>
            </KnobRow>
            <button type="submit" style="height:36px;padding:0 18px;margin-top:15px;border:none;border-radius:7px;background:var(--gold);color:var(--onGold);font:600 13px 'IBM Plex Sans';cursor:pointer">Apply knobs</button>
          </form>

          {/* signing key + danger */}
          <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border)">
            <div style="font:600 11px 'IBM Plex Sans';letter-spacing:.7px;text-transform:uppercase;color:var(--muted);margin-bottom:11px">Signing key &amp; danger</div>
            <div style="display:flex;align-items:center;gap:8px;font:11.5px 'IBM Plex Mono';color:var(--muted);margin-bottom:6px"><span style="width:9px;height:9px;border-radius:50%;background:var(--happy);flex:none"></span>RS256 · ephemeral</div>
            <div style="font:10.5px/1.45 'IBM Plex Sans';color:var(--faint);margin-bottom:12px">{tenant ? "Per-tenant key — tokens won't validate against another tenant's JWKS." : "Generated at startup; rotate issues a fresh kid (previous kept for a grace window)."}</div>
            <div style="display:flex;gap:9px">
              <form method="post" action="/console/rotate-key" style="margin:0"><button type="submit" style="height:34px;padding:0 15px;border:1px solid var(--border2);border-radius:7px;background:var(--surface);color:var(--ink);font:600 12px 'IBM Plex Sans';cursor:pointer">Rotate signing key</button></form>
              <form method="post" action="/console/reset" style="margin:0"><button type="submit" style="height:34px;padding:0 15px;border:1px solid var(--error);border-radius:7px;background:transparent;color:var(--error);font:600 12px 'IBM Plex Sans';cursor:pointer">Reset to defaults</button></form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function KnobRow({ name, desc, children }: { name: string; desc: string; children: ComponentChildren }) {
  return (
    <div style="display:flex;align-items:flex-start;gap:16px;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font:600 12.5px 'IBM Plex Mono';color:var(--ink)">{name}</div>
        <div style="font:11.5px 'IBM Plex Sans';color:var(--muted)">{desc}</div>
      </div>
      {children}
    </div>
  );
}
