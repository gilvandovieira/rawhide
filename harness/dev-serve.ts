/// <reference lib="deno.ns" />
// Tiny static server for the harness demo. Runs on a different origin than the provider
// (default :8080 vs the provider's :9000) so the demo exercises real cross-origin CORS.
const ROOT = new URL("./", import.meta.url);
const PORT = Number(Deno.env.get("PORT") ?? 8080);
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
};

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  let path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (path === "") path = "demo.html";
  const fileUrl = new URL(path, ROOT);
  if (!fileUrl.href.startsWith(ROOT.href)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const data = await Deno.readFile(fileUrl);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return new Response(data, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
});

console.log(
  `Rawhide harness demo → http://localhost:${PORT}/  (provider expected on :9000)`,
);
