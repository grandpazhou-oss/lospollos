'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),baseline=process.env.STCT_BASELINE_ROOT,out=process.env.STCT_RELIABILITY_EVIDENCE,fixture=process.env.STCT_SUPPLY_PACKAGE;
if(!out||!fixture||!baseline)throw Error('STCT_RELIABILITY_EVIDENCE, STCT_SUPPLY_PACKAGE and STCT_BASELINE_ROOT are required');
fs.mkdirSync(out,{recursive:true});
const log={status:'RUNNING',method:'Home and catalog file controls; only timer instrumentation and Worker transport fault injection, no study state injection',samples:[],checks:[],pageErrors:[]};
const write=()=>fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(log,null,2));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
async function serve(directory){const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),file=path.resolve(directory,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(directory+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,data)=>err?res.writeHead(404).end():res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(data));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{server,url:`http://127.0.0.1:${server.address().port}/index.html?noWebGL=1&optPort=9888#/`};}
async function login(page,url){await page.goto(url);await page.locator('#loginForm .login-btn').click();await page.locator('.platform-home').waitFor();}
async function catalog(page){await page.locator('button[data-platform-route="/platform/scenarios"]:visible').first().click();await page.locator('[data-p5-package]').waitFor();}
async function identity(page){return{study:await page.locator('[data-v8-current-study]').getAttribute('data-study-id'),kind:await page.locator('[data-v8-current-study]').getAttribute('data-study-kind'),entries:await page.locator('[data-p5-entry]').count()};}
(async()=>{let browser;const servers=[];try{
 browser=await chromium.launch({executablePath:process.env.STCT_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const [label,directory] of [['before',baseline],['after',root]]){
  const server=await serve(directory);servers.push(server.server);
  for(let sample=0;sample<3;sample++){
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
   await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
   await context.addInitScript(()=>{window.__timing={gaps:[],workers:0};let last=performance.now();setInterval(()=>{const now=performance.now();window.__timing.gaps.push(now-last);last=now;},20);const Real=window.Worker;window.Worker=class extends Real{constructor(...args){super(...args);window.__timing.workers++;}};});
   const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(90000);page.on('pageerror',e=>log.pageErrors.push({label,error:e.message}));
   await login(page,server.url);await catalog(page);
   await page.evaluate(()=>window.__timing.gaps=[]);
   const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
   const metrics=()=>cdp.send('Performance.getMetrics').then(v=>Object.fromEntries(v.metrics.map(m=>[m.name,m.value])));
   const before=await metrics(),started=Date.now();
   await page.locator('[data-p5-package]').setInputFiles(fixture);
   await page.locator('[data-p5-action="import-package"]').waitFor();
   const wallMs=Date.now()-started,after=await metrics(),timer=await page.evaluate(()=>window.__timing);
   assert.equal((await identity(page)).entries,0,'preview must not persist anything');
   log.samples.push({label,sample,previewWallMs:wallMs,maxTimerGapMs:Math.max(...timer.gaps),timerTicks:timer.gaps.length,workers:timer.workers,mainThreadTaskMs:1000*(after.TaskDuration-before.TaskDuration),mainThreadScriptMs:1000*(after.ScriptDuration-before.ScriptDuration),cpuNote:'CDP metrics cover the main thread, not total CPU of Workers or native solver'});write();
   if(label==='after'&&sample===2){
    await page.locator('[data-p5-action="import-package"]').click();await page.locator('[data-design-route="/design/supply-chain-study"]').waitFor();await catalog(page);const saved=await identity(page);assert.equal(saved.entries,1);assert.equal(saved.kind,'SUPPLY_CHAIN_PERIOD');
    await page.locator('[data-p5-package]').setInputFiles(fixture);await page.locator('[data-p5-action="cancel-work"]').click();await page.locator('[data-p5-message]').getByText(/已取消/).waitFor();assert.deepEqual(await identity(page),saved);assert.equal(await page.locator('[data-p5-action="import-package"]').count(),0);log.checks.push('REAL_PREVIEW_CANCEL_PRESERVES_STUDY_AND_DIRECTORY');
    // Fault injection is limited to the Worker response transport; no internal study object is changed.
    await page.evaluate(()=>{const Real=window.Worker;window.Worker=class extends Real{postMessage(value,...rest){window.__lastWorker=this;window.__workerRequest=value.requestId;return super.postMessage(value,...rest);}terminate(){window.__lateWorkerHandler=this.onmessage;return super.terminate();}};});
    await page.locator('[data-p5-package]').setInputFiles(fixture);await page.locator('[data-p5-action="cancel-work"]').waitFor();await page.locator('button[data-platform-route="/platform/data"]:visible').first().click();await page.locator('[data-p5-upload]').waitFor();
    await page.evaluate(()=>window.__lateWorkerHandler?.({data:{type:'RESULT',requestId:window.__workerRequest,result:{status:'READY',payload:{schemaVersion:'FORGED_LATE_REPLY'}}}}));
    await catalog(page);assert.deepEqual(await identity(page),saved);assert.equal(await page.locator('[data-p5-action="import-package"]').count(),0);log.checks.push('NAVIGATION_TERMINATES_PREVIEW_AND_DROPS_LATE_WORKER_REPLY');
    const damaged=JSON.parse(fs.readFileSync(fixture,'utf8'));damaged.study.name+=' damaged';await page.locator('[data-p5-package]').setInputFiles({name:'damaged.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(damaged))});await page.locator('[data-p5-message]').getByText('SUPPLY_PACKAGE_INVALID',{exact:true}).waitFor();assert.deepEqual(await identity(page),saved);assert.equal(await page.locator('[data-p5-action="import-package"]').count(),0);log.checks.push('DAMAGED_PACKAGE_REJECTED_WITHOUT_ADOPTION');
    for(const locale of ['zh','en','ja']){await page.locator('[data-platform-locale]').selectOption(locale);await page.locator('[data-p5-package]').setInputFiles(fixture);await page.locator('[data-p5-action="cancel-work"]').click();await page.locator('[data-p5-message]').getByText(locale==='zh'?/已取消/:locale==='en'?/cancelled/:/取り消しました/).waitFor();assert.deepEqual(await identity(page),saved);}
    log.checks.push('ZH_EN_JA_CANCEL_COPY');
    await page.locator('[data-platform-locale]').selectOption('zh');
    await page.evaluate(()=>{window.__savedWorker=window.Worker;window.Worker=undefined;});
    await page.locator('[data-p5-package]').setInputFiles(fixture);await page.locator('[data-p5-message]').getByText(/当前入口不能启动独立核验/).waitFor();assert.deepEqual(await identity(page),saved);
    await page.evaluate(()=>{window.Worker=window.__savedWorker;});
    await context.route('**/platform-study-worker-v19.js',route=>route.abort());
    await page.locator('[data-p5-package]').setInputFiles(fixture);await page.locator('[data-p5-message]').getByText(/研究包核验未完成/).waitFor();assert.deepEqual(await identity(page),saved);
    await context.unroute('**/platform-study-worker-v19.js');log.checks.push('WORKER_UNAVAILABLE_OR_NETWORK_FAILURE_RETAINS_STUDY');
    await page.locator('button[data-platform-route="/design/supply-chain-study"]:visible').first().click();await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();await page.locator('[data-supply-field="geoConfirmed"]').uncheck();
    await page.locator('[data-supply-action="analyze"]').click();await page.getByText(/请先完成下面的条件检查/).waitFor();assert.ok(await page.locator('[data-supply-preflight] li').count()>0);await page.locator('[data-supply-action="condition-focus"]').first().click();log.checks.push('BUSINESS_PREFLIGHT_EXPLAINS_INVALID_CONDITIONS');
    await page.locator('.platform-v19-sidebar .platform-display-home').click();await page.locator('[data-platform-build]').waitFor();assert.match(await page.locator('[data-platform-build]').getAttribute('data-platform-build'),/reliability/);await page.locator('[data-platform-build] summary').click();assert.match(await page.locator('[data-platform-build]').innerText(),/index.html/);assert.match(await page.locator('[data-platform-build]').innerText(),/9888/);
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'home-390.png'),fullPage:true});log.checks.push('CURRENT_ENTRY_IDENTITY_AND_390PX');
    await page.goto(server.url.replace(/index\.html.*$/,'dispatch.html?optPort=9888'));assert.match(await page.locator('[role="note"]').innerText(),/旧版配送路线工具/);assert.match(await page.locator('#currentPlatformEntry').getAttribute('href'),/^index\.html\?optPort=9888#\/$/);await page.locator('#currentPlatformEntry').click();await page.locator('#loginForm .login-btn').waitFor();log.checks.push('LEGACY_TOOL_LINK_PRESERVES_ENDPOINT');
   }
   await context.close();
  }
 }
 assert.deepEqual(log.pageErrors,[]);log.status='PASS';
}catch(e){log.status='FAIL';log.error=e.stack;process.exitCode=1;}finally{write();await browser?.close();for(const server of servers)await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(log));}})();
