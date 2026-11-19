// 測試共用工具：本機網頁伺服器、CDN 換成本機檔案、假的 Supabase 資料庫。
// 測試不會連到真正的 Supabase，也不會寫入任何資料。
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "output"); // 截圖放這裡（不放進 Git）
fs.mkdirSync(OUT, { recursive: true });

const GUIDES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "guides.json"), "utf8"));
const IDS = {
  FLORENCE: "5468e36a-c73d-44d3-8613-4e48d94a8f74",
  ROME: "4e38da7f-b2d6-4d58-9a35-21fbebe15522",
  KANAZAWA: "8f43d1f9-4fb1-436d-967b-8ac25aa91144",
  BUSAN: "8c6094ec-7530-47e9-a982-30fb7d951055",
};
function suggestBody() {
  return fs.readFileSync(path.join(__dirname, "fixtures", "suggest.json"), "utf8");
}
function cacheVersion() {
  const m = /var VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(APP_DIR, "sw.js"), "utf8"));
  return m ? m[1] : "";
}

// ---- 本機網頁伺服器：直接提供 國外旅遊攻略/ 資料夾 ----
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(APP_DIR, rel);
  if (!file.startsWith(APP_DIR + path.sep) && file !== APP_DIR) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});
server.listen(0, "127.0.0.1");
server.unref(); // 測試結束時不必等伺服器
function base() {
  const a = server.address();
  if (!a) throw new Error("本機伺服器還沒啟動");
  return "http://127.0.0.1:" + a.port + "/";
}

// ---- CDN 換成 node_modules 裡的同一版本 ----
const LOCAL_CDN = {
  supabase: require.resolve("@supabase/supabase-js/dist/umd/supabase.js"),
  leafletJs: require.resolve("leaflet/dist/leaflet.js"),
  leafletCss: require.resolve("leaflet/dist/leaflet.css"),
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

function readFilter(value) {
  // PostgREST 條件：eq.<id> 或 in.(<id>,<id>)
  if (!value) return null;
  if (value.startsWith("eq.")) return [value.slice(3)];
  const m = /^in\.\((.*)\)$/.exec(value);
  return m ? m[1].split(",").map((x) => x.replace(/"/g, "")) : null;
}

// 攔截 CDN、Supabase 資料表與地圖、維基百科照片（測試環境多半連不到這些網站）
async function routeExternal(ctx) {
  await ctx.route("**/cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    const f = u.includes("supabase") ? LOCAL_CDN.supabase
      : u.endsWith("leaflet.js") ? LOCAL_CDN.leafletJs
      : u.endsWith("leaflet.css") ? LOCAL_CDN.leafletCss : null;
    return f ? r.fulfill({ path: f, contentType: u.endsWith(".css") ? "text/css" : "application/javascript", headers: CORS }) : r.abort();
  });
  await ctx.route(/\/rest\/v1\//, (r) => {
    const req = r.request();
    if (req.method() === "OPTIONS") return r.fulfill({ status: 200, headers: CORS, body: "" });
    const url = new URL(req.url());
    const table = url.pathname.split("/").pop();
    if (req.method() !== "GET") return r.fulfill({ status: 201, headers: CORS, body: "" }); // 留言、回報：假裝寫入成功
    let rows = table === "travel_guides" ? GUIDES : [];
    const ids = readFilter(url.searchParams.get("id"));
    if (ids) rows = rows.filter((g) => ids.includes(g.id));
    const single = /vnd\.pgrst\.object/.test(req.headers()["accept"] || "");
    if (single) {
      if (rows.length !== 1) return r.fulfill({ status: 406, headers: CORS, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "no rows" }) });
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(rows[0]) });
    }
    return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await ctx.route(/tile\.openstreetmap\.org|upload\.wikimedia\.org|thumb\.wikimedia\.org/, (r) => r.abort());
}

// ---- 伺服器函式：把 TypeScript 轉成 JavaScript 後載入（Deno、fetch 要先換成假的） ----
async function loadFunction() {
  const esbuild = require("esbuild");
  const { pathToFileURL } = require("url");
  const src = path.join(APP_DIR, "supabase", "functions", "generate-guide", "index.ts");
  const out = path.join(OUT, "generate-guide-" + process.pid + ".mjs");
  const code = esbuild.transformSync(fs.readFileSync(src, "utf8"), { loader: "ts", format: "esm" }).code;
  fs.writeFileSync(out, code);
  await import(pathToFileURL(out).href);
}

// ---- 結果統計 ----
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) passed++; else failed++;
  console.log((cond ? "✅ " : "❌ ") + msg);
}
function finish() {
  console.log(failed ? `${failed} 項失敗（${passed} 項通過）` : `全部通過（${passed} 項）`);
  process.exitCode = failed ? 1 : 0;
}
function crash(e) {
  console.error("❌ 測試中斷：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
}

module.exports = { loadFunction, APP_DIR, OUT, IDS, GUIDES, base, routeExternal, suggestBody, cacheVersion, ok, finish, crash, counts: () => ({ passed, failed }) };
