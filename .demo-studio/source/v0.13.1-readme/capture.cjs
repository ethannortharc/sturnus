// Usage: node capture.cjs /path/to/playwright [--record]
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { state, board, transcript } = require('./fixtures.cjs');
const repo = path.resolve(__dirname, '../../..');
const record = process.argv.includes('--record');
const take = `${record ? 'record' : 'rehearsal'}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const output = path.join(repo, '.demo-studio/capture/v0.13.1-readme', take);
const origin = 'http://sturnus-demo.local';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const frame = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(/fonts/inter.woff2)}*{box-sizing:border-box}body{margin:0;width:1440px;height:1000px;color:#eeece7;font-family:Inter,-apple-system,sans-serif;background:radial-gradient(ellipse at 20% -10%,#36342f 0,transparent 65%),#171719;overflow:hidden}
header{position:absolute;inset:26px 40px auto;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:650;letter-spacing:-.7px}.brand img{width:38px;height:38px;border:1px solid #555;border-radius:11px}.agents{font-size:11px;color:#aaa79f;letter-spacing:2.2px;font-weight:550}
.chapter{position:absolute;top:82px;left:42px;right:42px;display:flex;align-items:baseline;justify-content:space-between}h1{margin:0;font-size:34px;font-weight:550;letter-spacing:-1.1px;line-height:1.1}.step{font-size:11px;font-weight:550;letter-spacing:2px;color:#bcaf99;text-transform:uppercase}
.window{position:absolute;left:40px;top:143px;width:1360px;height:809px;border:1px solid #57544e;border-radius:14px;overflow:hidden;box-shadow:0 26px 65px #0008}iframe{display:block;border:0;width:100%;height:100%;background:#0f0f10}
footer{position:absolute;left:43px;right:43px;bottom:19px;display:flex;justify-content:space-between;color:#8b8983;font-size:10px;letter-spacing:.6px}.version{color:#c5b99f}#pointer{position:fixed;left:-50px;top:-50px;width:23px;height:29px;z-index:100;pointer-events:none;filter:drop-shadow(0 2px 3px #0009)}#ring{position:fixed;left:0;top:0;width:40px;height:40px;border:2px solid #e4c796;border-radius:50%;opacity:0;pointer-events:none;z-index:99;transform:translate(-50%,-50%) scale(.3)}
</style></head><body><header><div class="brand"><img src="/icon.svg" alt="Sturnus">Sturnus</div><div class="agents">CLAUDE CODE &nbsp; / &nbsp; CODEX &nbsp; / &nbsp; CURSOR</div></header>
<div class="chapter"><h1 id="headline">Know what needs you.</h1><span class="step" id="chapter">01 / Workspace</span></div>
<div class="window"><iframe id="product" src="/app/#/w/studio" title="Sturnus product"></iframe></div>
<footer><span>Actual interface · Sample workspace data</span><span class="version">STURNUS 0.13.1</span></footer>
<svg id="pointer" viewBox="0 0 24 30"><path d="M3 2v23l6-6 5 9 4-2-5-9h9z" fill="#fff" stroke="#171719" stroke-width="1.7" stroke-linejoin="round"/></svg><div id="ring"></div>
</body></html>`;

(async () => {
 await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: record ? 1 : 2, colorScheme: 'dark', locale: 'en-US', timezoneId: 'America/Los_Angeles',
  ...(record ? { recordVideo: { dir: output, size: { width: 1440, height: 1000 } } } : {}) });
 const errors = [], requests = [], chapters = [];
 await context.addInitScript(() => { localStorage.setItem('deck.lang', '"en"'); localStorage.setItem('deck.theme', '"dark"'); localStorage.setItem('deck.wsColor', '"stripe"'); });
 await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  requests.push(`${req.method()} ${url.pathname}`);
  try {
   assert.equal(url.origin, origin, 'External requests are forbidden');
   assert.equal(req.method(), 'GET', 'No mutations in the demo');
   if (url.pathname === '/api/state') return route.fulfill({ json: state });
   if (url.pathname === '/api/board') return route.fulfill({ json: board });
   if (url.pathname === '/api/transcript') return route.fulfill({ json: transcript });
   if (url.pathname === '/') return route.fulfill({ body: frame, contentType: 'text/html' });
   if (url.pathname.startsWith('/api/')) throw Error('Unexpected API: ' + url.pathname);
   const rel = url.pathname === '/app/' ? 'index.html' : url.pathname.replace(/^\/(app\/)?/, '');
   const file = path.resolve(repo, 'web', rel);
   assert.ok(file.startsWith(path.join(repo, 'web') + path.sep));
   return route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  } catch (e) { errors.push(e.message); await route.abort(); }
 });
 try {
  const videoStart = Date.now();
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  const app = page.frameLocator('#product');
  try { await app.locator('#wsWorks .works').waitFor({timeout:5000}); } catch (e) {
   await page.screenshot({path:path.join(output,'failure.png')});
   console.error(JSON.stringify({errors,requests,debug:await app.locator('body').evaluate(()=>{try{render();return document.body.innerText}catch(e){return e.stack}})},null,2)); throw e;
  }
  await page.evaluate(() => document.fonts.ready);
  await app.locator('body').evaluate(() => document.fonts.ready);
  const started = Date.now();
  console.log(JSON.stringify({output,phase:"ready"}));
  const hold = ms => page.waitForTimeout(record ? ms : 250);
  const point = async (x, y) => {
   await page.evaluate(([x,y]) => { const p = document.querySelector('#pointer'); p.style.left = x+'px'; p.style.top = y+'px'; }, [x,y]);
  };
  let pointer = { x: 1390, y: 920 };
  async function move(x, y) {
   const steps = record ? 24 : 1;
   for (let i=1;i<=steps;i++) { const u=i/steps, k=u*u*(3-2*u), px=pointer.x+(x-pointer.x)*k, py=pointer.y+(y-pointer.y)*k;
    await page.mouse.move(px,py); if(record) { await point(px,py); await page.waitForTimeout(13); }
   }
   pointer={x,y};
  }
  async function click(locator) {
   await locator.waitFor(); const b=await locator.boundingBox(); assert.ok(b);
   await move(b.x+b.width/2,b.y+b.height/2);
   if(record) await page.evaluate(({x,y})=>{const r=document.querySelector('#ring');r.style.left=x+'px';r.style.top=y+'px';r.animate([{opacity:.8,transform:'translate(-50%,-50%) scale(.3)'},{opacity:0,transform:'translate(-50%,-50%) scale(1.2)'}],{duration:520});},pointer);
   await locator.click();
  }
  async function chapter(title, label) {
   console.log(label);
   chapters.push({ seconds:(Date.now()-started)/1000, title, label });
   await page.evaluate(({title,label})=>{document.querySelector('#headline').textContent=title;document.querySelector('#chapter').textContent=label;},{title,label});
  }
  async function still(name) {
   if(record)return;
   await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
  }
  await chapter('Know what needs you.', '01 / Workspace');
  await hold(3500); await still('workspace');
  await chapter('Follow the work. Across agents.', '02 / Work items');
  await click(app.locator('#side a[href="#/w/studio/works"]'));
  await app.locator('.works tbody tr').first().waitFor(); await hold(2500);
  await click(app.locator('.works tbody tr[data-href="#/p/atlas-api"]').first());
  await app.locator('.wi').first().waitFor(); await move(1396,965); await hold(3200); await still('project');
  await chapter('Open the session. Keep the context.', '03 / Session');
  await click(app.locator('.wi-s[data-go="review"]'));
  await app.locator('.need-box').waitFor(); await hold(2400);
  await click(app.locator('[data-tab-go="chat"]'));
  await app.locator('.bub').first().waitFor(); await move(1396,965); await hold(3200);
  await chapter('Decisions, progress, and what comes next.', '04 / Report');
  await click(app.locator('[data-tab-go="report"]'));
  await app.locator('.rep-one').waitFor(); await move(1396,965); await hold(3200);
  await chapter('Find any session with a few keystrokes.', '05 / Search');
  await app.locator('body').press('Meta+k');
  await app.locator('#paletteQ').pressSequentially('api-builder',{delay:record?95:0});
  await app.locator('.p-row').first().waitFor(); await hold(1400);
  await app.locator('#paletteQ').press('Enter');
  await app.locator('.kid-list').waitFor(); await hold(1800);
  await chapter('Give every agent the same context.', '06 / Channel');
  await click(app.locator('#crumbs a[href="#/p/atlas-api"]'));
  await click(app.locator('[data-ptab="board"]'));
  await app.locator('.post').first().waitFor(); await move(1396,965); await hold(4000); await still('channel');
  await chapter('Your agents. One workspace.', 'STURNUS / 0.13.1');
  await click(app.locator('#side a[href="#/w/studio"]'));
  await app.locator('#wsWorks .works').waitFor(); await move(1396,965); await hold(2500);
  assert.deepEqual(errors,[],'No browser or request errors');
  assert.ok(requests.every(r=>r.startsWith('GET ')));
  await fs.writeFile(path.join(output,'capture.json'),JSON.stringify({version:state.version,source:'ab1db6f',record,readyOffset:(started-videoStart)/1000,viewport:{width:1440,height:1000},chapters,requests,errors},null,2));
  const video=page.video(); await context.close(); if(video)await video.saveAs(path.join(output,'walkthrough.webm'));
  console.log(JSON.stringify({output,record,chapters,errors}));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
