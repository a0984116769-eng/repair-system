// 語音輸入被系統擋下（service-not-allowed）時的提示
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const S = h.OUT;
const ok = h.ok;
const BLOCKED_REC = () => {
  class Rec {
    start() { setTimeout(() => { this.onerror && this.onerror({ error: 'service-not-allowed' }); this.onend && this.onend(); }, 50); }
    stop() {} abort() {}
  }
  window.SpeechRecognition = Rec; window.webkitSpeechRecognition = Rec;
};
const IOS_UA = devices['iPhone 13'].userAgent;
const cases = [
  ['iPhone Safari', { ...devices['iPhone 13'] }, false, '啟用聽寫'],
  ['iPhone 主畫面 App', { ...devices['iPhone 13'] }, true, '主畫面打開的 App'],
  ['LINE 內建瀏覽器', { ...devices['iPhone 13'], userAgent: IOS_UA + ' Line/14.0.0' }, false, '用瀏覽器開啟'],
  ['Android Chrome', { ...devices['Pixel 7'] }, false, '鍵盤上的 🎤'],
];
(async () => {
  const b = await chromium.launch();
  const base = h.base();
  for (const [name, dev, standalone, expect] of cases) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block' });
    await h.routeExternal(ctx);
    await ctx.addInitScript(BLOCKED_REC);
    if (standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
    let calls = 0;
    await ctx.route('**/functions/v1/**', (r) => { calls++; r.abort(); });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(base);
    await pg.click('#tr-open-hero');
    await pg.selectOption('#tr-country-select', '日本');
    ok(await pg.isVisible('#tr-mic'), name + '：一開始顯示麥克風');
    await pg.click('#tr-mic');
    await pg.waitForSelector('#tr-mic-hint:not([hidden])');
    const hint = await pg.textContent('#tr-mic-hint');
    ok(hint.includes(expect), name + '：說明怎麼解決 →「' + hint + '」');
    ok(!(await pg.isVisible('#tr-mic')), name + '：被擋下後不再顯示麥克風');
    ok(!(await pg.isVisible('#tr-message')), name + '：不再顯示「請改用打字」的紅色錯誤');
    ok(await pg.evaluate(() => document.activeElement.id) === 'tr-text', name + '：游標移到輸入框，可以直接用鍵盤聽寫');
    ok(calls === 0, name + '：沒有送出翻譯');
    if (name === 'iPhone 主畫面 App') await pg.locator('.tr-sheet-box').screenshot({ path: S + '/micblock-standalone.png' });
    // 同一次開啟中重新整理：直接顯示說明
    await pg.reload();
    await pg.click('#tr-open-hero');
    ok(!(await pg.isVisible('#tr-mic')) && (await pg.textContent('#tr-mic-hint')).includes(expect), name + '：重新整理後直接顯示說明，不用再按一次錯誤');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  h.finish();
})().catch(h.crash);
