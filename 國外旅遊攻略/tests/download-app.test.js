const { chromium, devices } = require('playwright');
const h = require('./helpers');
const SP = h.OUT;
const fs = require('fs');

const ok = h.ok;
(async () => {
  const b = await chromium.launch();
  const cases = [
    ['iphone', devices['iPhone 13'], 'app-steps-ios'],
    ['android', devices['Pixel 7'], 'app-steps-android'],
    ['desktop', { viewport: { width: 1280, height: 800 } }, 'app-steps-desktop'],
  ];
  for (const [name, dev, shown] of cases) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block' });
    await h.routeExternal(ctx);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(h.base());
    ok(await p.isVisible('#get-app-hero'), name + ': hero button visible');
    ok(await p.isVisible('#get-app-foot') || (await p.$('#get-app-foot')) && !(await p.$eval('#get-app-foot', e => e.hidden)), name + ': footer button present');
    await p.click('#get-app-hero');
    ok(await p.isVisible('#app-dialog'), name + ': dialog opens');
    for (const id of ['app-steps-ios', 'app-steps-android', 'app-steps-desktop'])
      ok((await p.isVisible('#' + id)) === (id === shown), name + ': ' + id + (id === shown ? ' shown' : ' hidden'));
    ok(await p.evaluate(() => document.activeElement.id) === 'app-dialog-close', name + ': focus on close');
    if (name === 'desktop') {
      ok(await p.$eval('.app-qr img', i => i.complete && i.naturalWidth > 0), 'desktop: QR image loads');
    }
    await p.screenshot({ path: SP + '/getapp-' + name + '.png' });
    await p.keyboard.press('Escape');
    ok(!(await p.isVisible('#app-dialog')), name + ': Escape closes');
    ok(await p.evaluate(() => document.activeElement.id) === 'get-app-hero', name + ': focus returns');
    await p.click('#get-app-foot');
    ok(await p.isVisible('#app-dialog'), name + ': footer button opens');
    await p.click('#app-dialog .app-dialog-backdrop', { position: { x: 10, y: 10 } });
    ok(!(await p.isVisible('#app-dialog')), name + ': backdrop closes');
    if (name === 'android') {
      // simulate a native install prompt
      await p.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = () => { window.__prompted = true; };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
      });
      await p.click('#get-app-hero');
      ok(await p.evaluate(() => window.__prompted === true), 'android: native install prompt used');
      ok(!(await p.isVisible('#app-dialog')), 'android: no dialog when native prompt exists');
      await p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      ok(!(await p.isVisible('#get-app-hero')) && !(await p.isVisible('#get-app-foot')), 'android: buttons hidden after install');
    }
    ok(errs.length === 0, name + ': no JS errors ' + errs.join('|'));
    await ctx.close();
  }
  // standalone mode
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await h.routeExternal(ctx);
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  const p = await ctx.newPage(); await p.goto(h.base());
  ok(!(await p.isVisible('#get-app-hero')), 'standalone: buttons hidden');
  await b.close();
  h.finish();
})().catch(h.crash);
