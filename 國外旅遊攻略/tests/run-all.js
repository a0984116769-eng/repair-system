// 依序執行所有測試，最後列出每個檔案的結果。用法：npm test（在 tests 資料夾）
// 只跑部分測試：npm test -- translate voice
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const filter = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter((f) => /\.test\.m?js$/.test(f))
  .filter((f) => !filter.length || filter.some((k) => f.includes(k)))
  .sort((a, b) => (a.startsWith("function-") ? -1 : 0) - (b.startsWith("function-") ? -1 : 0) || a.localeCompare(b));

const rows = [];
for (const f of files) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", timeout: 10 * 60 * 1000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const pass = (out.match(/^(✅|PASS)/gm) || []).length;
  const fail = (out.match(/^(❌|FAIL)/gm) || []).length;
  const okFile = r.status === 0 && fail === 0;
  rows.push({ f, pass, fail, okFile, sec: Math.round((Date.now() - started) / 1000) });
  console.log((okFile ? "✅ " : "❌ ") + f + `：${pass} 項通過` + (fail ? `，${fail} 項失敗` : "") + `（${rows[rows.length - 1].sec} 秒）`);
  if (!okFile) {
    // 只列出失敗的項目與錯誤訊息
    out.split("\n").filter((l) => /^(❌|FAIL)|Error|錯誤/.test(l)).slice(0, 20).forEach((l) => console.log("    " + l));
  }
}
const total = rows.reduce((n, r) => n + r.pass, 0);
const bad = rows.filter((r) => !r.okFile);
console.log("");
console.log(bad.length ? `${bad.length} 個檔案有問題，共 ${total} 項通過。` : `全部通過：${rows.length} 個檔案、${total} 項。`);
process.exitCode = bad.length ? 1 : 0;
