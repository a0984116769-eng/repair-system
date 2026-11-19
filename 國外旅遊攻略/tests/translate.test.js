// 旅行翻譯的畫面測試（AI 回應用假資料，避開這個環境瀏覽器的 30 秒限制）
const { chromium, devices } = require('playwright');
const h = require('./helpers');
const S = h.OUT;
const GUIDE = h.IDS.FLORENCE; // 佛羅倫斯（義大利）
const ok = h.ok;
const CATS = {
  '打招呼': [['你好', 'Buongiorno', 'bwon-JOR-no'], ['謝謝', 'Grazie', 'GRAH-tsee-eh'], ['不好意思', 'Mi scusi', 'mee SKOO-zee']],
  '點餐': [['請給我菜單', 'Il menù, per favore', ''], ['我對堅果過敏', 'Sono allergico alla frutta a guscio', ''], ['請結帳', 'Il conto, per favore', '']],
  '問路與交通': [['請問車站怎麼走？', 'Come arrivo alla stazione?', ''], ['這班車到市中心嗎？', 'Questo autobus va in centro?', ''], ['請帶我到這個地址', 'Mi porti a questo indirizzo, per favore', '']],
  '購物': [['這個多少錢？', 'Quanto costa?', ''], ['可以刷卡嗎？', 'Posso pagare con la carta?', ''], ['我只是看看', 'Sto solo guardando', '']],
  '住宿': [['我有訂房', 'Ho una prenotazione', ''], ['幾點退房？', "A che ora è il check-out?", ''], ['可以寄放行李嗎？', 'Posso lasciare i bagagli?', '']],
  '緊急': [['請幫幫我', 'Aiuto!', ''], ['我需要醫生', 'Ho bisogno di un medico', ''], ['我的護照不見了', 'Ho perso il passaporto', '']],
};
const PHRASES = { mode: 'phrases', country: '義大利', language: '義大利文', lang: 'it-IT',
  phrases: Object.entries(CATS).flatMap(([c, l]) => l.map(([zh, text, reading]) => ({ category: c, zh, text, reading }))) };

async function openTr(pg) {
  await pg.waitForSelector('#tr-fab:not([hidden])', { timeout: 20000 });
  await pg.click('#tr-fab');
  await pg.waitForSelector('#tr-sheet:not([hidden])');
}

(async () => {
  const b = await chromium.launch();
  const base = h.base();
  for (const [name, dev, scheme] of [['phone', devices['iPhone 13'], 'light'], ['phone-dark', devices['iPhone 13'], 'dark'], ['desk', { viewport: { width: 1280, height: 900 } }, 'light']]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block', colorScheme: scheme });
    await h.routeExternal(ctx);
    const calls = [];
    let failNext = false;
    await ctx.route('**/functions/v1/generate-guide', (r) => {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: h, body: 'ok' });
      const body = JSON.parse(r.request().postData());
      calls.push(body);
      if (failNext) { failNext = false; return r.fulfill({ status: 429, headers: h, contentType: 'application/json', body: JSON.stringify({ error: 'AI 免費額度暫時用完，請稍後再試' }) }); }
      if (body.translate) return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ mode: 'translate', language: '義大利文', lang: 'it-IT', source: body.translate.text, text: 'Scusi, come arrivo alla stazione?', reading: '', back: '不好意思，請問我要怎麼到車站？' }) });
      if (body.phrases) return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify(PHRASES) });
      return r.abort();
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(base);
    await pg.evaluate(() => { try { localStorage.setItem('travel-guide-install-dismissed', '1'); } catch (e) { /* */ } });
    await pg.goto(base + '#/guide/' + GUIDE);
    await openTr(pg);
    ok((await pg.textContent('#tr-intro')).includes('義大利'), name + '：說明寫出國家「義大利」');
    ok(await pg.isVisible('#ph-btn'), name + '：還沒載入時有「載入常用句子」按鈕');

    // 空白送出
    await pg.click('#tr-btn');
    ok((await pg.textContent('#tr-message')).includes('請輸入'), name + '：沒輸入就按翻譯會提醒');
    ok(calls.length === 0, name + '：空白時不呼叫 AI');

    // 錯誤處理
    failNext = true;
    await pg.fill('#tr-text', '請問車站怎麼走？');
    await pg.click('#tr-btn');
    await pg.waitForFunction(() => document.querySelector('#tr-message').textContent.includes('翻譯失敗'));
    ok((await pg.textContent('#tr-message')).includes('額度'), name + '：AI 額度用完時顯示原因');

    // 翻譯成功
    await pg.click('#tr-btn');
    await pg.waitForSelector('#tr-result:not([hidden])');
    const last = calls[calls.length - 1];
    ok(last.translate && last.translate.country === '義大利' && last.translate.text === '請問車站怎麼走？', name + '：送出國家和要翻譯的話');
    ok((await pg.textContent('.tr-text')) === 'Scusi, come arrivo alla stazione?', name + '：顯示譯文');
    ok((await pg.getAttribute('.tr-text', 'lang')) === 'it-IT', name + '：譯文標上語言（朗讀發音正確）');
    ok((await pg.textContent('.tr-back')).includes('車站'), name + '：顯示意思讓旅客確認');
    ok(!(await pg.isVisible('#tr-message')), name + '：成功後清掉錯誤訊息');
    ok((await pg.textContent('#tr-btn')) === '翻譯' && !(await pg.isDisabled('#tr-btn')), name + '：按鈕恢復');
    if (name === 'phone') await pg.locator('.tr-sheet-box').screenshot({ path: S + '/tr-preview-result.png' });

    // 給對方看
    await pg.click('.tr-actions button:has-text("給對方看")');
    ok(await pg.isVisible('#show-card'), name + '：「給對方看」放大顯示');
    ok((await pg.textContent('#show-text')) === 'Scusi, come arrivo alla stazione?', name + '：放大的是譯文');
    ok((await pg.textContent('#show-zh')).includes('請問車站怎麼走'), name + '：下面附上中文原句');
    if (name === 'phone') await pg.screenshot({ path: S + '/tr-preview-show.png' });
    await pg.keyboard.press('Escape');
    ok(!(await pg.isVisible('#show-card')), name + '：Esc 關閉');

    // 常用句子
    await pg.click('#ph-btn');
    await pg.waitForSelector('.ph-item');
    ok((await pg.$$('.ph-item')).length === 18, name + '：顯示 18 句常用句子');
    ok((await pg.$$('.ph-cat')).length === 6, name + '：分成 6 類');
    ok(!(await pg.isVisible('#ph-btn')), name + '：載入後隱藏按鈕');
    await pg.click('.ph-item >> nth=4');
    ok((await pg.textContent('#show-text')) === 'Sono allergico alla frutta a guscio', name + '：點句子放大顯示');
    await pg.click('#show-card');
    ok(!(await pg.isVisible('#show-card')), name + '：點畫面關閉');
    if (name === 'phone' || name === 'phone-dark' || name === 'desk') {
      await pg.locator('.tr-sheet-box').screenshot({ path: S + '/tr-preview-' + name + '.png' });
    }

    // 重新整理後不用網路也有常用句子
    const before = calls.length;
    await ctx.route('**/functions/v1/generate-guide', (r) => r.abort());
    await pg.reload();
    await openTr(pg);
    ok((await pg.$$('.ph-item')).length === 18 && calls.length === before, name + '：重新打開時直接用存好的句子，不再呼叫 AI');

    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    ok(!overflow, name + '：沒有左右捲動');
    ok(errs.length === 0, name + '：沒有程式錯誤 ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  h.finish();
})().catch(h.crash);
