// Usage: node verify.cjs /path/to/playwright (after rendering README HTML with gh api markdown)
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../..'),out=path.join(repo,'.demo-studio/_production/readme');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1180,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url()); assert.equal(u.origin,'http://review.local');
   if(u.pathname==='/video')return r.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#171719"><video controls muted playsinline style="width:100%;height:100vh" src="/docs/media/v0.13.1/walkthrough.mp4"></video></body>'});
   if(u.pathname==='/README.md'||u.pathname==='/README.zh-CN.md')return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1f2328;max-width:900px;margin:40px auto;padding:32px;border:1px solid #d1d9e0;border-radius:6px}h1,h2{border-bottom:1px solid #d1d9e0;padding-bottom:.3em}h1{font-size:32px}h2{font-size:24px;margin-top:32px}h3{font-size:20px}img{max-width:100%;height:auto}a{color:#0969da;text-decoration:none}pre,code{background:#f6f8fa;border-radius:6px}pre{padding:16px;overflow:auto}code{font-size:85%}table{border-collapse:collapse}td,th{border:1px solid #d1d9e0;padding:6px 13px}tr:nth-child(even){background:#f6f8fa}blockquote{border-left:4px solid #d1d9e0;padding:0 16px;margin-left:0;color:#59636e}</style>'+await fs.readFile(path.join(out,u.pathname.slice(1)+'.html'),'utf8')});
   const file=path.resolve(repo,'.'+u.pathname);assert.ok(file.startsWith(repo+path.sep));
   const type={'.png':'image/png','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4'}[path.extname(file)];
   await r.fulfill({body:await fs.readFile(file),contentType:type||'text/plain'});
  });
  for(const name of ['README.md','README.zh-CN.md']){
   await page.goto('http://review.local/'+name); await page.locator('img').last().waitFor();
   await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
   // The Markdown API omits heading IDs; GitHub adds these slugs on repository pages.
   await page.locator('h1,h2,h3').evaluateAll(els=>els.forEach(e=>{e.id=e.textContent.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu,'').replace(/ /g,'-')}));
   const links=await page.locator('a[href^="#"]').evaluateAll(els=>els.map(e=>({href:e.getAttribute('href'),exists:!!document.getElementById(e.getAttribute('href').slice(1))||!!document.getElementById('user-content-'+e.getAttribute('href').slice(1))})));
   assert.ok(links.every(x=>x.exists),JSON.stringify(links));
   await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
   console.log(JSON.stringify({name,images:await page.locator('img').count(),anchors:links.length}));
  }
  await page.goto('http://review.local/video');
  await page.locator('video').evaluate(v=>v.play());
  for(let i=0;i<3;i++){
   await page.waitForTimeout(11000);
   await page.screenshot({path:path.join(out,'playback-'+i+'.png')});
   console.log(await page.locator('video').evaluate(v=>({time:v.currentTime,duration:v.duration,paused:v.paused,error:v.error})));
  }
  await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:10000});
  const result=await page.locator('video').evaluate(v=>({ended:v.ended,duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error}));
  assert.equal(result.ended,true);assert.equal(result.error,null);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({result,errors},null,2));console.log(result);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
