// 國外旅遊攻略：請 Gemini 上網搜尋並產生一篇攻略，存進 travel_guides。
//
// 這個函式在 Supabase Edge Function（伺服器端）執行。
// 需要的環境變數：
// - GEMINI_API_KEY：Gemini 的 API 金鑰（secret），請在 Supabase 後台的
//   Edge Functions → Secrets 設定，絕對不要寫進任何檔案。
//   名稱也接受小寫的 gemini_api_key。
// - GEMINI_MODEL（可不設）：使用的模型，預設 gemini-flash-latest。
// - SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY：Supabase 自動提供，不需要設定。
//
// 網頁用 publishable key 呼叫，這個函式要關閉「Verify JWT」。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---- 輸入檢查 ----
type Input = { country: string; city: string | null; days: number; budget: number };

function readInput(raw: unknown): Input | string {
  if (!raw || typeof raw !== "object") return "資料格式錯誤";
  const r = raw as Record<string, unknown>;
  const country = typeof r.country === "string" ? r.country.trim() : "";
  const city = typeof r.city === "string" ? r.city.trim() : "";
  const days = Number(r.days);
  const budget = Number(r.budget);
  if (country.length < 1 || country.length > 50) return "請填寫國家（最多 50 字）";
  if (city.length > 50) return "城市最多 50 字";
  if (!Number.isInteger(days) || days < 1 || days > 14) return "天數必須是 1～14 的整數";
  if (!Number.isInteger(budget) || budget < 0 || budget > 1000000) return "預算必須是 0～1,000,000 的整數";
  return { country, city: city || null, days, budget };
}

// ---- 給 Gemini 的指示 ----
function buildPrompt(i: Input): string {
  const where = i.city ? `${i.country}的${i.city}` : i.country;
  return [
    "你是旅遊攻略編輯。請用 Google 搜尋最新資料，為台灣旅客整理一份國外旅遊攻略。",
    `目的地：${where}`,
    `天數：${i.days} 天`,
    `預算：每人每天約新台幣 ${i.budget} 元（不含機票）`,
    "",
    "要求：",
    "- 全部使用繁體中文（台灣用語）。",
    "- 簽證與入境須知以台灣護照為準，並提醒以官方公告為準。",
    "- 預算請用新台幣，說明每人每天的大約範圍。",
    `- 每日行程剛好 ${i.days} 天。`,
    "- 不要編造網址；資料來源由系統自動記錄，不需要在內容中列出。",
    "",
    "只輸出一個 JSON 物件，不要加任何說明文字或 Markdown，欄位如下：",
    "{",
    '  "country": "國家",',
    '  "city": "城市（多個城市用、分隔）",',
    '  "days": 天數（整數）,',
    '  "season": "適合季節與原因",',
    '  "budget": "預算範圍說明",',
    '  "itinerary": [{ "day": 1, "plan": "第一天行程" }],',
    '  "transport": "機場到市區、當地交通",',
    '  "lodging": "住宿區域建議",',
    '  "food": ["必吃美食"],',
    '  "attractions": ["必去景點"],',
    '  "visa": "簽證與入境須知",',
    '  "notes": "注意事項：治安、禮儀、天氣"',
    "}",
  ].join("\n");
}

// ---- 整理 Gemini 回傳的內容 ----
function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function textList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => text(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

function parseModelJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// 資料來源只採用 Google 搜尋實際回傳的網址，不採用模型自己寫的網址（可能是編造的）。
function groundingSources(candidate: any): { title: string; url: string }[] {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const c of chunks) {
    const url = typeof c?.web?.uri === "string" ? c.web.uri : "";
    if (!/^https:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: text(c?.web?.title, 200) || url.slice(0, 200), url: url.slice(0, 2000) });
    if (out.length >= 15) break;
  }
  return out;
}

function taipeiToday(): string {
  // sv-SE 的日期格式剛好是 YYYY-MM-DD
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

// ---- 主程式 ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "資料格式錯誤" }, 400);
  }
  const input = readInput(raw);
  if (typeof input === "string") return json({ error: input }, 400);

  // 名稱大小寫有分別；後台存成小寫時也能讀到
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("gemini_api_key");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey) return json({ error: "伺服器尚未設定 GEMINI_API_KEY" }, 500);
  if (!supabaseUrl || !serviceKey) return json({ error: "伺服器缺少 Supabase 設定" }, 500);
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

  // 1. 呼叫 Gemini，開啟 Google 搜尋
  let gemini: Response;
  try {
    gemini = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
          tools: [{ google_search: {} }],
        }),
      },
    );
  } catch (e) {
    console.error("Gemini 連線失敗", e);
    return json({ error: "無法連線到 AI 服務，請稍後再試" }, 502);
  }
  if (!gemini.ok) {
    const detail = await gemini.text();
    console.error("Gemini 回傳錯誤", gemini.status, detail);
    if (gemini.status === 429) {
      return json({ error: "AI 免費額度暫時用完，請稍後再試" }, 429);
    }
    // 只回傳錯誤代碼（例如 400 INVALID_ARGUMENT、404 NOT_FOUND），方便判斷原因；不回傳金鑰或詳細內容
    let code = "";
    try {
      const s = JSON.parse(detail)?.error?.status;
      if (typeof s === "string" && /^[A-Z_]{1,40}$/.test(s)) code = " " + s;
    } catch { /* 不是 JSON 時只回傳 HTTP 狀態 */ }
    const hint = gemini.status === 404
      ? "找不到 AI 模型，請檢查 GEMINI_MODEL"
      : gemini.status === 400 || gemini.status === 401 || gemini.status === 403
        ? "AI 金鑰無效或沒有權限，請檢查 Gemini API 金鑰"
        : "AI 服務發生錯誤，請稍後再試";
    return json({ error: `${hint}（Gemini ${gemini.status}${code}）` }, 502);
  }

  const data = await gemini.json();
  const candidate = data?.candidates?.[0];
  const output = (candidate?.content?.parts ?? [])
    .map((p: { text?: string }) => p?.text ?? "")
    .join("");
  const g = parseModelJson(output);
  if (!g) {
    console.error("無法解析 AI 回傳內容", output.slice(0, 2000));
    return json({ error: "AI 回傳的內容格式不正確，請再試一次" }, 502);
  }

  // 2. 整理成資料表的欄位，並限制長度，避免超過資料表的 CHECK
  const itinerary = Array.isArray(g.itinerary)
    ? g.itinerary
        .map((d: any, idx: number) => ({
          day: Number.isInteger(d?.day) ? d.day : idx + 1,
          plan: text(d?.plan, 1000),
        }))
        .filter((d: { plan: string }) => d.plan)
        .slice(0, 14)
    : [];

  const row = {
    req_country: input.country,
    req_city: input.city,
    req_days: input.days,
    req_budget_twd: input.budget,
    country: text(g.country, 50) || input.country,
    city: text(g.city, 100) || input.city || "",
    days: input.days,
    season: text(g.season, 500),
    budget: text(g.budget, 1000),
    itinerary,
    transport: text(g.transport, 3000),
    lodging: text(g.lodging, 2000),
    food: textList(g.food, 20, 200),
    attractions: textList(g.attractions, 20, 200),
    visa: text(g.visa, 3000),
    notes: text(g.notes, 3000),
    sources: groundingSources(candidate),
    compiled_on: taipeiToday(),
    model: model.slice(0, 100),
  };

  // 3. 用 service_role 寫入資料表
  const insert = await fetch(`${supabaseUrl}/rest/v1/travel_guides?select=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!insert.ok) {
    console.error("寫入攻略失敗", insert.status, await insert.text());
    return json({ error: "攻略產生了，但儲存失敗，請稍後再試" }, 500);
  }
  const saved = await insert.json();
  return json({ id: saved?.[0]?.id ?? null });
});
