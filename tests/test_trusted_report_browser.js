'use strict';
// Real macOS Chromium / native backend / native IndexedDB. All business changes use controls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const X=require('../vendor/xlsx/xlsx.full.min.js');
const fixtures=require('./test_trusted_report_workspace.js');
const evidence=path.resolve(process.argv[2]),base=process.argv[3];
if(!evidence||!base)throw new Error('Usage: NODE_PATH=<installed-playwright> node tests/test_trusted_report_browser.js <evidence> <isolated-url>');
fs.mkdirSync(evidence,{recursive:true});
const periods=['2026-01','2026-02'];
const sheets=[['Locations',[['name','code','role','coordinate'],['Synthetic Origin A','S-A','FACTORY','120,30'],['Synthetic Origin B','S-B','FACTORY','121,30'],['Synthetic Hub East','W-E','DC','120.1,30'],['Synthetic Hub West','W-W','DC','121.1,30']]],
['Demand',[['customerNumber','customer','assignedDepot','coordinate',...periods],['D-A','Synthetic Shop Alpha','W-W','120.2,30',10.25,12.5],['D-B','Synthetic Shop Beta','W-E','121.2,30',10.25,12.5]]],
['Inbound',[['flowId','fromNodeId','toNodeId',...periods],['F-A','S-B','W-E',10.25,12.5],['F-B','S-A','W-W',10.25,12.5]]]];
const wb=X.utils.book_new();for(const[n,rows]of sheets)X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),n);
const input=Buffer.from(X.write(wb,{type:'buffer',bookType:'xlsx'}));fs.writeFileSync(path.join(evidence,'synthetic-input.xlsx'),input);
const results={platform:'macOS Chromium + local OR-Tools, not Windows/human acceptance',requests:[],checks:[],errors:[]};
let page,browser;
const action=n=>page.locator(`[data-supply-action="${n}"]`),field=n=>page.locator(`[data-supply-field="${n}"]`);
const state=()=>page.evaluate(()=>window.STCTPlatformV19?.instance?.designAdapter?.supplySnapshot());
async function wait(predicate,timeout=120000){const start=Date.now();while(Date.now()-start<timeout){const s=await state();if(s&&predicate(s))return s;await page.waitForTimeout(100);}throw new Error('Wait expired '+JSON.stringify({state:await state(),messages:await page.locator('.sc-message,[data-supply-preflight]').allTextContents()}));}
async function reveal(loc){if(!await loc.isVisible()){const details=loc.locator('xpath=ancestor::details[1]');if(await details.count()&&!await details.evaluate(e=>e.open))await details.locator('summary').first().click();}await loc.waitFor({state:'visible'});}
async function step(i){await page.locator(`[data-supply-action="step"][data-supply-id="${i}"]`).click();}
function pass(name,details={}){results.checks.push({name,status:'PASS',...details});console.log('PASS '+name);fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify(results,null,2));}
async function configure(scope){
  await step(1);await field('analysisScope').selectOption(scope);await field('geoConfirmed').check();await field('objective').selectOption('DISTANCE');
  if(scope!=='UPSTREAM_ONLY'){
    await field('networkMode').selectOption('MULTI');
    for(const row of await page.locator('.sc-sites tbody tr:has(input[data-supply-site])').all())await row.locator('input[value="adjust"]').check();
    await field('minSites').fill('1');await field('maxSites').fill('2');
  }
  if(scope!=='OUTBOUND_ONLY'){
    await field('homogeneousDemandConfirmed').check();await field('allowAllSupplierSiteEdgesConfirmed').check();await field('sourceMode').selectOption('FREE');
    await field('supplierTotalMode').selectOption(scope==='UPSTREAM_ONLY'?'FIXED_OBSERVED':'ADJUSTABLE');
  }
  const cap=page.locator('[data-supply-capacity]');await reveal(cap.first());for(const c of await cap.all()){await c.fill('100');await c.press('Tab');}
  if(scope==='FULL_CHAIN'){
    await field('capacityPolicy').selectOption('PROVIDED');for(const c of await page.locator('[data-supply-supplier-capacity]').all())await c.fill('100');
    await reveal(page.locator('[data-supply-rate="INBOUND_TRANSPORT"][data-rate-key="amount"]'));
    for(const kind of ['INBOUND_TRANSPORT','OUTBOUND_TRANSPORT']){await page.locator(`[data-supply-rate="${kind}"][data-rate-key="amount"]`).fill('1');await page.locator(`[data-supply-rate="${kind}"][data-rate-key="status"]`).selectOption('KNOWN');}
    for(const kind of ['FIXED_OPERATING','HANDLING'])await page.locator(`[data-supply-rate="${kind}"][data-rate-key="status"]`).selectOption('CONFIRMED_ZERO');
    for(const kind of ['inventoryHolding','transferTransport'])await page.locator(`[data-supply-scope="${kind}"]`).check();
    await field('objective').selectOption('COST');await field('costMode').selectOption('ACTUAL');await field('conversionCost').fill('0');
  }
}
async function report(scope,s){
  const before=results.requests.length,hash=s.snapshot.snapshotHash,body=JSON.stringify(s.snapshot);
  const detailKey=scope==='UPSTREAM_ONLY'?'inbound':'outbound';
  await action('report-open').click();const root=page.locator('.trusted-report');await root.waitFor();
  const projection=await page.evaluate(()=>window.STCTPlatformV19.trustedReport.project(window.STCTPlatformV19.instance.designAdapter.supplySnapshot()));
  assert.deepEqual(await root.locator('tr[data-report-candidate]:not([data-report-group="REFERENCE"])').evaluateAll(es=>es.map(e=>e.dataset.reportCandidate)),projection.candidates.map(c=>c.id));
  assert.ok((await root.innerText()).includes(projection.conclusion));assert.ok((await root.innerText()).includes(s.study.name));
  for(const c of projection.candidates){
    for(const key of ['outbound','inbound','volumeKm','cost','capacity','sources']){
      const button=root.locator(`tr [data-report-scenario="${c.id}"][data-report-evidence="${key}"]`);await button.focus();await page.keyboard.press('Enter');
      assert.equal(await root.locator('[data-report-select]').inputValue(),c.id);assert.ok((await root.locator('[data-report-detail-note]').innerText()).includes(hash));
      if(key==='sources')assert.ok((await root.locator('[data-report-detail-table]').innerText()).includes('ANALYSIS_CONDITIONS'));
    }
  }
  if(scope==='UPSTREAM_ONLY'){await root.locator('tr [data-report-scenario="OBSERVED_KNOWN_INBOUND"][data-report-evidence="inbound"]').click();assert.equal(await root.locator('[data-report-detail-table] tbody tr').count(),s.snapshot.baseline.inbound.length);}
  await page.screenshot({path:path.join(evidence,scope+'-summary-comparison.png'),fullPage:true});
  assert.equal(results.requests.length,before);assert.equal(JSON.stringify((await state()).snapshot),body);
  const candidate=projection.candidates[0];await root.locator(`tr [data-report-scenario="${candidate.id}"][data-report-evidence="${detailKey}"]`).click();
  await root.locator('[data-report-workbook]').click();
  await page.waitForFunction(()=>{const text=document.querySelector('[data-report-sdk-status]')?.textContent||'';return text.includes('实际只读')||text.includes('不可用');});
  assert.match(await root.locator('[data-report-sdk-status]').innerText(),/实际只读/);
  const initial=await page.evaluate(()=>window.STCTUniverEvidence.read().sheets.evidence.cellData);
  const host=root.locator('[data-report-univer]');
  await page.waitForFunction(()=>[...document.querySelector('[data-report-univer] > div').shadowRoot.querySelectorAll('canvas')].some(c=>c.width>500&&c.height>200));
  const canvas=host.locator('canvas').last();await canvas.click({position:{x:100,y:65}});
  await page.keyboard.press(process.platform==='darwin'?'Meta+C':'Control+C');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(copied.includes(candidate.id),'Selection and copy must work in the read-only workbook');
  await canvas.dblclick({position:{x:100,y:65}});await page.keyboard.type('MODIFIED');await page.keyboard.press('Delete');await page.keyboard.press('Control+d');await page.keyboard.press('Control+-');
  await page.evaluate(()=>navigator.clipboard.writeText('PASTE_ATTEMPT'));await page.keyboard.press(process.platform==='darwin'?'Meta+V':'Control+V');await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>window.STCTUniverEvidence.read().sheets.evidence.cellData),initial);
  assert.equal(JSON.stringify((await state()).snapshot),body);
  await page.screenshot({path:path.join(evidence,scope+'-univer-readonly.png'),fullPage:true});
  await root.locator('[data-report-workbook-close]').click();assert.equal(await page.evaluate(()=>window.STCTUniverEvidence.read()),null);
  for(const type of ['csv','html','json','md']){const download=page.waitForEvent('download');await root.locator(`[data-report-export="${type}"]`).click();const d=await download;await d.saveAs(path.join(evidence,scope+'.'+type));}
  await page.setViewportSize({width:390,height:844});assert.ok(await root.locator('[data-report-focus]').isVisible());
  assert.equal(await page.evaluate(()=>document.querySelector('.tr-body').scrollWidth<=document.documentElement.clientWidth),true);
  await page.screenshot({path:path.join(evidence,scope+'-390px.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await root.locator('[data-report-close]').click();assert.equal(results.requests.length,before);pass(scope+':report-readonly-export',{snapshotHash:hash,candidates:projection.candidates.map(c=>c.id),copyWorks:true});
  for(let i=0;i<3;i++){await action('report-open').click();assert.equal(await page.locator('.trusted-report').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.trusted-report').count(),0);assert.equal(await page.evaluate(()=>window.STCTUniverEvidence.read()),null);}
  assert.equal(results.requests.length,before);pass(scope+':bounded-report-lifecycle');
}
(async()=>{
 try{
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});context.on('page',tab=>tab.on('pageerror',e=>results.errors.push({url:tab.url(),message:e.message})));page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('request',r=>{if(r.method()==='POST'&&/\/supply-chain.*jobs/.test(r.url()))results.requests.push({url:r.url(),time:Date.now()});});
  await page.goto(base);if(await page.locator('#loginForm .login-btn').isVisible())await page.locator('#loginForm .login-btn').click();await page.locator('.platform-home').waitFor();
  await page.locator('button[data-platform-route="/platform/data"]:visible').first().click();await page.locator('[data-v8-kind]').selectOption('SUPPLY_CHAIN_PERIOD');
  await page.locator('[data-p5-upload]').setInputFiles({name:'synthetic-input.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:input});
  await action('profile-confirm').waitFor();
  for(const index of [1,2]){await page.locator(`[data-supply-action="mapping-select"][data-supply-id="${index}"]`).click();await field('blockUnit').selectOption('m3');if(index===1){await page.locator('[data-supply-map-field="demandId"]').selectOption('1');await page.locator('[data-supply-map-field="currentSiteId"]').selectOption('3');}}
  await field('studyName').fill('Synthetic trusted report three-scope');await field('classification').selectOption('SYNTHETIC');await action('profile-confirm').click();
  await wait(s=>s.study&&s.savedPointer?.status==='DRAFT');assert.equal((await state()).snapshot,null);pass('public-import-draft-no-result');
  for(const scope of ['OUTBOUND_ONLY','UPSTREAM_ONLY','FULL_CHAIN']){
    await configure(scope);const before=results.requests.length;await action('analyze').click();const s=await wait(s=>s.snapshot?.rows?.length&&(s.snapshot.analysisScope||'OUTBOUND_ONLY')===scope);
    await action('export-html').waitFor();assert.ok(results.requests.length>before,'No native solve request observed');assert.ok(s.snapshot.solverRuns.every(r=>r.engine.id==='OR_TOOLS_CP_SAT'));pass(scope+':native-solve',{snapshotHash:s.snapshot.snapshotHash});
    await report(scope,s);
    const revision=(await state()).savedPointer.revision;await action('draft-save').click();const saved=await wait(s=>s.savedPointer.status==='COMPLETE'&&s.savedPointer.revision>revision);
    await page.reload();if(await page.locator('#loginForm .login-btn').isVisible())await page.locator('#loginForm .login-btn').click();await page.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
    await step(0);await action('study-list').click();await page.locator(`[data-supply-action="study-open"][data-supply-id="${saved.savedPointer.id}"]`).click();
    const read=await wait(s=>s.snapshot?.snapshotHash===saved.snapshot.snapshotHash);assert.deepEqual(read.snapshot.rows,saved.snapshot.rows);await step(2);await action('report-open').click();
    await page.locator('.trusted-report summary').first().click();
    assert.ok((await page.locator('.trusted-report').innerText()).includes(saved.snapshot.snapshotHash));await page.locator('[data-report-close]').click();pass(scope+':native-indexeddb-refresh-report');
  }
  const snapshotHash=(await state()).snapshot.snapshotHash;
  const pointerId=(await state()).savedPointer.id;
  // Component fixture test only: no controller/IndexedDB state injection and no claim of native solving here.
  const component=await context.newPage();await component.goto(base);if(await component.locator('#loginForm .login-btn').isVisible())await component.locator('#loginForm .login-btn').click();await component.locator('.platform-home').waitFor();
  await component.evaluate(value=>window.STCTPlatformV19.trustedReport.open(value,'zh'),{study:fixtures.study,snapshot:fixtures.snapshot});
  assert.deepEqual(await component.locator('.trusted-report tr[data-report-group="RANKED"]').evaluateAll(es=>es.map(e=>e.dataset.reportCandidate)),fixtures.snapshot.decision.rankedScenarioIds);
  await component.locator('.trusted-report tr [data-report-scenario="PLAN-F"][data-report-evidence="outbound"]').click();
  assert.ok((await component.locator('[data-report-detail-table]').innerText()).includes('=HYPERLINK'));await component.locator('[data-report-workbook]').click();
  await component.locator('[data-report-sdk-status]').filter({hasText:'实际只读'}).waitFor();
  assert.ok(await component.evaluate(()=>Object.values(window.STCTUniverEvidence.read().sheets.evidence.cellData).flatMap(Object.values).some(c=>String(c.v).startsWith('=HYPERLINK')&&c.t===4&&!c.f)));
  await component.screenshot({path:path.join(evidence,'component-six-candidates-formula-text.png'),fullPage:true});
  await component.evaluate(value=>window.STCTPlatformV19.trustedReport.open(value,'zh'),fixtures.partial);
  assert.match(await component.locator('.tr-metrics article').first().innerText(),/10 → 5 km/);assert.match(await component.locator('.tr-metrics article').first().innerText(),/-50%/);assert.match(await component.locator('.tr-metrics article').first().innerText(),/50%/);
  await component.close();pass('report-component-six-candidates-common-sample',{method:'Verified synthetic fixture supplied to report API only; separate from native business journey'});
  async function reopenInTab(tab){
    await tab.goto(base);if(await tab.locator('#loginForm .login-btn').isVisible())await tab.locator('#loginForm .login-btn').click();
    await tab.locator('button[data-platform-route="/platform/scenarios"]:visible').first().click();
    await tab.locator(`[data-p5-action="open"][data-p5-id="${pointerId}"]`).click();
    await tab.locator('[data-design-route="/design/supply-chain-study"]').waitFor();await tab.locator('[data-supply-action="step"][data-supply-id="2"]').click();
  }
  const download=page.waitForEvent('download');await reveal(action('package-export'));await action('package-export').click();const pkg=await download;await pkg.saveAs(path.join(evidence,'full-chain-synthetic.package.json'));
  // Request-layer fault injection on the local SDK only; business state still comes from native IndexedDB.
  const fallbackPage=await page.context().newPage();await fallbackPage.route('**/vendor/univer/report.js',route=>route.abort());
  await reopenInTab(fallbackPage);await fallbackPage.locator('[data-supply-action="report-open"]').click();
  await fallbackPage.locator('.trusted-report tr [data-report-evidence="inbound"]').last().click();await fallbackPage.locator('[data-report-workbook]').click();
  await fallbackPage.locator('[data-report-sdk-status]').filter({hasText:'不可用'}).waitFor();assert.ok(await fallbackPage.locator('[data-report-detail-table] tbody tr').count());
  assert.ok((await fallbackPage.locator('[data-report-detail-note]').innerText()).includes(snapshotHash));await fallbackPage.screenshot({path:path.join(evidence,'sdk-failure-fallback.png'),fullPage:true});await fallbackPage.close();pass('sdk-request-failure-accessible-fallback',{injection:'Local SDK request aborted, no study state injection'});
  const late=await page.context().newPage();let seen=false;
  await late.route('**/vendor/univer/report.js',async route=>{seen=true;await new Promise(r=>setTimeout(r,1000));await route.continue().catch(()=>{});});
  await reopenInTab(late);await late.locator('[data-supply-action="report-open"]').click();await late.locator('.trusted-report tr [data-report-evidence="inbound"]').last().click();await late.locator('[data-report-workbook]').click();await late.keyboard.press('Escape');
  await late.locator('button[data-platform-route="/platform/scenarios"]:visible').first().click();await late.waitForTimeout(1500);
  assert.ok(seen);assert.equal(await late.locator('.trusted-report').count(),0);assert.equal(await late.evaluate(()=>window.STCTUniverEvidence?.read()||null),null);await late.close();pass('late-sdk-after-close-route',{injection:'Local SDK response delayed 1 s; close and navigation use business controls'});
  const noMap=await page.context().newPage();await noMap.route('**/vendor/maplibre/maplibre-gl.js*',route=>route.abort());
  await reopenInTab(noMap);assert.equal(await noMap.evaluate(()=>typeof window.maplibregl),'undefined');await noMap.locator('[data-supply-action="report-open"]').click();
  await noMap.locator('.trusted-report tr [data-report-evidence="sources"]').last().click();assert.ok((await noMap.locator('[data-report-detail-table]').innerText()).includes('ANALYSIS_CONDITIONS'));
  await noMap.screenshot({path:path.join(evidence,'no-map-report.png'),fullPage:true});await noMap.close();pass('no-map-report',{injection:'Local map renderer request unavailable; saved study reopened through public catalog controls'});
  await step(1);await field('planName').fill('Changed after report');await field('planName').press('Tab');await wait(s=>!s.snapshot);await step(2);assert.equal(await action('report-open').isEnabled(),false);pass('stale-result-report-blocked');
  assert.deepEqual(results.errors,[],'Unexpected page exceptions must not be reported PASS');results.status='PASS';
 }catch(error){results.status='FAIL';results.failure=error.stack;console.error(error);if(page)await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
 finally{fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify(results,null,2));if(browser)await browser.close();}
})();
