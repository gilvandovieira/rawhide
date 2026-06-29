/** @jsxImportSource preact */
import type { Mode, Persona } from "../core/types.ts";
import { chipsOf, scenarioOf } from "../core/types.ts";
import { cssVars, THEMES } from "../core/theme.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

interface PickerProps {
  /** Verbatim authorize query string (e.g. ctx.url.search) — preserved on each option link. */
  search: string;
  personas: Persona[];
  tenant?: string;   // injected tenant id (per-instance)
  issuer?: string;   // host:port the instance serves on
  mode?: Mode;       // "dark" (default) | "light"
}

const GROUPS = [
  { key: "happy", label: "Happy path", colorVar: "--happy" },
  { key: "edge", label: "Edge cases", colorVar: "--edge" },
  { key: "error", label: "Error / failure paths", colorVar: "--error" },
] as const;

export function Picker({ search, personas, tenant, issuer = "localhost:9000", mode = "dark" }: PickerProps) {
  const t = THEMES[mode];
  const root = `${cssVars(t)};background:var(--bg);background-image:radial-gradient(120% 80% at 50% -10%, var(--g1) 0%, var(--bg) 55%, var(--g2) 100%);color:var(--ink);font-family:'IBM Plex Sans',system-ui,sans-serif;position:relative;overflow:hidden;min-height:100vh;padding:46px 0`;

  return (
    <main style={root}>
      <img src="/brand/rawhide-hat.png" alt="" style="position:absolute;top:-30px;right:-100px;width:460px;height:460px;object-fit:contain;opacity:.06;transform:rotate(6deg);pointer-events:none" />

      <div style="position:relative;max-width:620px;margin:0 auto;padding:0 30px">
        {/* brand header */}
        <div style="display:flex;align-items:center;gap:13px;margin-bottom:30px">
          <div style="position:relative;flex:none">
            <div style="position:absolute;inset:-8px;border-radius:50%;background:radial-gradient(circle, var(--glow) 0%, rgba(227,180,92,0) 70%)"></div>
            <img src="/brand/rawhide-hat.png" alt="Rawhide Identity" style="position:relative;width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 5px 12px rgba(0,0,0,.5))" />
          </div>
          <div style="flex:1">
            <div style="font:700 22px Bitter,serif;color:var(--goldText);letter-spacing:.3px;line-height:1">Rawhide</div>
            <div style="font:600 9.5px 'IBM Plex Sans';letter-spacing:1.6px;text-transform:uppercase;color:var(--faint);margin-top:4px">OIDC test identity provider</div>
          </div>
          <div style="display:flex;align-items:center;gap:9px;flex:none">
            <ThemeToggle mode={mode} to={`/authorize${search}`} />
            <span style="display:flex;align-items:center;gap:7px;font:600 11.5px 'IBM Plex Mono';color:var(--gold);background:var(--surface);border:1px solid var(--border2);border-radius:20px;padding:5px 12px">
              <span style="width:7px;height:7px;border-radius:50%;background:var(--gold);flex:none"></span>
              {tenant ? <>{tenant} <span style="color:var(--faint)">· {issuer}</span></> : issuer}
            </span>
          </div>
        </div>

        <h1 style="font:700 30px Bitter,serif;color:var(--ink);margin:0 0 8px">Choose a persona</h1>
        <p style="font:14.5px/1.6 'IBM Plex Sans';color:var(--muted);margin:0 0 14px">Each card is a test scenario; the chips preview the ID-token claims you'll receive. Selecting one issues an authorization code and returns you to the app.</p>
        <div style="font:11.5px/1.5 'IBM Plex Sans';color:var(--faint);margin-bottom:26px">Issued by <span style="font-family:'IBM Plex Mono';color:var(--faint2)">{issuer}</span>{tenant ? <> · every token carries <span style="font-family:'IBM Plex Mono';color:var(--faint2)">tenant_id: {tenant}</span></> : null}</div>

        {GROUPS.map((grp) => {
          const items = personas.filter((p) => scenarioOf(p) === grp.key);
          if (items.length === 0) return null;
          const isErr = grp.key === "error";
          return (
            <div key={grp.key} style="margin-bottom:24px">
              <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
                <span style={`width:10px;height:10px;border-radius:50%;background:var(${grp.colorVar})`}></span>
                <span style={`font:600 11px 'IBM Plex Sans';letter-spacing:1px;text-transform:uppercase;color:var(${grp.colorVar})`}>{grp.label}</span>
                <span style="font:500 11px 'IBM Plex Mono';color:var(--faint)">{items.length}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                {items.map((p) => (
                  <a
                    key={p.id}
                    href={`/authorize${search}&persona=${encodeURIComponent(p.id)}`}
                    style={`display:block;text-decoration:none;background:var(${isErr ? "--errBg" : "--surface"});border:1px solid var(${isErr ? "--errBorder" : "--border2"});border-radius:13px;padding:15px`}
                  >
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                      <span style={`width:9px;height:9px;border-radius:50%;background:var(${grp.colorVar});flex:none`}></span>
                      <span style="font:600 14px 'IBM Plex Sans';color:var(--ink)">{p.label}</span>
                      <span style="margin-left:auto;font:10.5px 'IBM Plex Mono';color:var(--faint)">{p.id}</span>
                    </div>
                    {p.description ? <div style="font:11.5px 'IBM Plex Sans';color:var(--muted);margin-bottom:11px">{p.description}</div> : null}
                    <div style="display:flex;flex-wrap:wrap;gap:5px">
                      {chipsOf(p).map((c) => (
                        <span key={c} style={`padding:3px 9px;border:1px solid var(${isErr ? "--errChipB" : "--border2"});border-radius:20px;font:10px 'IBM Plex Mono';color:var(${isErr ? "--errChipT" : "--muted"});background:var(${isErr ? "--errChip" : "--chip"})`}>{c}</span>
                      ))}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          );
        })}

        <div style="display:flex;align-items:center;gap:9px;margin-top:30px;padding-top:18px;border-top:1px solid var(--border)">
          <img src="/brand/icon-32.png" alt="" style="width:17px;height:17px" />
          <span style="font:11.5px 'IBM Plex Sans';color:var(--faint)">Rawhide Identity · <span style="font-family:'IBM Plex Mono'">@gilvandovieira/rawhideidentity</span></span>
        </div>
      </div>
    </main>
  );
}
