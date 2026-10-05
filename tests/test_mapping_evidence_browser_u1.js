'use strict';
// Homepage journeys through upload and mapping controls; state is observed, never injected.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const base=process.env.STCT_UI_URL,out=process.env.STCT_UI_EVIDENCE,binary=process.env.STCT_BROWSER,uc=process.env.STCT_UC_WORKBOOK;
assert.ok(base&&out&&binary&&uc,'Explicit isolated URL, evidence directory, browser and UC test copy required');
fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const report={status:'RUNNING',tier:'BROWSER_BUSINESS_CONTROLS',checks:[],pageErrors:[],sourceHash:sha(uc)};
const csv=path.join(out,'synthetic-headings.csv');
fs.writeFileSync(csv,'编号,客户编号,客户名称,customerName,经度,纬度,2027-01 m3\nR1,001,Alpha,Alternate,120,30,0.00001\nR2,002,<img src=x>,Other,121,31,0\nR3,003,Cedar,Third,122,32,2.125\nR4,004,Birch,Fourth,123,33,3.25\n');
let browser,page,ctx;
const state=()=>page.evaluate(()=>window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
async function start(){
 ctx=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:950},reducedMotion:'reduce'});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['blob:','data:'].includes(u.protocol)?r.continue():r.abort();});
 page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.goto(base);await page.locator('#loginForm .login-btn').click();
 await page.getByRole('button',{name:/测算供应链方案/}).click();
}
async function upload(file){await page.locator('[data-supply-file="workbook"]').setInputFiles(file);await page.locator('[data-supply-mapping-overview]').waitFor();}
async function apply(){await page.locator('[data-supply-action="profile-confirm"]').click();await page.locator('[data-supply-preflight]').waitFor();return state();}
async function saveEvidence(name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});report.checks.push(name);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));}
(async()=>{try{
 browser=await chromium.launch({executablePath:binary,headless:true,args:['--disable-webgl']});
 await start();await upload(uc);
 assert.equal(await page.locator('[data-supply-action="mapping-select"]').count(),8);
 await page.getByRole('button',{name:'③天津销售出库',exact:true}).click();
 const card=page.locator('[data-supply-review-field="customerName"]');
 assert.equal(await card.getAttribute('data-recognition-status'),'PROFILE');
 await card.locator('summary').press('Enter');
 const raw=await card.locator('.sc-field-evidence').innerText();assert.match(raw,/原表行 4/);assert.match(raw,/158/);
 assert.equal(await page.locator('[data-supply-review-field="currentSiteId"]').getAttribute('data-recognition-status'),'CONSTANT');
 assert.match(await page.locator('[data-supply-map-field="currentSiteId"] option:checked').innerText(),/配置固定值/);
 const cards=await page.locator('.sc-recognition-card').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));
 assert.ok(cards.every(w=>w>=239),'Cards retain readable widths on desktop');
 await saveEvidence('UC-mapping-original-values-desktop');
 const imported=await apply();assert.equal(imported.study.periodDemand.length,1799);assert.equal(imported.study.observedInbound.length,84);assert.equal(imported.study.observedAssignments.length,257);
 const total=imported.study.periodDemand.reduce((s,d)=>s+d.quantity,0);assert.ok(Math.abs(total-115934.168)<1e-7);
 await page.locator('[data-supply-action="draft-save"]').click();await page.waitForFunction(()=>!!window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.savedPointer);
 const id=(await state()).study.studyId;await page.reload();if(await page.locator('#loginForm .login-btn').isVisible())await page.locator('#loginForm .login-btn').click();
 await page.waitForFunction(id=>window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.study?.studyId===id,id);
 assert.equal((await state()).study.periodDemand.length,1799);report.uc={studyId:id,total,records:1799,draftReread:true};await saveEvidence('UC-draft-reread');await ctx.close();
 await start();await upload(csv);await page.locator('[data-supply-action="mapping-select"]').first().click();
 const name=page.locator('[data-supply-review-field="customerName"]');assert.equal(await name.getAttribute('data-recognition-status'),'AMBIGUOUS');
 await page.locator('[data-supply-action="profile-confirm"]').click();assert.match(await page.locator('.sc-message.is-error').innerText(),/必要字段尚未映射/);
 await page.locator('[data-supply-action="import-review"]').click();await page.waitForFunction(()=>document.activeElement.dataset.supplyMapField==='customerName');
 await page.locator('[data-supply-map-field="customerName"]').selectOption('3');assert.equal(await name.getAttribute('data-recognition-status'),'CHOSEN');
 await name.locator('summary').press('Enter');assert.match(await name.locator('.sc-field-evidence').innerText(),/<img src=x>/);assert.equal(await name.locator('img').count(),0);
 assert.match(await page.locator('[data-supply-review-field="customerNodeId"] .sc-raw-sample').innerText(),/001/);
 for(const locale of ['zh','en','ja']){
  await page.setViewportSize({width:1440,height:950});
  await page.locator('.platform-locale-control select').selectOption(locale);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:950});
   for(let mode=0;mode<2;mode++){
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await name.getAttribute('data-recognition-status'),'CHOSEN');
    await saveEvidence('nonUC-'+locale+'-'+width+'-theme'+mode);
    await page.locator('[data-ui-theme-toggle]').click();
   }
  }
 }
 const synthetic=await apply();assert.equal(synthetic.study.periodDemand.length,4);assert.equal(synthetic.study.periodDemand.reduce((s,d)=>s+d.quantity,0),5.37501);assert.equal(synthetic.study.nodes[0].nodeId,'001');
 report.nonUC={records:4,total:5.37501};await ctx.close();await start();
 const invalid=path.join(out,'synthetic-errors.csv');fs.writeFileSync(invalid,'编号,客户编号,客户名称,2027-01 m3\nR1,001,Valid,2\nR2,002,Broken,oops\nR3,003,Bad,wrong\n');
 await upload(invalid);await page.locator('[data-supply-action="profile-confirm"]').click();await page.locator('[data-supply-action="import-audit"]').click();
 const queue=page.locator('[data-supply-import-audit]');assert.equal(await queue.locator('tbody tr').count(),2);assert.match(await queue.innerText(),/oops|wrong/);
 await queue.locator('[data-supply-action="audit-exclude"]').first().click();assert.match(await page.locator('.sc-message.is-error').innerText(),/填写排除理由/);
 await page.locator('[data-supply-field="exclusionReason"]').fill('Reviewed synthetic invalid quantity');await page.locator('[data-supply-field="exclusionConfirmed"]').check();await queue.locator('[data-supply-action="audit-exclude"]').first().click();
 assert.equal(await queue.locator('[data-supply-action="audit-undo"]').count(),1);await queue.locator('[data-supply-action="audit-undo"]').click();assert.equal(await queue.locator('[data-supply-action="audit-exclude"]').count(),2);
 for(let i=0;i<2;i++){await page.locator('[data-supply-field="exclusionConfirmed"]').check();await queue.locator('[data-supply-action="audit-exclude"]').first().click();}
 await saveEvidence('nonUC-error-queue-reversible-reviewed-exclusions');const corrected=await apply();assert.equal(corrected.study.periodDemand.length,1);assert.equal(corrected.study.periodDemand[0].quantity,2);assert.equal(corrected.imported.excludedRows.length,2);
 assert.equal(sha(uc),report.sourceHash);assert.deepEqual(report.pageErrors,[]);report.status='PASS';
 }catch(e){report.status='FAIL';report.error=e.stack;if(page){report.body=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;
 }finally{if(browser)await browser.close();fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}})();
