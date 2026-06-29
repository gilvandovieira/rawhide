/** @jsxImportSource preact */
// Zero-JS theme switch: a plain link to /theme that sets a cookie and redirects back.
// `to` is the path to return to (including any query string).
import type { Mode } from "../core/types.ts";

export function ThemeToggle({ mode, to }: { mode: Mode; to: string }) {
  const next: Mode = mode === "dark" ? "light" : "dark";
  const href = `/theme?set=${next}&to=${encodeURIComponent(to)}`;
  return (
    <a
      href={href}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      style="display:inline-flex;align-items:center;gap:6px;font:600 11px 'IBM Plex Sans';color:var(--muted);background:var(--surface);border:1px solid var(--border2);border-radius:20px;padding:5px 11px;text-decoration:none"
    >
      <span style="font-size:13px;line-height:1">{mode === "dark" ? "☀" : "☾"}</span>
      {next}
    </a>
  );
}
