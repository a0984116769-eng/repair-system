# 下一站（國外旅遊攻略）

App 名稱：「下一站」，標語：「世界那麼大，下一站由你決定。」私人使用。

給預計出國的人參考的攻略網頁。攻略由 Google Gemini（免費版）依既有知識整理後產生（免費版不能使用 Google 搜尋，所以不上網查證，頁面會標示），不需要登入，所有攻略公開。需求見 [需求筆記.txt](需求筆記.txt)，專案規則見 [AGENTS.md](AGENTS.md)。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html`、`style.css`、`app.js` | 網頁（純 HTML／CSS／JavaScript） |
| `config.js` | Supabase 網址與 publishable key |
| `manifest.webmanifest`、`sw.js`、`icons/` | PWA：安裝到主畫面、離線開啟。修改網頁檔案後，請把 `sw.js` 的 `VERSION` 加 1 |
| `supabase/schema.sql` | 資料表 `travel_guides`、`travel_comments`、`travel_reports` 與存取規則 |
| `supabase/functions/generate-guide/index.ts` | 伺服器端函式：呼叫 Gemini 並把攻略存進資料表 |

## 第一次設定（在 Supabase 後台操作）

1. **建立資料表：** 到 SQL Editor，貼上 `supabase/schema.sql` 的內容並執行。
2. **取得 Gemini 金鑰：** 到 Google AI Studio 建立 API 金鑰（免費版）。
3. **設定金鑰：** 到 Edge Functions → Secrets，新增 `GEMINI_API_KEY`，值填上一步的金鑰。
   金鑰只放這裡，不要寫進任何檔案。
   名稱也可以是小寫的 `gemini_api_key`。
   （可選）新增 `GEMINI_MODEL` 指定優先使用的模型。沒設定時依序嘗試 `gemini-3.5-flash`、`gemini-flash-latest`、`gemini-3.5-flash-lite`、`gemini-flash-lite-latest`，遇到忙碌或停用的模型會自動換下一個。
4. **建立函式：** 到 Edge Functions 新增函式，名稱填 `generate-guide`，貼上 `supabase/functions/generate-guide/index.ts` 的內容並部署。
5. **關閉 JWT 驗證：** 在 `generate-guide` 的設定中關閉「Verify JWT / Enforce JWT verification」。網頁用 publishable key 呼叫，不關閉會被拒絕。

## 網址

開啟 GitHub Pages（Settings → Pages，分支 `main`、資料夾 `/ (root)`）後：

https://a0984116769-eng.github.io/repair-system/%E5%9C%8B%E5%A4%96%E6%97%85%E9%81%8A%E6%94%BB%E7%95%A5/

## 安裝到手機（PWA）

- **Android（Chrome）：** 打開網址後，點頁面上的「安裝」，或瀏覽器選單的「安裝應用程式」。
- **iPhone（Safari）：** 點下方的「分享」按鈕，再選「加入主畫面」。

安裝後離線也能開啟，並看之前開過的攻略；產生攻略、留言、回報需要連網。

## 自動喚醒 Supabase

Supabase 免費方案約一週沒使用就會暫停專案。儲存庫根目錄的 `.github/workflows/supabase-keepalive.yml` 每週一、週四台灣時間 09:17 自動讀一筆資料，讓專案保持活躍（只用 publishable key）。

- 讀取失敗時該次執行會失敗，GitHub 會寄信通知；請到 Supabase 後台確認專案是否被暫停。
- 可在 GitHub 的 Actions 頁面選「Supabase 自動喚醒」→「Run workflow」手動執行。

## 本機預覽

```bash
python3 -m http.server 8000
```

在儲存庫根目錄執行後，打開 http://localhost:8000/國外旅遊攻略/ 。
