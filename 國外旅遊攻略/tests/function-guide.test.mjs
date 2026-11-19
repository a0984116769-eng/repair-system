// 用假的 Gemini、Tavily、資料庫測試 generate-guide
import { createRequire } from 'module';
const h = createRequire(import.meta.url)('./helpers.js');
const env = { gemini_api_key: 'k', SUPABASE_URL: 'https://db', SUPABASE_SERVICE_ROLE_KEY: 'srv' };
let handler;
globalThis.Deno = { serve: (f) => { handler = f; }, env: { get: (k) => env[k] } };
let log, tavilyMode, oldRow;
const guide = { country: '日本', city: '大阪', itinerary: [], attractions: [], hotels: [] };
const days = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

globalThis.fetch = async (u, o = {}) => {
  if (u.includes('api.tavily.com')) {
    log.tavily.push(JSON.parse(o.body).query + ' | ' + o.headers.Authorization);
    if (tavilyMode === 'fail') return new Response('boom', { status: 500 });
    const q = JSON.parse(o.body).query;
    return new Response(JSON.stringify({ results: [1, 2].map((n) => ({ title: q.slice(0, 8) + n, url: `https://ex.com/${encodeURIComponent(q)}/${n}`, content: '內容' + n, score: n / 10 })).concat([{ title: 'bad', url: 'javascript:x', content: 'x' }]) }));
  }
  if (u.includes('generativelanguage')) {
    log.prompt = JSON.parse(o.body).contents[0].parts[0].text;
    const body = log.prompt.includes('推薦這個國家裡 5 個') ? { country: '日本', cities: [{ city: '東京', outline: [] }] } : guide;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }));
  }
  if (u.includes('wikipedia')) return new Response('{}');
  if (u.startsWith('https://db/rest/v1/travel_guides?id=eq.') && (!o.method || o.method === 'GET')) {
    log.db.push('GET');
    return new Response(JSON.stringify(oldRow ? [oldRow] : []));
  }
  if (u.startsWith('https://db/rest/v1/travel_guides')) {
    log.db.push(o.method + ' ' + u.replace('https://db/rest/v1/', ''));
    log.row = JSON.parse(o.body);
    return new Response('[{"id":"11111111-1111-1111-1111-111111111111"}]', { status: o.method === 'POST' ? 201 : 200 });
  }
  throw new Error('unexpected ' + u);
};
await h.loadFunction();

async function call(body) {
  log = { tavily: [], db: [] };
  const r = await handler(new Request('http://f', { method: 'POST', body: JSON.stringify(body) }));
  return [r.status, await r.json()];
}
const ok = h.ok;
const NEW = { country: '日本', city: '大阪', days: 2, budget: 3000 };
const ID = '11111111-1111-1111-1111-111111111111';

// 1. 有搜尋金鑰：新攻略
env.TAVILY_API_KEY = 'tvly-test'; tavilyMode = 'ok';
let [st, b] = await call(NEW);
ok(st === 200 && b.web_verified === true, '有金鑰：產生成功、web_verified=true');
ok(log.tavily.length === 4 && log.tavily.every((x) => x.endsWith('Bearer tvly-test')), '搜尋 4 次，金鑰放在 Authorization');
ok(log.prompt.includes('網路搜尋結果') && log.prompt.includes('內容1'), 'AI 指示裡有搜尋結果');
ok(log.row.web_verified === true && log.row.sources.length === 10 && log.row.sources.every((s) => /^https:/.test(s.url)), '資料來源：8 個搜尋網址＋2 個官方網站，沒有 javascript: 網址');
ok(log.db.join() === 'POST travel_guides?select=id', '新攻略用 POST 新增');

// 2. 搜尋失敗：退回不查證
tavilyMode = 'fail';
[st, b] = await call(NEW);
ok(st === 200 && b.web_verified === false && log.row.sources.length === 2 && !log.prompt.includes('網路搜尋結果'), '搜尋失敗：照常產生，web_verified=false，只有官方網站');

// 3. 只填國家：不搜尋
tavilyMode = 'ok';
[st, b] = await call({ country: '日本', city: '', days: 2, budget: 3000 });
ok(st === 200 && b.mode === 'suggest' && log.tavily.length === 0, '推薦城市模式不搜尋（節省額度）');

// 4. 重新產生
oldRow = { req_country: '日本', req_city: '京都', req_days: 3, req_budget_twd: 2500, compiled_on: days(40) };
[st, b] = await call({ regenerate_id: ID });
ok(st === 200 && b.regenerated === true && log.db.join() === 'GET,PATCH travel_guides?id=eq.' + ID + '&select=id', '超過 30 天：用 PATCH 更新同一篇');
ok(log.prompt.includes('目的地：日本的京都') && log.prompt.includes('天數：3 天') && log.prompt.includes('2500'), '用當初的條件（京都 3 天 2500）重新產生');

oldRow.compiled_on = days(10);
[st, b] = await call({ regenerate_id: ID });
ok(st === 409 && log.tavily.length === 0 && !log.db.includes('PATCH'), '30 天內：拒絕（409），不搜尋也不改資料：' + b.error);

oldRow.compiled_on = days(40); oldRow.req_city = null;
[st, b] = await call({ regenerate_id: ID });
ok(st === 200 && !b.mode && log.db.some((x) => x.startsWith('PATCH')), '舊攻略沒有城市：一樣產生完整攻略，不會變成推薦模式');

oldRow = null;
[st, b] = await call({ regenerate_id: ID });
ok(st === 404, '找不到攻略：404');
[st, b] = await call({ regenerate_id: 'bad' });
ok(st === 400, '編號格式錯誤：400');

delete env.TAVILY_API_KEY;
[st, b] = await call({ regenerate_id: ID });
ok(st === 503, '沒有搜尋金鑰：不重新產生（503）：' + b.error);
[st, b] = await call(NEW);
ok(st === 200 && b.web_verified === false && log.tavily.length === 0, '沒有搜尋金鑰：新攻略照常產生，不上網');

// 速度：先試回應快的 Flash-Lite
{
  const realFetch = globalThis.fetch;
  const models = [];
  globalThis.fetch = (u, o) => {
    if (String(u).includes('generativelanguage')) models.push(decodeURIComponent(String(u).split('/models/')[1].split(':')[0]));
    return realFetch(u, o);
  };
  env.TAVILY_API_KEY = 'tvly-test'; tavilyMode = 'ok';
  await call(NEW);
  ok(models[0] === 'gemini-3.5-flash-lite', '產生攻略：第一個試的是 Flash-Lite（' + models[0] + '）');
  models.length = 0;
  await call({ country: '日本', days: 3, budget: 3000 });
  ok(models[0] === 'gemini-3.5-flash-lite', '推薦城市：第一個試的是 Flash-Lite（' + models[0] + '）');
  globalThis.fetch = realFetch;
}

h.finish();
