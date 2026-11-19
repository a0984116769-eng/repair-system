// 攻略頁「必買伴手禮」卡片
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const ok = h.ok;

// 測試用的虛構伴手禮資料（店名為範例）
const GIFTS = [
  { kind: '食品', name: '範例咖啡豆', name_local: 'Caffè Esempio', why: '老字號自家烘焙。', where: '範例咖啡（萬神殿旁本店）', price: '約 10～15 歐元', carry: '可以帶回台灣', tips: '可以先試喝' },
  { kind: '酒類', name: '檸檬酒', name_local: 'Limoncello', why: '經典餐後酒。', where: '範例食品店（車站店）', price: '約 8～20 歐元', carry: '液體放託運', tips: '' },
  { kind: '工藝品', name: '手工皮手套', name_local: '', why: '', where: '', price: '約 50 歐元', carry: '', tips: '' },
  { kind: '', name: '<img src=x onerror=alert(1)>', name_local: '', why: '', where: '', price: '', carry: '', tips: '' },
];

(async () => {
  const b = await chromium.launch();
  for (const [name, dev, scheme] of [['phone', devices['iPhone 13'], 'light'], ['phone-dark', devices['iPhone 13'], 'dark'], ['desk', { viewport: { width: 1200, height: 900 } }, 'light']]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx);
    await ctx.route(/\/rest\/v1\/travel_guides/, (r) => {
      const url = r.request().url();
      const rows = h.GUIDES.filter((g) => url.includes(g.id)).map((g) => (g.id === h.IDS.ROME ? { ...g, souvenirs: GIFTS } : g));
      r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(rows) });
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.on('dialog', (d) => { errs.push('跳出對話框：' + d.message()); d.dismiss(); });
    await pg.goto(h.base() + '#/guide/' + h.IDS.ROME);
    await pg.waitForSelector('.gift-list', { timeout: 20000 });

    const heads = await pg.$$eval('#guide-body h3', (l) => l.map((x) => x.textContent.trim()));
    const i = heads.findIndex((t) => t.includes('必買伴手禮'));
    ok(i > heads.findIndex((t) => t.includes('必去景點')) && i < heads.findIndex((t) => t.includes('簽證')), name + '：「必買伴手禮」在必去景點之後、簽證之前');
    ok((await pg.$$('.gift')).length === 4, name + '：4 張伴手禮卡片');
    const first = await pg.$eval('.gift', (li) => li.textContent);
    ok(first.includes('範例咖啡豆') && first.includes('Caffè Esempio') && first.includes('哪裡買') && first.includes('帶回台灣') && first.includes('小提醒'), name + '：卡片有品名、當地名稱、哪裡買、價格、帶回台灣、小提醒');
    ok((await pg.$eval('.gift .eat-tag', (e) => e.className)).includes('gift-food'), name + '：食品用食品的顏色標籤');
    const links = await pg.$$eval('.gift .eat-map', (l) => l.map((a) => a.href));
    ok(links.length === 2 && decodeURIComponent(links[0]).includes('範例咖啡（萬神殿旁本店） 羅馬'), name + '：有店家的才有 Google 地圖連結，並帶上城市');
    const third = await pg.$eval('.gift:nth-child(3)', (li) => li.textContent);
    ok(!third.includes('哪裡買') && !third.includes('小提醒'), name + '：沒有資料的欄位不顯示');
    ok((await pg.$$('.gift img')).length === 0 && (await pg.textContent('.gift:nth-child(4) .eat-name')).includes('<img'), name + '：AI 回傳的文字當成純文字顯示，不會變成網頁元素');
    ok((await pg.textContent('.gift-note')).includes('肉類製品') , name + '：顯示帶回台灣的注意事項');
    ok((await pg.textContent('#guide-body')).includes('伴手禮由 AI 依上網搜尋的資料推薦'), name + '：說明資料來源與整理日期');
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, name + '：沒有左右捲動');

    // 舊攻略沒有伴手禮：不顯示這一段
    await pg.goto(h.base() + '#/guide/' + h.IDS.KANAZAWA);
    await pg.waitForFunction(() => document.querySelector('#guide-title').textContent.includes('金澤'), null, { timeout: 20000 });
    ok(!(await pg.textContent('#guide-body')).includes('必買伴手禮'), name + '：沒有伴手禮資料的舊攻略不顯示這一段');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  h.finish();
})().catch(h.crash);
