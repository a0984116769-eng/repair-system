// 測試：5 等待進度、7 分享／轉移收藏、8 對方說 → 中文
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const fs = require('fs');
const S = h.OUT;
const ROME = h.IDS.ROME;
const KANAZAWA = h.IDS.KANAZAWA;
const BUSAN = h.IDS.BUSAN;
const suggestBody = h.suggestBody();
const ok = h.ok;
const FAKE_REC = () => {
  window.__recs = [];
  class FakeRec {
    constructor() { window.__recs.push(this); }
    start() { setTimeout(() => { this.onresult && this.onresult({ results: [[{ transcript: window.__say || '' }]] }); setTimeout(() => this.onend && this.onend(), 30); }, 60); }
    stop() { setTimeout(() => this.onend && this.onend(), 30); }
    abort() { this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
};

(async () => {
  const b = await chromium.launch();
  const base = h.base();
  for (const [name, dev, scheme] of [['phone', devices['iPhone 13'], 'light'], ['phone-dark', devices['iPhone 13'], 'dark'], ['desk', { viewport: { width: 1280, height: 900 } }, 'light']]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx);
    await ctx.addInitScript(FAKE_REC);
    const calls = [];
    let delay = 0;
    let failGen = false;
    await ctx.route('**/functions/v1/generate-guide', async (r) => {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: h, body: 'ok' });
      const body = JSON.parse(r.request().postData());
      calls.push(body);
      if (body.translate) {
        const t = body.translate;
        const out = t.direction === 'to_zh'
          ? { mode: 'translate', direction: 'to_zh', language: '日文', lang: 'ja-JP', source: t.text, text: '這班電車會停京都車站嗎？', reading: 'Kono densha wa Kyōto-eki ni tomarimasu ka?', back: '' }
          : { mode: 'translate', direction: 'to_local', language: '日文', lang: 'ja-JP', source: t.text, text: 'はい、止まります。', reading: 'Hai, tomarimasu.', back: '是的，會停。' };
        return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify(out) });
      }
      if (delay) await new Promise((res) => setTimeout(res, delay));
      if (failGen) return r.fulfill({ status: 429, headers: h, contentType: 'application/json', body: JSON.stringify({ error: 'AI 免費額度暫時用完，請稍後再試' }) });
      return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: body.city ? JSON.stringify({ id: ROME }) : suggestBody });
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(base);
    await pg.evaluate(() => { try { localStorage.setItem('travel-guide-install-dismissed', '1'); } catch (e) { /* */ } });
    await pg.reload();
    await pg.waitForSelector('#guide-list li');

    // ===== 5. 等待進度 =====
    delay = 2600;
    await pg.selectOption('#g-country-select', '義大利');
    await pg.selectOption('#g-city-select', '羅馬');
    await pg.click('#gen-btn');
    await pg.waitForSelector('#gen-progress:not([hidden])');
    ok(true, name + '：按搜尋後出現進度區');
    ok((await pg.$$('#gp-steps li')).length === 3, name + '：完整攻略顯示 3 個步驟');
    ok((await pg.getAttribute('#gp-steps li:nth-child(1)', 'class')) === 'active', name + '：第 1 步「上網搜尋」進行中');
    ok(!(await pg.isVisible('#gen-message')), name + '：等待時不另外顯示文字訊息');
    await pg.waitForTimeout(1300);
    const w1 = await pg.$eval('#gp-fill', (e) => parseFloat(e.style.width));
    ok(w1 > 0 && w1 < 95, name + '：進度條會往前走（' + w1 + '%）');
    ok(/已等待 \d+ 秒/.test(await pg.textContent('#gp-time')), name + '：顯示已等待秒數：' + (await pg.textContent('#gp-time')));
    if (name === 'phone' || name === 'phone-dark') await pg.locator('#gen-form').locator('xpath=ancestor::section[1]').screenshot({ path: S + '/f5-progress-' + name + '.png' });
    await pg.waitForFunction(() => location.hash.startsWith('#/guide/'), null, { timeout: 15000 });
    ok(true, name + '：完成後跳到攻略頁');
    await pg.goto(base + '#/');
    await pg.waitForTimeout(1000);
    ok(!(await pg.isVisible('#gen-progress')), name + '：回到首頁時進度區已收起');
    // 推薦城市：2 個步驟
    await pg.selectOption('#g-country-select', '義大利');
    await pg.selectOption('#g-city-select', '');
    await pg.click('#gen-btn');
    await pg.waitForSelector('#gen-progress:not([hidden])');
    ok((await pg.$$('#gp-steps li')).length === 2, name + '：推薦城市模式顯示 2 個步驟');
    await pg.waitForSelector('#suggest-card:not([hidden])', { timeout: 15000 });
    ok((await pg.$$eval('#gp-steps li', (l) => l.every((x) => x.className === 'done'))), name + '：完成時所有步驟打勾');
    // 失敗
    failGen = true;
    await pg.click('#gen-btn');
    await pg.waitForFunction(() => document.querySelector('#gen-message').textContent.includes('產生失敗'), null, { timeout: 15000 });
    ok(!(await pg.isVisible('#gen-progress')) && (await pg.textContent('#gen-message')).includes('額度'), name + '：失敗時收起進度並說明原因');
    failGen = false; delay = 0;

    // ===== 7. 分享／轉移收藏 =====
    await pg.click('#share-favs');
    ok((await pg.textContent('#fav-dialog-sub')).includes('還沒有收藏'), name + '：沒有收藏時說明要先收藏');
    ok(!(await pg.isVisible('#fav-qr')), name + '：沒有收藏時不顯示 QR Code');
    await pg.keyboard.press('Escape');
    ok(!(await pg.isVisible('#fav-dialog')), name + '：Esc 關閉');
    await pg.evaluate((ids) => { localStorage.setItem('travel-guide-favorites', JSON.stringify(ids)); }, [ROME, KANAZAWA]);
    await pg.reload();
    await pg.waitForFunction(() => document.querySelector('#guide-list').textContent.includes('羅馬'), null, { timeout: 15000 });
    await pg.click('#share-favs');
    const link = await pg.inputValue('#fav-link');
    ok(link.endsWith('#/import/' + ROME + ',' + KANAZAWA), name + '：連結包含 2 篇收藏');
    ok(await pg.$eval('#fav-qr svg', (s) => s.querySelectorAll('rect, path').length > 0), name + '：畫出 QR Code');
    ok((await pg.textContent('#fav-dialog-sub')).includes('共 2 篇'), name + '：顯示收藏篇數');
    if (name !== 'desk') await pg.locator('#fav-dialog .app-dialog-box').screenshot({ path: S + '/f7-share-' + name + '.png' });
    await pg.click('#fav-dialog-close');

    // 另一台裝置（全新瀏覽器）打開連結
    const ctx2 = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx2);
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errs.push('新裝置：' + e.message));
    await p2.goto(base);
    await p2.evaluate((id) => { localStorage.setItem('travel-guide-install-dismissed', '1'); localStorage.setItem('travel-guide-favorites', JSON.stringify([id])); }, BUSAN);
    await p2.goto(link);
    await p2.waitForSelector('#import-box:not([hidden])');
    await p2.waitForFunction(() => document.querySelector('#import-list').children.length === 2, null, { timeout: 15000 });
    const names = await p2.$$eval('#import-list li', (l) => l.map((x) => x.textContent));
    ok(names.some((t) => t.includes('羅馬')) && names.some((t) => t.includes('金澤')), name + '：新裝置看到要匯入的攻略：' + names.join('、'));
    ok((await p2.textContent('#import-yes')).includes('加入 2 篇收藏'), name + '：按鈕寫出篇數');
    if (name !== 'desk') await p2.locator('#import-box').locator('xpath=ancestor::section[1]').screenshot({ path: S + '/f7-import-' + name + '.png' });
    await p2.click('#import-yes');
    await p2.waitForFunction(() => document.querySelector('#import-title').textContent.includes('已加入'));
    const stored = await p2.evaluate(() => JSON.parse(localStorage.getItem('travel-guide-favorites')));
    ok(stored.length === 3 && stored.includes(ROME) && stored.includes(KANAZAWA) && stored.includes(BUSAN), name + '：加入後保留原本的收藏（共 3 篇）');
    ok(p2.url().endsWith('#/'), name + '：網址回到首頁，重新整理不會再問一次');
    await p2.waitForFunction(() => document.querySelectorAll('#guide-list li a').length === 3, null, { timeout: 15000 });
    ok(true, name + '：收藏清單出現 3 篇');
    // 再開一次同樣的連結
    await p2.goto(link);
    await p2.waitForSelector('#import-box:not([hidden])');
    ok((await p2.textContent('#import-title')).includes('已經在你的收藏'), name + '：重複匯入時說明已經收藏過');
    await p2.click('#import-no');
    ok(!(await p2.isVisible('#import-box')), name + '：按關閉收起');
    // 壞掉的連結
    await p2.goto(base + '#/import/abc,123');
    await p2.waitForSelector('#import-box:not([hidden])');
    ok((await p2.textContent('#import-title')).includes('不正確'), name + '：不正確的連結會提醒');
    // 不加入
    await p2.evaluate(() => localStorage.setItem('travel-guide-favorites', '[]'));
    await p2.goto(base + '#/');
    await p2.goto(link);
    await p2.waitForFunction(() => !document.querySelector('#import-yes').hidden, null, { timeout: 15000 });
    await p2.click('#import-no');
    ok((await p2.evaluate(() => localStorage.getItem('travel-guide-favorites'))) === '[]', name + '：按「不用了」不會加入');
    await ctx2.close();

    // ===== 8. 對方說 → 中文 =====
    await pg.click('#tr-open-hero');
    await pg.selectOption('#tr-country-select', '日本');
    ok((await pg.getAttribute('#tr-dir-out', 'aria-pressed')) === 'true', name + '：預設「我說中文 → 當地語」');
    await pg.click('#tr-dir-in');
    ok((await pg.getAttribute('#tr-dir-in', 'aria-pressed')) === 'true', name + '：切到「對方說 → 中文」');
    ok(await pg.isVisible('#tr-handoff') && (await pg.textContent('#tr-text-label')) === '對方說的話', name + '：顯示給對方看的英文提示，欄位改成「對方說的話」');
    ok((await pg.textContent('#tr-intro')).includes('當地人說的話翻成中文'), name + '：說明改成翻成中文');
    // 對方用說的
    await pg.evaluate(() => { window.__say = 'この電車は京都駅に止まりますか'; });
    await pg.click('#tr-mic');
    await pg.waitForSelector('#tr-result:not([hidden])');
    const rec = await pg.evaluate(() => window.__recs[window.__recs.length - 1].lang);
    ok(rec === 'ja-JP', name + '：對方說話時用日文辨識（' + rec + '）');
    const last = calls[calls.length - 1].translate;
    ok(last.direction === 'to_zh' && last.text === 'この電車は京都駅に止まりますか', name + '：送出方向 to_zh 與對方說的話');
    ok((await pg.textContent('.tr-text')) === '這班電車會停京都車站嗎？' && (await pg.getAttribute('.tr-text', 'lang')) === 'zh-TW', name + '：顯示中文翻譯');
    ok((await pg.textContent('.tr-source')).includes('京都駅') && (await pg.textContent('.tr-lang')).includes('日文 → 中文'), name + '：顯示原文與「日文 → 中文」');
    if (name !== 'desk') await pg.screenshot({ path: S + '/f8-reverse-' + name + '.png' });
    // 回覆
    await pg.click('.tr-actions button:has-text("我要回覆")');
    ok((await pg.getAttribute('#tr-dir-out', 'aria-pressed')) === 'true' && await pg.evaluate(() => document.activeElement.id) === 'tr-text', name + '：按「我要回覆」切回我說中文，游標在輸入框');
    ok(!(await pg.isVisible('#tr-handoff')), name + '：英文提示收起');
    await pg.evaluate(() => { window.__say = '是的，會停'; });
    await pg.click('#tr-mic');
    await pg.waitForSelector('#tr-result:not([hidden])');
    ok((await pg.evaluate(() => window.__recs[window.__recs.length - 1].lang)) === 'zh-TW', name + '：我說話時用中文辨識');
    ok(calls[calls.length - 1].translate.direction === 'to_local' && (await pg.textContent('.tr-text')) === 'はい、止まります。', name + '：回覆翻成日文');
    // 自己輸入的國家（清單沒有）→ 對方說用英文辨識
    await pg.selectOption('#tr-country-select', '__other__');
    await pg.fill('#tr-country', '亞美尼亞');
    await pg.press('#tr-country', 'Tab');
    await pg.click('#tr-dir-in');
    await pg.evaluate(() => { window.__say = 'hello'; });
    await pg.click('#tr-mic');
    await pg.waitForSelector('#tr-result:not([hidden])');
    ok((await pg.evaluate(() => window.__recs[window.__recs.length - 1].lang)) === 'en-US', name + '：清單外的國家，對方說話先用英文辨識');
    await pg.click('#tr-close');

    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, name + '：沒有左右捲動');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  h.finish();
})().catch(h.crash);
