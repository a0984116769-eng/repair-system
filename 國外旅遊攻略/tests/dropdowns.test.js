// 國家、城市下拉選單測試
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const S = h.OUT;
const ok = h.ok;
(async () => {
  const b = await chromium.launch();
  const base = h.base();
  for (const [name, dev, scheme] of [['phone', devices['iPhone 13'], 'light'], ['phone-dark', devices['iPhone 13'], 'dark'], ['desk', { viewport: { width: 1280, height: 900 } }, 'light']]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx);
    const calls = [];
    await ctx.route('**/functions/v1/generate-guide', (r) => {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: h, body: 'ok' });
      calls.push(JSON.parse(r.request().postData()));
      return r.fulfill({ status: 500, headers: h, contentType: 'application/json', body: JSON.stringify({ error: '測試用，不真的產生' }) });
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(base);
    await pg.waitForSelector('#g-country-select option', { state: 'attached' });

    const groups = await pg.$$eval('#g-country-select optgroup', (g) => g.map((x) => x.label));
    const nCountries = await pg.$$eval('#g-country-select optgroup option', (o) => o.length);
    ok(groups.length >= 6 && nCountries >= 30, name + `：國家選單分 ${groups.length} 區（${groups.join('、')}），共 ${nCountries} 國`);
    ok((await pg.$eval('#g-country-select', (s) => s.options[s.selectedIndex].text)) === '請選擇國家', name + '：一開始顯示「請選擇國家」');
    ok((await pg.$eval('#g-city-select', (s) => s.options[s.selectedIndex].text)).includes('不指定'), name + '：城市預設「不指定，推薦 5 個城市」');
    ok(!(await pg.isVisible('#g-country')) && !(await pg.isVisible('#g-city')), name + '：預設不顯示自己輸入的欄位');
    if (name !== 'desk') await pg.locator('#gen-form .row').first().screenshot({ path: S + '/sel-empty-' + name + '.png' });

    // 沒選國家就送出
    await pg.click('#gen-btn');
    ok((await pg.textContent('#gen-message')).includes('國家') && calls.length === 0, name + '：沒選國家時提醒，不送出');
    ok((await pg.getAttribute('#g-country-select', 'aria-invalid')) === 'true', name + '：國家選單標示紅框');

    // 選日本 → 城市清單
    await pg.selectOption('#g-country-select', '日本');
    const cities = await pg.$$eval('#g-city-select optgroup option', (o) => o.map((x) => x.value));
    ok(cities.includes('京都') && cities.includes('沖繩') && cities.length >= 10, name + '：選日本後列出熱門城市（' + cities.slice(0, 5).join('、') + '…）');
    ok((await pg.inputValue('#g-country')) === '日本', name + '：國家值帶入「日本」');
    ok((await pg.getAttribute('#country-picks button:nth-child(1)', 'aria-pressed')) === 'true', name + '：下方「日本」快選同步亮起');
    ok((await pg.getAttribute('#g-country-select', 'aria-invalid')) === 'false', name + '：選了之後紅框消失');
    await pg.selectOption('#g-city-select', '京都');
    ok((await pg.inputValue('#g-city')) === '京都', name + '：城市值帶入「京都」');
    if (name !== 'desk') await pg.locator('#gen-form .row').first().screenshot({ path: S + '/sel-japan-' + name + '.png' });
    else await pg.locator('#gen-form').screenshot({ path: S + '/sel-desk.png' });

    // 換國家 → 城市清掉
    await pg.selectOption('#g-country-select', '泰國');
    ok((await pg.inputValue('#g-city')) === '' && (await pg.$eval('#g-city-select', (s) => s.value)) === '', name + '：換國家時城市回到「不指定」');
    ok((await pg.$$eval('#g-city-select optgroup option', (o) => o.map((x) => x.value))).includes('清邁'), name + '：城市清單換成泰國的城市');

    // 其他城市
    await pg.selectOption('#g-city-select', '__other__');
    ok(await pg.isVisible('#g-city'), name + '：選「其他城市」出現輸入框');
    ok(await pg.evaluate(() => document.activeElement.id) === 'g-city', name + '：游標自動移到輸入框');
    await pg.fill('#g-city', '拜縣');
    // 其他國家
    await pg.selectOption('#g-country-select', '__other__');
    ok(await pg.isVisible('#g-country') && !(await pg.isVisible('#g-city')), name + '：選「其他國家」出現國家輸入框，城市輸入框收起');
    await pg.fill('#g-country', '秘魯');
    const cityOpts = await pg.$$eval('#g-city-select option', (o) => o.map((x) => x.value));
    ok(cityOpts.length === 2, name + '：自訂國家時城市只有「不指定」與「其他」');
    await pg.selectOption('#g-city-select', '__other__');
    await pg.fill('#g-city', '庫斯科');
    if (name === 'phone') await pg.locator('#gen-form .row').first().screenshot({ path: S + '/sel-other-' + name + '.png' });
    await pg.fill('#g-days', '4');
    await pg.click('#gen-btn');
    await pg.waitForFunction(() => document.querySelector('#gen-message').textContent.includes('失敗'));
    const last = calls[calls.length - 1];
    ok(last && last.country === '秘魯' && last.city === '庫斯科' && last.days === 4, name + '：自己輸入的國家、城市正確送出 ' + JSON.stringify(last));

    // 快選按鈕 → 下拉選單同步
    await pg.click('#country-picks button:has-text("韓國")');
    ok((await pg.$eval('#g-country-select', (s) => s.value)) === '韓國' && !(await pg.isVisible('#g-country')), name + '：點「韓國」快選，下拉選單同步、輸入框收起');
    ok((await pg.inputValue('#g-city')) === '', name + '：換國家時清掉原本的城市');
    await pg.selectOption('#g-city-select', '釜山');
    await pg.click('#gen-btn');
    await pg.waitForTimeout(400);
    const last2 = calls[calls.length - 1];
    ok(last2.country === '韓國' && last2.city === '釜山', name + '：下拉選的國家、城市正確送出');

    // 只選國家 → 推薦城市模式（city 為空）
    await pg.selectOption('#g-city-select', '');
    await pg.click('#gen-btn');
    await pg.waitForTimeout(400);
    ok(calls[calls.length - 1].city === '', name + '：城市「不指定」時送出空白（推薦 5 個城市）');

    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, name + '：沒有左右捲動');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  h.finish();
})().catch(h.crash);
