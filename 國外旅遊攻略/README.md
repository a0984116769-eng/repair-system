# 國外旅遊攻略

給預計出國的人參考的攻略網頁。攻略由 Google Gemini（免費版）透過 Google 搜尋整理後產生，不需要登入，所有攻略公開。需求見 [需求筆記.txt](需求筆記.txt)，專案規則見 [AGENTS.md](AGENTS.md)。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html`、`style.css`、`app.js` | 網頁（純 HTML／CSS／JavaScript） |
| `config.js` | Supabase 網址與 publishable key |
| `supabase/schema.sql` | 資料表 `travel_guides`、`travel_comments`、`travel_reports` 與存取規則 |
| `supabase/functions/generate-guide/index.ts` | 伺服器端函式：呼叫 Gemini 並把攻略存進資料表 |

## 第一次設定（在 Supabase 後台操作）

1. **建立資料表：** 到 SQL Editor，貼上 `supabase/schema.sql` 的內容並執行。
2. **取得 Gemini 金鑰：** 到 Google AI Studio 建立 API 金鑰（免費版）。
3. **設定金鑰：** 到 Edge Functions → Secrets，新增 `GEMINI_API_KEY`，值填上一步的金鑰。
   金鑰只放這裡，不要寫進任何檔案。
   （可選）新增 `GEMINI_MODEL` 指定模型，沒設定時使用 `gemini-2.5-flash`。
4. **建立函式：** 到 Edge Functions 新增函式，名稱填 `generate-guide`，貼上 `supabase/functions/generate-guide/index.ts` 的內容並部署。
5. **關閉 JWT 驗證：** 在 `generate-guide` 的設定中關閉「Verify JWT / Enforce JWT verification」。網頁用 publishable key 呼叫，不關閉會被拒絕。

## 網址

開啟 GitHub Pages（Settings → Pages，分支 `main`、資料夾 `/ (root)`）後：

https://a0984116769-eng.github.io/repair-system/%E5%9C%8B%E5%A4%96%E6%97%85%E9%81%8A%E6%94%BB%E7%95%A5/

## 本機預覽

```bash
python3 -m http.server 8000
```

在儲存庫根目錄執行後，打開 http://localhost:8000/國外旅遊攻略/ 。
