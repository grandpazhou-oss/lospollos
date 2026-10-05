#!/usr/bin/env node
'use strict';
// Business controls for native saved-study readback; no internal-state injection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=process.env.STCT_MAP_ROOT||path.resolve(__dirname,'..'),out=process.env.STCT_MAP_EVIDENCE||path.join(require('node:os').tmpdir(),'stct-v87-map');
const packages=process.env.STCT_MAP_PACKAGES;
assert.ok(packages,'STCT_MAP_PACKAGES is required');fs.mkdirSync(out,{recursive:true});
const baseline=process.env.STCT_MAP_BASELINE==='1';
const log={status:'RUNNING',method:'Home -> existing native study upload control -> comparison controls; read-only DOM and runtime assertions',basemap:'External basemap requests blocked; real MapLibre renders neutral geographic canvas, not real OSRM or road tiles',checks:[],pageErrors:[]};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(error,body)=>error?res.writeHead(404).end():res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'}).end(body));});
(async()=>{let browser;try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:process.env.STCT_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['blob:','data:'].includes(u.protocol)?route.continue():route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',e=>log.pageErrors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/index.html?forceHeuristic=1#/`);
 await page.locator('#loginForm .login-btn').click();await page.locator('.platform-home').waitFor();
 await page.locator('.platform-home-action[data-platform-route="/design/supply-chain-study"]').click();
 async function openPackage(file){
  await page.locator('[data-supply-action="step"][data-supply-id="0"]').click();
  const input=page.locator('[data-supply-file="study"]');const details=input.locator('xpath=ancestor::details[1]');if(await details.count()&&!await details.evaluate(e=>e.open))await details.locator('summary').click();
  await input.setInputFiles((path.isAbsolute(file)?file:path.join(packages,file)));await page.locator('[data-supply-map-panel]').waitFor();
  await page.waitForFunction(()=>window.STCTPlatformV19.mapRuntime.diagnostics().layers.some(id=>id.endsWith('-relations-candidate')));
 }
 const compare=name=>page.locator(`[data-supply-compare="${name}"]`),panel=()=>page.locator('[data-supply-map-panel]');
 const diagnostics=()=>page.evaluate(()=>window.STCTPlatformV19.mapRuntime.diagnostics());
 for(const [scope,file] of [['FULL_CHAIN','uc-full.package.json'],['OUTBOUND_ONLY','uc-outbound.package.json'],['UPSTREAM_ONLY','uc-upstream.package.json']]){
  const packed=JSON.parse(fs.readFileSync(path.join(packages,file),'utf8'));await openPackage(file);
  const before=await page.evaluate(()=>JSON.stringify(window.STCTPlatformV19.instance.designAdapter.supplySnapshot().snapshot));
  const oldSlots=await page.locator('[data-supply-map-slot]').count();
  if(baseline){assert.equal(oldSlots,1);const ids=await page.locator('.sc-compare tbody tr[data-scenario-id]').evaluateAll(es=>es.map(e=>e.dataset.scenarioId));const picked=ids.find(id=>id!==packed.snapshot.decision.focusScenarioId)||ids[0];await page.locator(`[data-supply-action="show-on-map"][data-supply-id="${picked}"]`).click();await page.waitForTimeout(150);log.checks.push({scope,duplicateMapSlots:oldSlots+1,picked,comparisonSelected:await panel().getAttribute('data-map-selected-scenario'),runtimeFocus:(await diagnostics()).provenance.focusScenarioId});await page.screenshot({path:path.join(out,'baseline-'+scope+'.png'),fullPage:false});break;}
  assert.equal(oldSlots,0);assert.equal(await page.locator('.p7-map-workspace:visible').count(),1);
  const d=await diagnostics();assert.equal(d.owner,'SUPPLY');assert.equal(d.mapInstances,1);assert.ok(d.layers.includes('p7-supply-relations-candidate'));assert.equal(d.provenance.analysisScope,scope);
  const ids=await compare('scenarioId').locator('option').evaluateAll(es=>es.map(e=>e.value));const picked=ids.find(id=>id!==packed.snapshot.decision.focusScenarioId)||ids[0];
  await page.locator(`[data-supply-action="show-on-map"][data-supply-id="${picked}"]`).click();
  assert.equal(await compare('scenarioId').inputValue(),picked);assert.equal(await panel().getAttribute('data-map-selected-scenario'),picked);assert.equal((await diagnostics()).provenance.selectedScenarioId,picked);
  assert.equal(await page.locator('.sc-business-brief').getAttribute('data-decision-focus'),packed.snapshot.decision.focusScenarioId);
  const inspected=await page.locator('[data-inspected-scenario]').evaluateAll(es=>es.map(e=>e.dataset.inspectedScenario));assert.ok(inspected.length>0);assert.ok(inspected.every(id=>id===picked));
  for(const mode of ['REFERENCE','CANDIDATE','BOTH']){await compare('mode').focus();await compare('mode').selectOption(mode);assert.equal(await page.evaluate(()=>document.activeElement.dataset.supplyCompare),'mode');const model=await page.evaluate(()=>window.STCTPlatformV19.mapRuntime.snapshot());assert.ok(model.features.filter(f=>f.geometry.type==='LineString').every(f=>mode==='BOTH'||f.properties.comparison===mode.toLowerCase()));}
  await compare('change').selectOption('CHANGED');let model=await page.evaluate(()=>window.STCTPlatformV19.mapRuntime.snapshot());assert.ok(model.relations.every(row=>row.change!=='UNCHANGED'));
  await compare('change').selectOption('ALL');
  await compare('period').selectOption(packed.study.periods[0]);assert.equal((await diagnostics()).provenance.period,packed.study.periods[0]);assert.match(await panel().innerText(),/全期快照值/);
  const node=packed.study.nodes.find(n=>['DC','WAREHOUSE'].includes(n.role));await compare('nodeId').selectOption(node.nodeId);model=await page.evaluate(()=>window.STCTPlatformV19.mapRuntime.snapshot());assert.ok(model.relations.every(row=>[row.fromNodeId,row.toNodeId].includes(node.nodeId)));
  assert.equal(await panel().locator('.sc-map-relations tbody tr[data-map-relation]').count(),model.relations.length);
  const locate=panel().locator('[data-supply-action="map-locate"]').first();if(await locate.count()){const id=await locate.getAttribute('data-supply-id');await locate.click();assert.equal((await diagnostics()).viewStates.SUPPLY.selectedEntityId,id);}
  await compare('nodeId').selectOption('');await compare('period').selectOption('ALL');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.STCTPlatformV19.instance.designAdapter.supplySnapshot().snapshot)),before);
  const idsDOM=await page.locator('.sc-compare tbody tr[data-scenario-id]').evaluateAll(es=>es.map(e=>e.dataset.scenarioId));const ranked=packed.snapshot.decision.rankedScenarioIds;assert.deepEqual(idsDOM,[...ranked,...packed.snapshot.rows.map(row=>row.scenarioId).filter(id=>!ranked.includes(id))]);
  await panel().locator('[data-p7-fit]').click();await panel().locator('.p7-map-viewport').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,scope+'-desktop.png')});
  await page.locator('[data-p7-search]').fill('certainly-no-match');assert.match(await panel().innerText(),/没有找到/);
  log.checks.push({scope,mode:d.mode,mapLayers:d.layers,candidate:picked,hashUnchanged:true,DOMOrder:idsDOM,filterAndLocate:'PASS'});
 }
 if(!baseline){
  if(process.env.STCT_NON_UC_PACKAGE){
    await openPackage(process.env.STCT_NON_UC_PACKAGE);
    assert.equal(await page.locator('[data-p7-search]').inputValue(),'');
    const nonUC=JSON.parse(fs.readFileSync(process.env.STCT_NON_UC_PACKAGE,'utf8'));
    assert.equal((await diagnostics()).provenance.studyId,nonUC.study.studyId);
    assert.equal(await compare('period').inputValue(),'ALL');assert.equal(await compare('nodeId').inputValue(),'');
    log.checks.push({name:'UC -> non-UC saved study resets transient map filters and identity',status:'PASS'});
    await openPackage('uc-upstream.package.json');
  }
  if(await page.locator('[data-p7-search-clear]').isVisible())await page.locator('[data-p7-search-clear]').click();
  for(const locale of ['en','ja','zh']){await page.locator('.platform-locale-control select').selectOption(locale);await compare('mode').selectOption('BOTH');assert.equal(await page.locator('[data-p7-kind="customer"] span').textContent(),{zh:'送货地',en:'Delivery locations',ja:'配送先'}[locale]);assert.equal((await diagnostics()).provenance.analysisScope,'UPSTREAM_ONLY');await page.screenshot({path:path.join(out,locale+'-desktop.png')});}
  await page.setViewportSize({width:390,height:844});await panel().scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'mobile-390.png'),fullPage:false});
  await page.emulateMedia({media:'print'});await page.waitForFunction(()=>window.STCTPlatformV19.mapRuntime.diagnostics().mode==='SCHEMATIC');assert.ok(await panel().locator('.p7-map-schematic polyline').count()>0);await page.screenshot({path:path.join(out,'map-print.png')});await page.pdf({path:path.join(out,'map-print.pdf'),format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
  await page.locator('[data-p7-basemap-retry]').click();await page.waitForFunction(()=>window.STCTPlatformV19.mapRuntime.diagnostics().layers.includes('p7-supply-relations-reference'));
  log.checks.push({name:'3 locales,390px,print,reduced-motion,style reload',status:'PASS'});
 }
 assert.deepEqual(log.pageErrors,[]);log.status=baseline?'REPRODUCED':'PASS';
 }catch(e){log.status='FAIL';log.error=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(log,null,2));console.log(JSON.stringify(log));}})();
