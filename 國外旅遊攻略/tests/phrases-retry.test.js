// 常用句子：失敗時自動重試一次
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const ok = h.ok;

const PHRASES = {
  mode: 'phrases', country: '韓國', language: '韓文', lang: 'ko-KR',
  phrases: [
    { category: '打招呼', zh: '你好', text: '안녕하세요', reading: 'Annyeonghaseyo' },
    { category: '點餐', zh: '請給我這個', text: '이거 주세요', reading: 'Igeo juseyo' },
    { category: '緊急', zh: '救命', text: '살려주세요', reading: 'Sallyeojuseyo' },
  ],
};

// replies：依序回覆的狀態碼，200 代表成功
async function run(b, name, replies, check) {
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await h.routeExternal(ctx);
  let calls = 0;
  await ctx.route('**/functions/v1/generate-guide', async (r) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: 'ok' });
    const status = replies[Math.min(calls, replies.length - 1)];
    calls++;
    await new Promise((res) => setTimeout(res, 300));
    if (status === 'network') return r.abort();
    if (status === 200) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(PHRASES) });
    const error = status === 429 ? 'AI 免費額度暫時用完，請稍後再試' : 'AI 回傳的內容格式不正確，請再試一次';
    return r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ error }) });
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(h.base());
  await pg.click('#tr-open-hero');
  await pg.selectOption('#tr-country-select', '韓國');
  await pg.click('#ph-btn');
  await check(pg, () => calls);
  ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();

  await run(b, '第一次失敗、重試成功', [502, 200], async (pg, calls) => {
    await pg.waitForFunction(() => document.querySelector('#ph-message').textContent.includes('自動重試'));
    ok(true, '第一次失敗、重試成功：顯示「正在自動重試一次」');
    ok(await pg.isDisabled('#ph-btn'), '第一次失敗、重試成功：重試時按鈕維持「載入中」');
    await pg.waitForSelector('.ph-item', { timeout: 10000 });
    ok((await pg.$$('.ph-item')).length === 3 && calls() === 2, '第一次失敗、重試成功：自動重試後顯示句子（呼叫 2 次）');
    ok(!(await pg.isVisible('#ph-message')) && !(await pg.isVisible('#ph-btn')), '第一次失敗、重試成功：訊息與按鈕收起');
    const saved = await pg.evaluate(() => localStorage.getItem('nextstop-phrases:韓國'));
    ok(!!saved && JSON.parse(saved).phrases.length === 3, '第一次失敗、重試成功：句子存在手機裡');
  });

  await run(b, '兩次都失敗', [502, 503], async (pg, calls) => {
    await pg.waitForFunction(() => document.querySelector('#ph-message').textContent.includes('載入失敗'), null, { timeout: 10000 });
    const msg = await pg.textContent('#ph-message');
    ok(calls() === 2, '兩次都失敗：只重試一次（呼叫 2 次）');
    ok(msg.includes('已自動重試一次') && msg.includes('格式不正確'), '兩次都失敗：說明已重試與原因 →「' + msg + '」');
    ok(!(await pg.isDisabled('#ph-btn')) && (await pg.textContent('#ph-btn')) === '載入常用句子', '兩次都失敗：按鈕恢復，可以再按');
    await pg.waitForTimeout(2500);
    ok(calls() === 2, '兩次都失敗：不會一直重試');
  });

  await run(b, '額度用完', [429, 200], async (pg, calls) => {
    await pg.waitForFunction(() => document.querySelector('#ph-message').textContent.includes('載入失敗'), null, { timeout: 10000 });
    await pg.waitForTimeout(2000);
    ok(calls() === 1, '額度用完：不重試（重試也沒用）');
    ok((await pg.textContent('#ph-message')).includes('額度'), '額度用完：顯示額度用完的原因');
  });

  await run(b, '網路斷線一次', ['network', 200], async (pg, calls) => {
    await pg.waitForSelector('.ph-item', { timeout: 10000 });
    ok(calls() === 2, '網路斷線一次：自動重試後成功');
  });

  await run(b, '重試前換了國家', [502, 200], async (pg, calls) => {
    await pg.waitForFunction(() => document.querySelector('#ph-message').textContent.includes('自動重試'));
    await pg.selectOption('#tr-country-select', '日本');
    await pg.waitForTimeout(2500);
    ok(calls() === 1, '重試前換了國家：不再替舊的國家重試');
    ok(!(await pg.isDisabled('#ph-btn')), '重試前換了國家：按鈕可以按');
    ok((await pg.$$('.ph-item')).length === 0, '重試前換了國家：不會顯示韓國的句子');
  });

  await b.close();
  h.finish();
})().catch(h.crash);
