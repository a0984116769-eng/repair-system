// 語音輸入測試：用假的語音辨識模擬「說話」
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const S = h.OUT;
const GUIDE = h.IDS.FLORENCE;
const ok = h.ok;

// 假的語音辨識：window.__say 決定這次「聽到」什麼，或發生什麼錯誤
const FAKE = () => {
  window.__recs = [];
  window.__say = { parts: ['請問', '車站怎麼走'], error: null, hold: false };
  class FakeRec {
    constructor() { this.lang = ''; window.__recs.push(this); }
    start() {
      const plan = window.__say;
      this.started = true;
      setTimeout(() => {
        if (plan.error) { this.onerror && this.onerror({ error: plan.error }); this.onend && this.onend(); return; }
        let text = '';
        if (!plan.parts.length) { setTimeout(() => this.onend && this.onend(), 100); return; }
        plan.parts.forEach((p, i) => {
          setTimeout(() => {
            text += p;
            const res = [[{ transcript: text }]];
            this.onresult && this.onresult({ results: res });
            if (i === plan.parts.length - 1 && !plan.hold) setTimeout(() => this.onend && this.onend(), 50);
          }, 100 * (i + 1));
        });
      }, 50);
    }
    stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 30); }
    abort() { this.aborted = true; this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }
  }
  window.webkitSpeechRecognition = FakeRec;
  window.SpeechRecognition = FakeRec;
};

async function openTr(pg) {
  await pg.waitForSelector('#tr-fab:not([hidden])', { timeout: 20000 });
  await pg.click('#tr-fab');
  await pg.waitForSelector('#tr-sheet:not([hidden])');
}

(async () => {
  const b = await chromium.launch();
  const base = h.base();

  for (const [name, dev, scheme] of [['phone', devices['Pixel 7'], 'light'], ['phone-dark', devices['Pixel 7'], 'dark']]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx);
    await ctx.addInitScript(FAKE);
    const calls = [];
    await ctx.route('**/functions/v1/generate-guide', (r) => {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: h, body: 'ok' });
      const body = JSON.parse(r.request().postData());
      calls.push(body);
      return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ mode: 'translate', language: '義大利文', lang: 'it-IT', source: body.translate.text, text: 'Scusi, come arrivo alla stazione?', reading: '', back: '不好意思，請問我要怎麼到車站？' }) });
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(base);
    await pg.evaluate(() => { try { localStorage.setItem('travel-guide-install-dismissed', '1'); } catch (e) { /* */ } });
    await pg.goto(base + '#/guide/' + GUIDE);
    await openTr(pg);

    ok(await pg.isVisible('#tr-mic'), name + '：支援的瀏覽器顯示麥克風按鈕');
    ok(!(await pg.isVisible('#tr-mic-hint')), name + '：支援時不顯示不支援的說明');

    // 說話 → 自動翻譯
    await pg.evaluate(() => { window.__say = { parts: ['請問', '車站怎麼走'], error: null, hold: true }; });
    await pg.click('#tr-mic');
    ok((await pg.getAttribute('#tr-mic', 'aria-pressed')) === 'true', name + '：聆聽中按鈕變成「停止」狀態');
    ok((await pg.textContent('#tr-message')).includes('正在聽'), name + '：顯示「正在聽」');
    ok(await pg.evaluate(() => window.__recs[0].lang === 'zh-TW'), name + '：用繁體中文（台灣）辨識');
    await pg.waitForFunction(() => document.querySelector('#tr-text').value === '請問車站怎麼走');
    ok(true, name + '：邊說邊把文字填進輸入框');
    if (name === 'phone' || name === 'phone-dark') await pg.locator('#tr-form').screenshot({ path: S + '/mic-listening-' + name + '.png' });
    // 按一下停止 → 結束後自動翻譯
    await pg.click('#tr-mic');
    await pg.waitForSelector('#tr-result:not([hidden])');
    ok(calls.length === 1 && calls[0].translate.text === '請問車站怎麼走', name + '：說完自動送出翻譯');
    ok((await pg.getAttribute('#tr-mic', 'aria-pressed')) === 'false', name + '：結束後按鈕恢復');
    if (name === 'phone') await pg.locator('.tr-sheet-box').screenshot({ path: S + '/mic-done-phone.png', clip: undefined });

    // 接在已有文字後面
    await pg.fill('#tr-text', '你好，');
    await pg.evaluate(() => { window.__say = { parts: ['謝謝'], error: null, hold: false }; });
    await pg.click('#tr-mic');
    await pg.waitForFunction((n) => window.__calls === undefined && document.querySelector('#tr-result') && true, 1);
    await pg.waitForFunction(() => !document.querySelector('#tr-mic').classList.contains('listening'));
    await pg.waitForTimeout(300);
    ok((await pg.inputValue('#tr-text')) === '你好，謝謝', name + '：語音內容接在原本的文字後面');
    ok(calls.length === 2, name + '：再次自動翻譯');

    // 錯誤：不允許麥克風
    await pg.evaluate(() => { window.__say = { parts: [], error: 'not-allowed' }; });
    await pg.click('#tr-mic');
    await pg.waitForFunction(() => document.querySelector('#tr-message').textContent.includes('允許'));
    ok((await pg.textContent('#tr-message')).includes('允許'), name + '：拒絕麥克風時說明要允許');
    ok(calls.length === 2, name + '：出錯時不送出翻譯');
    ok((await pg.getAttribute('#tr-mic', 'aria-pressed')) === 'false', name + '：出錯後按鈕恢復');

    // 沒聽到聲音
    await pg.evaluate(() => { window.__say = { parts: [], error: null }; });
    await pg.click('#tr-mic');
    await pg.waitForFunction(() => document.querySelector('#tr-message').textContent.includes('沒有聽到'));
    ok(calls.length === 2, name + '：沒聽到聲音時提醒，不送出');

    // 換頁時停止聆聽
    await pg.evaluate(() => { window.__say = { parts: ['測試'], error: null, hold: true }; });
    await pg.click('#tr-mic');
    await pg.waitForTimeout(150);
    await pg.goto(base + '#/');
    await pg.goto(base + '#/guide/' + GUIDE);
    await openTr(pg);
    ok(await pg.evaluate(() => window.__recs[window.__recs.length - 1].aborted === true), name + '：換頁時停止聆聽');
    ok((await pg.getAttribute('#tr-mic', 'aria-pressed')) === 'false', name + '：回來時按鈕是待命狀態');
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, name + '：沒有左右捲動');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }

  // 不支援語音辨識的瀏覽器（iPhone 模擬）
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await h.routeExternal(ctx);
  await ctx.addInitScript(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(base + '#/guide/' + GUIDE);
  await openTr(pg);
  ok(!(await pg.isVisible('#tr-mic')), '不支援時：不顯示麥克風按鈕');
  ok((await pg.textContent('#tr-mic-hint')).includes('鍵盤上的 🎤'), '不支援時（iPhone）：提示用鍵盤聽寫');
  ok(errs.length === 0, '不支援時：沒有程式錯誤 ' + errs.join(' | '));
  await pg.locator('#tr-form').screenshot({ path: S + '/mic-unsupported.png' });
  await ctx.close();

  await b.close();
  h.finish();
})().catch(h.crash);
