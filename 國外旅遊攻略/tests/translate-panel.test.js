// 翻譯浮動按鈕（攻略頁）＋首頁入口＋下方滑出面板
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const S = h.OUT;
const GUIDE = h.IDS.FLORENCE; // 義大利・佛羅倫斯
const ok = h.ok;
const JA = { language: '日文', lang: 'ja-JP', phrases: [{ category: '打招呼', zh: '你好', text: 'こんにちは', reading: 'Konnichiwa' }] };

(async () => {
  const b = await chromium.launch();
  const base = h.base();
  for (const [name, dev, scheme] of [['phone', devices['iPhone 13'], 'light'], ['phone-dark', devices['iPhone 13'], 'dark'], ['desk', { viewport: { width: 1280, height: 860 } }, 'light']]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx);
    const calls = [];
    await ctx.route('**/functions/v1/generate-guide', (r) => {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: h, body: 'ok' });
      const body = JSON.parse(r.request().postData());
      calls.push(body);
      const c = body.translate.country;
      const map = { '義大利': ['義大利文', 'it-IT', 'Dov\'è il bagno?'], '日本': ['日文', 'ja-JP', 'トイレはどこですか？'] };
      const [language, lang, text] = map[c] || ['英文', 'en-US', 'Where is the restroom?'];
      return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ mode: 'translate', language, lang, source: body.translate.text, text, reading: '', back: '廁所在哪裡？' }) });
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(base);
    await pg.evaluate((ja) => {
      try { localStorage.setItem('travel-guide-install-dismissed', '1'); localStorage.setItem('nextstop-phrases:日本', JSON.stringify(ja)); } catch (e) { /* */ }
    }, JA);
    await pg.reload();
    await pg.waitForSelector('#guide-list');

    // 首頁：沒有浮動按鈕，有「翻譯」入口
    ok(!(await pg.isVisible('#tr-fab')), name + '：首頁不顯示浮動按鈕');
    ok(await pg.isVisible('#tr-open-hero'), name + '：首頁上方有「翻譯」按鈕');
    if (name !== 'phone-dark') await pg.locator('.hero').screenshot({ path: S + '/sheet-home-' + name + '.png' });
    await pg.click('#tr-open-hero');
    await pg.waitForSelector('#tr-sheet:not([hidden])');
    ok((await pg.inputValue('#tr-country')) === '', name + '：第一次從首頁打開，國家是空的');
    ok((await pg.$eval('#tr-country-select', (x) => x.options[x.selectedIndex].text)) === '請選擇國家', name + '：下拉選單顯示「請選擇國家」');
    ok((await pg.$$eval('#tr-country-select optgroup option', (o) => o.length)) >= 80, name + '：翻譯的國家選單和搜尋表單一樣有 80 多國');
    // 下拉選泰國 → 再選其他自己輸入
    await pg.selectOption('#tr-country-select', '泰國');
    ok((await pg.inputValue('#tr-country')) === '泰國' && (await pg.getAttribute('#tr-country-picks button[data-country="泰國"]', 'aria-pressed')) === 'true', name + '：下拉選「泰國」，快選同步亮起');
    await pg.selectOption('#tr-country-select', '__other__');
    ok(await pg.isVisible('#tr-country') && (await pg.inputValue('#tr-country')) === '', name + '：選「其他國家」出現輸入框');
    ok(await pg.evaluate(() => document.activeElement.id) === 'tr-country', name + '：游標移到輸入框');
    await pg.fill('#tr-country', '亞美尼亞');
    await pg.press('#tr-country', 'Tab');
    ok((await pg.textContent('#tr-intro')).includes('亞美尼亞') && (await pg.$eval('#tr-country-select', (x) => x.value)) === '__other__', name + '：自己輸入的「亞美尼亞」生效，選單維持「其他」');
    if (name === 'phone') await pg.locator('.tr-sheet-box').screenshot({ path: S + '/trsel-other-phone.png' });
    await pg.evaluate(() => { const s = document.querySelector('#tr-country-select'); s.selectedIndex = 0; s.dispatchEvent(new Event('change')); });
    await pg.fill('#tr-text', '廁所在哪裡');
    await pg.click('#tr-btn');
    ok((await pg.textContent('#tr-message')).includes('請先選擇要去的國家') && calls.length === 0, name + '：沒選國家時提醒，不呼叫 AI');
    await pg.click('#tr-country-picks button[data-country="日本"]');
    ok((await pg.inputValue('#tr-country')) === '日本', name + '：點常用國家帶入「日本」');
    ok((await pg.$eval('#tr-country-select', (x) => x.value)) === '日本' && !(await pg.isVisible('#tr-country')), name + '：國家下拉選單同步顯示「日本」');
    ok((await pg.getAttribute('#tr-country-picks button[data-country="日本"]', 'aria-pressed')) === 'true', name + '：選中的國家亮起');
    ok((await pg.$$('.ph-item')).length === 1 && !(await pg.isVisible('#ph-btn')), name + '：日本已存的常用句子直接顯示');
    await pg.click('#tr-btn');
    await pg.waitForSelector('#tr-result:not([hidden])');
    ok(calls[0].translate.country === '日本' && (await pg.textContent('.tr-text')) === 'トイレはどこですか？', name + '：首頁入口翻譯成日文');
    if (name !== 'desk') await pg.screenshot({ path: S + '/sheet-open-home-' + name + '.png' });
    else await pg.screenshot({ path: S + '/sheet-open-desk.png' });
    ok(await pg.evaluate(() => document.documentElement.classList.contains('sheet-open')), name + '：面板打開時背景不捲動');

    // 關閉方式：✕
    await pg.click('#tr-close');
    ok(!(await pg.isVisible('#tr-sheet')), name + '：按 ✕ 關閉');
    ok(await pg.evaluate(() => document.activeElement.id) === 'tr-open-hero', name + '：關閉後焦點回到按鈕');

    // 再打開：記得上次的國家與譯文
    await pg.click('#tr-open-hero');
    ok((await pg.inputValue('#tr-country')) === '日本' && await pg.isVisible('#tr-result'), name + '：再打開時保留國家與剛才的譯文');
    // 點背景關閉
    await pg.mouse.click(10, 10);
    ok(!(await pg.isVisible('#tr-sheet')), name + '：點外面關閉');

    // 攻略頁：浮動按鈕，國家自動帶入
    await pg.goto(base + '#/guide/' + GUIDE);
    await pg.waitForSelector('#tr-fab:not([hidden])', { timeout: 20000 });
    ok(true, name + '：攻略頁出現右下角「翻譯」浮動按鈕');
    ok(await pg.evaluate(() => getComputedStyle(document.querySelector('#tr-fab')).position === 'fixed'), name + '：浮動按鈕固定在畫面上');
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await pg.waitForTimeout(200);
    ok(await pg.isVisible('#tr-fab'), name + '：捲到中間仍看得到按鈕');
    if (name !== 'desk') await pg.screenshot({ path: S + '/sheet-fab-' + name + '.png' });
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pg.waitForTimeout(200);
    const cover = await pg.evaluate(() => {
      const f = document.querySelector('#tr-fab').getBoundingClientRect();
      const btn = document.querySelector('#report-card button[type="submit"], #report-card button');
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      return !(r.bottom <= f.top || r.top >= f.bottom || r.right <= f.left || r.left >= f.right);
    });
    ok(!cover, name + '：捲到底時按鈕不會蓋住回報的送出鈕');
    await pg.click('#tr-fab');
    await pg.waitForSelector('#tr-sheet:not([hidden])');
    ok((await pg.inputValue('#tr-country')) === '義大利', name + '：從攻略打開時自動帶入攻略的國家「義大利」');
    ok((await pg.$eval('#tr-country-select', (x) => x.value)) === '義大利', name + '：下拉選單顯示「義大利」');
    ok(!(await pg.isVisible('#tr-result')), name + '：換國家時清掉上一個國家的譯文');
    ok(!(await pg.isVisible('#tr-fab')), name + '：面板打開時隱藏浮動按鈕');
    ok(await pg.isVisible('#ph-btn'), name + '：義大利還沒存常用句子時顯示載入按鈕');
    await pg.fill('#tr-text', '廁所在哪裡');
    await pg.click('#tr-btn');
    await pg.waitForSelector('#tr-result:not([hidden])');
    ok(calls[calls.length - 1].translate.country === '義大利', name + '：用攻略的國家翻譯');
    if (name !== 'desk') await pg.screenshot({ path: S + '/sheet-open-guide-' + name + '.png' });
    // Esc：先關大字卡片，再關面板
    await pg.click('.tr-actions button:has-text("給對方看")');
    await pg.keyboard.press('Escape');
    ok(!(await pg.isVisible('#show-card')) && await pg.isVisible('#tr-sheet'), name + '：Esc 先只關「給對方看」');
    await pg.keyboard.press('Escape');
    ok(!(await pg.isVisible('#tr-sheet')) && await pg.isVisible('#tr-fab'), name + '：再按 Esc 關閉面板，浮動按鈕回來');

    // 換頁時面板關閉、首頁不顯示浮動按鈕
    await pg.click('#tr-fab');
    await pg.goto(base + '#/');
    await pg.waitForTimeout(300);
    ok(!(await pg.isVisible('#tr-sheet')) && !(await pg.isVisible('#tr-fab')), name + '：回首頁時面板關閉、浮動按鈕消失');
    // 首頁入口記得最後用的國家
    await pg.click('#tr-open-hero');
    ok((await pg.inputValue('#tr-country')) === '義大利', name + '：首頁入口帶入最後使用的國家');
    await pg.click('#tr-close');

    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, name + '：沒有左右捲動');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }
  // 手機上往下滑關閉
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', hasTouch: true });
  await h.routeExternal(ctx);
  const pg = await ctx.newPage();
  await pg.goto(base);
  await pg.click('#tr-open-hero');
  await pg.waitForSelector('#tr-sheet:not([hidden])');
  await pg.evaluate(() => {
    const g = document.querySelector('#tr-grip');
    const t = (y) => new Touch({ identifier: 1, target: g, clientX: 100, clientY: y });
    g.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }));
    g.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(420)], bubbles: true }));
  });
  ok(!(await pg.isVisible('#tr-sheet')), '手機：在面板上方往下滑就關閉');
  await ctx.close();
  await b.close();
  h.finish();
})().catch(h.crash);
