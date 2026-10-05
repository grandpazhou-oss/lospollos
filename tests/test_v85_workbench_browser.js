#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results/v85-ui-osrm');
const evidence={status:'RUNNING',checks:[],pageErrors:[],method:'Visible controls; isolated origin/context. Read-only DOM and authority assertions. Synthetic existing demo.'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(err,b)=>err?res.writeHead(404).end():res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)]||'application/octet-stream'}).end(b));});
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.STCT_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
 await context.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});
 const p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>evidence.pageErrors.push(e.message));p.on('dialog',d=>d.accept());
 const base=`http://127.0.0.1:${server.address().port}/index.html?forceHeuristic=1&noWebGL=1`;
 await p.goto(base+'#/');await p.locator('#loginForm .login-btn').click();await p.locator('.platform-home').waitFor();
 await p.screenshot({path:path.join(out,'after-home.png')});
 await p.locator('.platform-home-card-command').click();
 async function route(r){await p.locator(`.platform-v19-business-nav [data-platform-route="/command/${r}"]`).click();await p.locator(`[data-command-route="/command/${r}"]`).waitFor();}
 const views={};
 for(const r of ['overview','dispatch','mission-control','execution','plan-vs-actual','driver-simulator','alerts','recovery','shift-review','analysis','cost','carbon','report']){
  await route(r);views[r]=await p.locator('.command-page h1').textContent();
  if(!['overview','mission-control'].includes(r))assert.equal(await p.locator('.command-page > [data-p7-map-slot]').count(),0,r+' must not start with a generic map');
  if(['analysis','cost','carbon','report'].includes(r))assert.ok(await p.locator('.command-empty-workbench').isVisible(), r + ' ' + JSON.stringify(await p.evaluate(()=>({routes:window.STCTCore.getData()?.routes?.length,source:window.STCTPlatformV19.instance.commandAdapter.createOperationalContext().snapshot().scenario.sourceType,html:document.querySelector('[data-native-tool-slot]')?.innerHTML?.slice(0,180)}))));
  if(['overview','dispatch','alerts','analysis'].includes(r))await p.screenshot({path:path.join(out,`after-${r}.png`)});
 }
 assert.equal(new Set(Object.values(views)).size,13);evidence.checks.push({name:'13 differentiated routes and 4 honest empty states',views});
 // Restore original upload tools using an explicitly synthetic original data file.
 await route('dispatch');await p.locator('.command-native-tools > summary').click();
 await p.locator('#uploadFile').setInputFiles({name:'synthetic-raw.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({__rawUpload:true,raw:JSON.parse(fs.readFileSync(path.join(root,'assets/demo/stct-synthetic-demo.json'),'utf8'))}))});
 await p.locator('#applyBatchBtn').click();

 await p.locator('#generateScenarioBtn:visible').waitFor();
 assert.equal(await p.locator('#optimizerView').count(),1);assert.ok((await p.locator('#scenarioAverageSpeed').inputValue()).length);
 await p.locator('#scenarioAverageSpeed').fill('32');await p.locator('#scenarioAverageSpeed').press('Tab');
 await route('alerts');await route('dispatch');assert.equal(await p.locator('#optimizerView').count(),1);
 await p.locator('#generateScenarioBtn').click();
 await p.locator('#applyScenarioBtn:not([disabled])').waitFor({timeout:120000});
 await p.locator('#applyScenarioBtn').click();
 await p.waitForFunction(()=>window.STCTPlatformV19.instance.commandAdapter.createOperationalContext().snapshot().scenario.sourceType==='UPLOADED_APPLIED');
 await route('analysis');assert.ok(await p.locator('#analysisContent .big-num').count());
 evidence.checks.push({name:'Original dispatch import, settings, actual heuristic solve, verified apply, analysis and remount',status:'PASS',solve:'Explicit Demo Heuristic, not OR-Tools'});
 // Existing explicit Design demo -> Data Hub -> verified COMMAND draft, through controls.
 await p.locator('.platform-v19-sidebar .platform-workspace-option[data-platform-workspace="DESIGN"]').click();
 await p.locator('[data-design-route="/design/overview"]').waitFor();
 if(await p.locator('[data-design-action="p7-demo"]').count())await p.locator('[data-design-action="p7-demo"]').click();
 await p.locator('.platform-v19-sidebar [data-platform-route="/platform/scenarios"]').click();
 await p.locator('[data-p5-field="scenarioName"]').fill('V85 Synthetic operations');
 await p.locator('[data-p5-action="save-study"]').click();
 await p.locator('[data-p5-entry]').filter({hasText:'V85 Synthetic operations'}).waitFor();
 await p.locator('.platform-v19-sidebar [data-platform-route="/platform/data"]').click();
 await p.locator('[data-p5-action="command-draft"]').first().click();
 await p.locator('[data-command-action="data-draft-generate"]').click();
 await p.locator('[data-command-action="data-draft-apply"]:not([disabled])').waitFor();
 const backup=p.waitForEvent('download');await p.locator('[data-command-action="data-draft-apply"]').click();await backup;
 await p.waitForFunction(()=>window.STCTPlatformV19.instance.commandAdapter.diagnostics().lastDomainAction?.type==='data-draft-apply');
 const appliedResult=await p.evaluate(()=>window.STCTPlatformV19.instance.commandAdapter.diagnostics().lastDomainAction);assert.equal(appliedResult.result.status,'ADOPTED',JSON.stringify(appliedResult));

 await route('analysis');await p.locator('.command-applied-analysis').waitFor();
 const hash=await p.locator('[data-plan-hash]').getAttribute('data-plan-hash');
 assert.ok((await p.locator('.command-table tbody tr').count())>0);
 for(const r of ['cost','carbon','report']){await route(r);assert.equal(await p.locator('[data-plan-hash]').getAttribute('data-plan-hash'),hash);assert.ok((await p.locator('.command-table tbody tr').count())>0);}
 const download=p.waitForEvent('download');await p.locator('[data-native-export]').click();const downloaded=await download;await downloaded.saveAs(path.join(out,'synthetic-transport-evidence.json'));
 const payload=JSON.parse(fs.readFileSync(path.join(out,'synthetic-transport-evidence.json'),'utf8'));assert.equal(payload.planHash,hash);
 const visibleMetrics=await p.locator('.command-business-metrics strong').allTextContents();assert.equal(Number(visibleMetrics[2].replace(/,/g,'')),payload.plan.networkEvaluation.plan.trip.metrics.routeDistanceKm);assert.equal(Number(visibleMetrics[3].replace(/,/g,'')),payload.plan.networkEvaluation.accounting.cost.total);
 evidence.checks.push({name:'Real existing network solve, independent verifier, applied plan and four views/export identity',status:'PASS',planHash:hash,verification:payload.plan.verification.status});
 await p.locator('.command-page h1').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'after-report.png')});
 for(const lang of ['en','ja','zh']){
  await p.locator('.platform-v19-sidebar .platform-locale-control select').selectOption(lang);await route('analysis');
  evidence.checks.push({name:'locale '+lang,heading:await p.locator('.command-page h1').textContent()});
 }
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(out,'after-mobile.png')});
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const tableScroll=await p.locator('.command-table-wrap').first().evaluate(el=>{el.scrollLeft=el.scrollWidth;return {left:el.scrollLeft,width:el.clientWidth,total:el.scrollWidth};});assert.ok(tableScroll.left>0,'Mobile table must scroll to remaining columns');
 await p.locator('.command-table-wrap').first().evaluate(el=>el.scrollLeft=0);
 await p.emulateMedia({media:'print'});await p.pdf({path:path.join(out,'transport-print.pdf'),format:'A4'});await p.emulateMedia({media:'screen'});
 evidence.checks.push({name:'390px no document overflow; print PDF; reduced motion and No-WebGL',status:'PASS'});
 // Historical URLs resolve to corresponding restored functionality.
 for(const [legacy,r] of [['analysisView','analysis'],['costView','cost'],['carbonView','carbon'],['reportView','report']]){
  await p.goto(base+'#'+legacy);await p.locator(`[data-command-route="/command/${r}"]`).waitFor();assert.equal(await p.locator('.command-page h1').count(),1);
 }
 evidence.checks.push({name:'4 original deep links',status:'PASS'});
 assert.deepEqual(evidence.pageErrors,[]);evidence.status='PASS';
 }catch(e){evidence.status='FAIL';evidence.error=e.stack;console.error(e.stack);process.exitCode=1;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'browser-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
})();
