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
| `supabase/functions/generate-guide/index.ts` | 伺服器端函式：產生攻略、推薦城市、翻譯與常用句子 |
| `places.js` | 搜尋表單與翻譯面板的國家、城市下拉選單資料（含當地語言代碼） |
| `vendor/qrcode-generator-1.4.4.js` | 產生「分享／轉移收藏」QR Code 的程式庫（MIT 授權） |
| `tests/` | 自動測試，說明見下方「測試」 |

## 第一次設定（在 Supabase 後台操作）

1. **建立資料表：** 到 SQL Editor，貼上 `supabase/schema.sql` 的內容並執行。
2. **取得 Gemini 金鑰：** 到 Google AI Studio 建立 API 金鑰（免費版）。
3. **設定金鑰：** 到 Edge Functions → Secrets，新增 `GEMINI_API_KEY`，值填上一步的金鑰。
   金鑰只放這裡，不要寫進任何檔案。
   名稱也可以是小寫的 `gemini_api_key`。
   （可選）新增 `GEMINI_MODEL` 指定優先使用的模型。沒設定時依序嘗試 `gemini-3.5-flash-lite`、`gemini-flash-lite-latest`、`gemini-3.5-flash`、`gemini-flash-latest`（回應快的 Flash-Lite 優先），遇到忙碌或停用的模型會自動換下一個。
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

## AI 健康檢查

儲存庫根目錄的 `.github/workflows/ai-healthcheck.yml` 每月 1 日台灣時間 09:43 實際請 AI 推薦一次城市（不存進資料庫，約用 1 次 Gemini 免費額度），確認模型、金鑰與函式都正常。

- 失敗時會在儲存庫開一個 Issue（GitHub 會寄信通知儲存庫擁有者），內容列出常見原因與處理方式。
- 「Supabase 自動喚醒」失敗時也會開 Issue。
- 可在 GitHub 的 Actions 頁面選「AI 健康檢查」→「Run workflow」手動執行。

## 上網搜尋（Tavily）與攻略自動更新

- 到 tavily.com 註冊（免費版每月 1,000 次，不需信用卡），在後台複製 API 金鑰（以 `tvly-` 開頭）。
- Supabase 後台 → Edge Functions → Secrets 新增 `TAVILY_API_KEY`，值貼上金鑰。不要寫進任何檔案。
- 設定後新攻略會先上網搜尋再整理，並附上資料來源；沒有設定時照常產生，但標示「未經上網查證」。
- 儲存庫根目錄的 `.github/workflows/guide-refresh.yml` 每週一台灣時間 10:07 執行：整理日期超過 30 天的攻略重新搜尋、重寫（網址不變），每次最多 6 篇。失敗時開 Issue 通知。

## 本機預覽

```bash
python3 -m http.server 8000
```

在儲存庫根目錄執行後，打開 http://localhost:8000/國外旅遊攻略/ 。

## 測試

測試放在 `tests/`，不會連到真正的 Supabase，也不會呼叫 AI 或寫入資料：

- 瀏覽器測試用 Playwright（Chromium）模擬 iPhone、Android 與電腦操作。資料庫用 `tests/fixtures/` 的假資料，AI 回覆、麥克風語音辨識也都是模擬的。
- 伺服器函式測試把 `generate-guide` 載入 Node，換成假的 Gemini、Tavily 與資料庫。

需要 Node.js 18 以上。第一次執行：

```bash
cd 國外旅遊攻略/tests
```

```bash
npm install
```

```bash
npx playwright install chromium
```

之後每次修改完，在 `國外旅遊攻略/tests` 執行：

```bash
npm test
```

只跑部分測試時，加上檔名裡的字，例如：

```bash
npm test -- translate voice
```

| 測試檔 | 內容 |
| --- | --- |
| `e2e.test.js` | 完整流程：推薦城市、產生攻略、地圖、收藏、留言、回報、安裝設定、離線開啟 |
| `dropdowns.test.js` | 國家、城市下拉選單 |
| `features.test.js` | 等待進度、分享／轉移收藏、「對方說 → 中文」 |
| `translate.test.js`、`translate-panel.test.js` | 翻譯、給對方看、常用句子、翻譯浮動按鈕與面板 |
| `phrases-retry.test.js` | 常用句子失敗時自動重試一次 |
| `voice.test.js`、`voice-blocked.test.js` | 語音輸入，以及被系統擋下時的說明 |
| `download-app.test.js` | 下載 App 按鈕與各平台的安裝說明 |
| `function-guide.test.mjs`、`function-translate.test.mjs` | 伺服器函式：攻略、自動更新、翻譯 |

截圖會存到 `tests/output/`（不放進 Git）。真實的麥克風、相機掃描 QR Code 與 iPhone 主畫面 App 無法自動測試，請用手機實際確認。
