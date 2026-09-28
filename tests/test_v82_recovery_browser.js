#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const Contract=require('../network-contract-v18.js');
const XLSX=require('../vendor/xlsx/xlsx.full.min.js');

const root=path.resolve(__dirname,'..');
const fixture=process.env.STCT_FACILITY_PACKAGE;
if(!fixture)throw Error('STCT_FACILITY_PACKAGE is required');
const supplyFixture=process.env.STCT_SUPPLY_PACKAGE;
if(!supplyFixture)throw Error('STCT_SUPPLY_PACKAGE is required');
const output=process.env.STCT_RECOVERY_EVIDENCE||'/tmp/stct-v82-recovery.json';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
  const file=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!file.startsWith(root+path.sep))return response.writeHead(403).end();
  fs.readFile(file,(error,data)=>error?response.writeHead(404).end():response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(data));
});
const results={status:'RUNNING',stages:[],injection:'isolated browser sessionStorage and IndexedDB storage layer',pageErrors:[]};
const write=()=>fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
async function catalog(page){
  const home=page.locator('.platform-home');
  if(await home.isVisible())await page.locator('.platform-home button[data-platform-route="/platform/scenarios"]').click();
  else await page.locator('button[data-platform-route="/platform/scenarios"]:visible').first().click();
  await page.locator('[data-p5-package]').waitFor();
}
async function upload(page,name,content){
  await page.locator('[data-p5-package]').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(content)});
  await page.locator('.p5-message').waitFor();
}
async function main(){
  let browser;
  try{
    const port=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
    browser=await chromium.launch({executablePath:process.env.STCT_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--disable-webgl']});
    const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
    await context.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
    const page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('pageerror',error=>results.pageErrors.push(error.message));
    const url=`http://127.0.0.1:${port}/index.html?noWebGL=1`;
    await page.goto(url,{waitUntil:'load'});
    const login=page.locator('#loginForm .login-btn');if(await login.isVisible())await login.click();
    await page.locator('.platform-home').waitFor();await catalog(page);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-id'),'');
    assert.equal(await page.locator('[data-p5-entry]').count(),0);
    results.stages.push('EMPTY_CATALOG_HAS_NO_IMPLICIT_STUDY');
    const valid=fs.readFileSync(fixture,'utf8');
    await upload(page,'facility-valid.json',valid);
    await page.locator('[data-p5-action="import-package"]').waitFor();
    await page.locator('[data-p5-action="import-package"]').click();
    await page.locator('[data-design-route="/design/facility-location"]').waitFor();
    const facility=JSON.parse(valid),id=facility.pointer.id;
    await catalog(page);assert.equal(await page.locator(`[data-p5-entry="${id}"]`).count(),1);
    results.stages.push('VALID_FACILITY_IMPORT_VIA_CONTROLS');

    await page.evaluate(()=>sessionStorage.setItem('STCT_CURRENT_STUDY_V8','FACILITY:MISSING'));
    await page.reload({waitUntil:'load'});if(await login.isVisible())await login.click();
    await catalog(page);
    assert.match(await page.locator('[data-p5-message]').innerText(),/上次研究不在目录中/);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-id'),'');
    assert.equal(await page.locator(`[data-p5-entry="${id}"]`).count(),1);
    await page.locator(`[data-p5-entry="${id}"] [data-p5-action="open"]`).click();
    await page.locator('[data-design-route="/design/facility-location"]').waitFor();
    await catalog(page);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'FACILITY');
    results.stages.push('MISSING_CURRENT_POINTER_RECOVERED_FROM_CATALOG');

    await upload(page,'future.json',JSON.stringify({schemaVersion:'stct-study-package-p99',records:{},pointers:[]}));
    await page.getByText(/此研究包格式不受当前版本支持/).waitFor();
    assert.equal(await page.locator('[data-p5-action="import-package"]').count(),0);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'FACILITY');
    results.stages.push('FUTURE_PACKAGE_REJECTED_WITH_CURRENT_STUDY_RETAINED');

    const old={schemaVersion:'stct-design-study-readonly-v1.9-p4',mode:'READ_ONLY',study:{studyId:'OLD'}};
    old.exportHash=Contract.hashArtifact(old);
    await upload(page,'old-readonly.json',JSON.stringify(old));
    await page.getByText(/旧版研究包仅供只读核查/).waitFor();
    assert.equal(await page.locator('[data-p5-action="import-package"]').count(),0);
    old.study.studyId='TAMPERED';
    await upload(page,'old-tampered.json',JSON.stringify(old));
    await page.locator('[data-p5-message]').getByText('PACKAGE_HASH_INVALID',{exact:true}).waitFor();
    results.stages.push('OLD_READONLY_HASH_CHECKED');

    facility.pointer.name='TAMPERED';
    await upload(page,'facility-tampered.json',JSON.stringify(facility));
    await page.locator('[data-p5-message]').getByText('FACILITY_PACKAGE_INVALID',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'FACILITY');
    results.stages.push('DAMAGED_FACILITY_PACKAGE_REJECTED');

    const second=await context.newPage();second.setDefaultTimeout(20000);
    second.on('pageerror',error=>results.pageErrors.push(error.message));
    await second.goto(url,{waitUntil:'load'});
    const secondLogin=second.locator('#loginForm .login-btn');if(await secondLogin.isVisible())await secondLogin.click();
    await second.locator('.platform-home').waitFor();await catalog(second);
    const supplyPackage=fs.readFileSync(supplyFixture,'utf8');
    await upload(second,'supply-valid.json',supplyPackage);
    await second.locator('[data-p5-action="import-package"]').click();
    await second.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
    await catalog(second);
    assert.equal(await second.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'SUPPLY_CHAIN_PERIOD');
    await second.locator('[data-p5-action="save-study"]').click();
    await second.locator('[data-p5-message]').getByText('SAVED',{exact:true}).waitFor();
    await page.locator('[data-p5-action="save-study"]').click();
    await page.waitForTimeout(300);
    const facilitySaveMessage=await page.locator('[data-p5-message]').innerText();
    assert.equal(facilitySaveMessage,'SAVED',facilitySaveMessage);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'FACILITY');
    assert.equal(await second.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'SUPPLY_CHAIN_PERIOD');
    results.stages.push('TWO_TABS_DIFFERENT_STUDIES_SAVE_WITHOUT_FALSE_CONFLICT');
    await second.close();
    await page.reload({waitUntil:'load'});if(await login.isVisible())await login.click();await catalog(page);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-kind'),'FACILITY');
    assert.equal(await page.locator(`[data-p5-entry="${id}"]`).count(),1);
    results.stages.push('SAVED_FACILITY_REFRESH_READBACK');

    const tinyBook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(tinyBook,XLSX.utils.aoa_to_sheet([['name','code','role','coordinate'],['Source','S-Z','FACTORY','120.0,30.0'],['Site','W-Z','DC','120.1,30.0']]),'Locations');
    XLSX.utils.book_append_sheet(tinyBook,XLSX.utils.aoa_to_sheet([['customerNumber','customer','assignedDepot','coordinate','2026-01'],['D-Z','Tiny demand','W-Z','120.2,30.0',0.0000001]]),'Demand');
    XLSX.utils.book_append_sheet(tinyBook,XLSX.utils.aoa_to_sheet([['flowId','fromNodeId','toNodeId','2026-01'],['F-Z','S-Z','W-Z',0.0000001]]),'Inbound');
    const third=await context.newPage();third.setDefaultTimeout(20000);
    third.on('pageerror',error=>results.pageErrors.push(error.message));
    let solvePosts=0;third.on('request',request=>{if(request.method()==='POST'&&/supply-chain-(?:jobs|optimize)/.test(request.url()))solvePosts++;});
    await third.goto(url,{waitUntil:'load'});const thirdLogin=third.locator('#loginForm .login-btn');if(await thirdLogin.isVisible())await thirdLogin.click();
    await third.locator('.platform-home button[data-platform-workspace="DESIGN"]').click();
    await third.locator('button[data-platform-route="/design/supply-chain-study"]:visible').first().click();
    await third.locator('[data-supply-file="workbook"]').setInputFiles({name:'tiny-synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(tinyBook,{bookType:'xlsx',type:'buffer'}))});
    await third.locator('[data-supply-action="profile-confirm"]').click();
    await third.locator('[data-supply-field="analysisScope"]').selectOption('FULL_CHAIN');
    await third.locator('[data-supply-field="homogeneousDemandConfirmed"]').check();
    await third.locator('[data-supply-field="allowAllSupplierSiteEdgesConfirmed"]').check();
    await third.locator('[data-supply-field="geoConfirmed"]').check();
    await third.locator('[data-quantity-preview]').waitFor();
    assert.match(await third.locator('[data-quantity-preview]').innerText(),/1e-7|0\.0000001/);
    assert.match(await third.locator('[data-quantity-preview]').innerText(),/建议值仅作误差预览/);
    const auditDownload=third.waitForEvent('download');await third.locator('[data-supply-action="quantity-audit-export"]').click();
    const auditFile=await auditDownload,audit=JSON.parse(fs.readFileSync(await auditFile.path(),'utf8'));
    assert.equal(audit.audit.lossyPreview.rows[0].original,0.0000001);
    assert.equal(audit.audit.lossyPreview.rows[0].suggested,0);
    await third.locator('[data-supply-action="analyze"]').click();
    assert.equal(solvePosts,0);
    assert.equal((await third.evaluate(()=>window.STCTPlatformV19.instance.designAdapter.supplySnapshot())).snapshot,null);
    results.stages.push('TINY_QUANTITY_PREVIEW_AUDIT_EXPORT_NO_SOLVER_POST');
    const zeroBook=XLSX.read(XLSX.write(tinyBook,{bookType:'xlsx',type:'buffer'}),{type:'buffer'});
    zeroBook.Sheets.Demand.E2.v=0;zeroBook.Sheets.Inbound.D2.v=0;
    await third.locator('[data-supply-action="step"][data-supply-id="0"]').click();
    await third.locator('[data-supply-file="workbook"]').setInputFiles({name:'zero-synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(zeroBook,{bookType:'xlsx',type:'buffer'}))});
    await third.locator('[data-supply-action="profile-confirm"]').click();
    await third.locator('[data-supply-field="analysisScope"]').selectOption('FULL_CHAIN');
    await third.locator('[data-supply-field="homogeneousDemandConfirmed"]').check();
    await third.locator('[data-supply-field="allowAllSupplierSiteEdgesConfirmed"]').check();
    await third.locator('[data-supply-field="geoConfirmed"]').check();
    assert.match(await third.locator('[data-quantity-preview]').innerText(),/无需计算/);
    await third.locator('[data-supply-action="analyze"]').click();
    assert.match(await third.locator('.sc-message').first().innerText(),/无需计算/);
    assert.equal(solvePosts,0);
    results.stages.push('ZERO_DEMAND_NO_CALCULATION_BUSINESS_STATE');
    await third.close();

    await page.evaluate(async pointerId=>{
      const opened=indexedDB.open('stct-platform-v19-p5',4);
      const db=await new Promise((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);opened.onerror=()=>reject(opened.error);});
      const pointer=await new Promise((resolve,reject)=>{const request=db.transaction('pointers').objectStore('pointers').get(pointerId);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const ref=pointer.refs.find(row=>row.store==='facilityStudies');
      await new Promise((resolve,reject)=>{const tx=db.transaction('facilityStudies','readwrite');tx.objectStore('facilityStudies').delete(ref.id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});db.close();
    },id);
    await page.reload({waitUntil:'load'});if(await login.isVisible())await login.click();await catalog(page);
    assert.match(await page.locator('[data-p5-message]').innerText(),/当前设施研究存档缺少资料/);
    assert.equal(await page.locator(`[data-p5-entry="${id}"]`).count(),1);
    assert.equal(await page.locator('[data-v8-current-study]').getAttribute('data-study-id'),'');
    results.stages.push('MISSING_REFERENCED_RECORD_VISIBLE_IN_CATALOG');
    assert.deepEqual(results.pageErrors,[]);
    results.status='PASS';write();console.log(JSON.stringify(results));
  }catch(error){results.status='FAIL';results.error=String(error.stack||error);write();console.error(results.error);process.exitCode=1;}
  finally{if(browser)await browser.close();if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
main();
