const { chromium, devices } = require('playwright');
const h = require('./helpers');
const fs = require('fs');
const S = h.OUT;
const GUIDE = h.IDS.FLORENCE;
const ok = h.ok;
const suggestBody = h.suggestBody();


(async () => {
  const b = await chromium.launch();
  const base = h.base();

  // ---------- 主要流程 ----------
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await h.routeExternal(ctx);
  // AI 呼叫：重播剛才真實的推薦結果；選了城市就回傳剛產生的佛羅倫斯攻略（避開這個測試環境瀏覽器的 30 秒限制）
  const fnCalls = [];
  await ctx.route('**/functions/v1/generate-guide', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: 'ok' });
    const body = JSON.parse(r.request().postData());
    fnCalls.push(body);
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: body.city ? JSON.stringify({ id: GUIDE }) : suggestBody });
  });
  // 留言、回報：攔截送出，不寫入資料庫
  const writes = [];
  await ctx.route(/\/rest\/v1\/travel_(comments|reports)/, (r) => {
    if (r.request().method() === 'POST') {
      writes.push(r.request().url().includes('comments') ? 'comment' : 'report');
      return r.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    return r.fallback();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(base);
  await pg.evaluate(() => { try { localStorage.setItem('travel-guide-install-dismissed', '1'); } catch (e) { /* */ } });
  await pg.reload();
  await pg.waitForSelector('#guide-list li');

  ok((await pg.title()) === '下一站｜國外旅遊攻略', '分頁標題：' + (await pg.title()));
  ok((await pg.textContent('.brand span')) === '下一站', 'App 名稱：下一站');
  ok((await pg.textContent('.slogan')).includes('下一站由你決定'), '標語');
  const brandOk = await pg.evaluate(() => { const i = document.querySelector('.brand img'); return i.complete && i.naturalWidth === 192; });
  ok(brandOk, '頁首的新圖示載入');
  ok((await pg.$$('.hero-slides .slide')).length === 6, '首頁 6 張輪播照片');
  await pg.screenshot({ path: S + '/t-home.png' });

  // 只填國家 → 推薦城市
  await pg.selectOption('#g-country-select', '義大利');
  await pg.selectOption('#g-city-select', '');
  await pg.fill('#g-days', '3');
  await pg.fill('#g-budget', '3500');
  await pg.click('#gen-btn');
  await pg.waitForSelector('#suggest-card:not([hidden])');
  const cities = await pg.$$eval('.suggest-city', (l) => l.map((x) => x.textContent));
  ok(cities.length === 5, '推薦 5 個城市：' + cities.join('、'));
  ok(JSON.stringify(fnCalls[0]) === JSON.stringify({ country: '義大利', city: '', days: 3, budget: 3500 }), '只填國家時送出的資料正確');

  // 選佛羅倫斯 → 完整攻略
  const idx = cities.indexOf('佛羅倫斯');
  await pg.click(`.suggest:nth-child(${idx + 1}) .suggest-btn`);
  await pg.waitForFunction(() => location.hash.startsWith('#/guide/'), null, { timeout: 15000 });
  ok(fnCalls[1] && fnCalls[1].city === '佛羅倫斯', '按推薦卡片送出：' + JSON.stringify(fnCalls[1]));
  await pg.waitForSelector('#guide:not([hidden])');
  await pg.waitForTimeout(1500);
  ok((await pg.textContent('#guide-title')).includes('佛羅倫斯'), '攻略標題：' + (await pg.textContent('#guide-title')));
  const heads = await pg.$$eval('#guide-body h3', (h) => h.map((x) => x.textContent.trim()));
  ok(heads.length >= 9, '攻略 ' + heads.length + ' 個段落');
  const days = await pg.$$eval('.days > .day', (d) => d.length);
  const maps = await pg.$$eval('.route-map', (m) => m.map((x) => x.querySelectorAll('.map-pin').length));
  ok(days === 3 && maps.length >= 1, `每日行程 ${days} 天、路線圖 ${maps.length} 張（標記 ${maps.join('/')}）`);
  ok((await pg.$$('.route-nav')).length > 0, 'Google 地圖導航連結 ' + (await pg.$$('.route-nav')).length + ' 個');
  const spots = await pg.$$eval('.spots .spot', (l) => l.map((x) => (x.querySelector('.spot-name') ? x.querySelector('.spot-name').firstChild.textContent : '') + (x.querySelector('.spot-photo img') ? '📷' : '')));
  ok(spots.length >= 4, '必去景點：' + spots.join('、'));

  // 收藏
  await pg.click('#fav-btn');
  await pg.click('.back');
  await pg.waitForSelector('#guide-list a');
  ok((await pg.textContent('#guide-list')).includes('佛羅倫斯'), '收藏後出現在「我的收藏攻略」');
  ok(await pg.isVisible('#suggest-card'), '回首頁推薦城市還在');

  // 留言、回報（攔截，不寫入）
  await pg.click('#guide-list a');
  await pg.waitForSelector('#guide:not([hidden])');
  await pg.fill('#c-body', '測試留言');
  await pg.click('#comment-btn');
  await pg.waitForTimeout(800);
  ok((await pg.textContent('#comment-message')).includes('已送出'), '留言送出（已攔截，沒有寫入資料庫）');
  await pg.fill('#r-detail', '測試回報');
  await pg.click('#report-btn');
  await pg.waitForTimeout(800);
  ok((await pg.textContent('#report-message')).includes('已收到回報'), '回報送出（已攔截，沒有寫入資料庫）');
  ok(writes.join(',') === 'comment,report', '兩筆寫入都被攔截');
  ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), '手機畫面沒有水平捲動');
  ok(errs.length === 0, '沒有程式錯誤 ' + errs.join(';'));
  await ctx.close();

  // ---------- PWA：安裝設定、新圖示、離線 ----------
  const c2 = await b.newContext({ ...devices['Pixel 7'] });
  await h.routeExternal(c2);
  const p2 = await c2.newPage();
  await p2.goto(base);
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.waitForTimeout(2000);
  const icons = await p2.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(href)).json();
    const out = [];
    for (const i of m.icons) {
      const bm = await createImageBitmap(await (await fetch(new URL(i.src, href))).blob());
      out.push(i.sizes + '(' + i.purpose + ')=' + bm.width + 'x' + bm.height);
    }
    return m.name + '｜' + out.join('，');
  });
  ok(icons.startsWith('下一站'), '安裝設定：' + icons);
  const swVer = await p2.evaluate(async () => (await caches.keys()).join(','));
  ok(swVer.includes(h.cacheVersion()), '離線快取版本：' + swVer);
  await p2.reload();
  await c2.setOffline(true);
  await p2.reload();
  await p2.waitForTimeout(1000);
  ok(await p2.isVisible('#offline-message'), '離線時可以開啟並顯示離線提示');
  ok(await p2.evaluate(() => { const i = document.querySelector('.brand img'); return i.complete && i.naturalWidth > 0; }), '離線時圖示仍顯示');
  await b.close();
})()
