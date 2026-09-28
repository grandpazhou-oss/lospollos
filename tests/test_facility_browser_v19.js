'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const Data=require('../design-data-adapter-v19.js');
const Facility=require('../facility-location-mvp1-v19.js');

const root=path.resolve(__dirname,'..');
const evidenceDir=path.resolve(process.env.STCT_EVIDENCE_DIR||path.join(root,'test-results','facility-browser'));
const screenshotDir=path.join(evidenceDir,'screenshots');
fs.mkdirSync(screenshotDir,{recursive:true});
const optimizerPort=Number(process.env.STCT_FACILITY_OPT_PORT||8791);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((request,response)=>{const url=new URL(request.url,'http://127.0.0.1'),relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),file=path.resolve(root,`.${relative}`);if(!file.startsWith(root+path.sep)){response.writeHead(403).end('Forbidden');return;}fs.readFile(file,(error,bytes)=>{if(error){response.writeHead(404).end('Not found');return;}response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});response.end(bytes);});});
const listen=()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const close=()=>new Promise(resolve=>server.close(resolve));
const checks=[];const pass=(id,detail)=>checks.push({id,status:'PASS',detail});
async function screenshot(page,name){const file=path.join(screenshotDir,name);await page.screenshot({path:file,fullPage:true});return{file,bytes:fs.statSync(file).size};}
async function download(page,action,name){const button=page.locator(`[data-design-action="${action}"]`).first(),details=button.locator('xpath=ancestor::details[1]');if(await details.count()&&!await details.evaluate(node=>node.open))await details.locator('summary').click();const pending=page.waitForEvent('download');await button.click();const item=await pending,file=path.join(evidenceDir,name);await item.saveAs(file);assert.ok(fs.statSync(file).size>0);return{file,bytes:fs.statSync(file).size};}
let activeBrowser;

(async()=>{
  const port=await listen(),base=`http://127.0.0.1:${port}/index.html?optPort=${optimizerPort}`;
  const browser=activeBrowser=await chromium.launch({headless:true,executablePath:process.env.STCT_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
  const pageErrors=[],consoleErrors=[],publicServiceRequests=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('request',request=>{const url=request.url();if(!url.startsWith(`http://127.0.0.1:${port}`)&&!url.startsWith(`http://127.0.0.1:${optimizerPort}`)&&/(directions|matrix|route\/v1|optimi[sz]|openai|anthropic)/i.test(url))publicServiceRequests.push(url);});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}#/design/facility-location`,{waitUntil:'load'});
  await page.waitForFunction(()=>window.STCTPlatformV19?.instance);
  await page.locator('#loginForm .login-btn').click();
  await page.waitForSelector('[data-design-route="/design/facility-location"]');
  if(await page.locator('.p7-empty').count())await page.locator('[data-design-action="p7-demo"]').click();
  const studyFile=path.join(evidenceDir,'synthetic-facility-study.json');
  fs.writeFileSync(studyFile,JSON.stringify(Facility.fromScenario(Data.createSyntheticStudy({orderCount:24,depotCount:6,vehicleCount:18,seed:1910}).scenario,{facilityCounts:[1,2,3],timeLimitSeconds:10}),null,2)+'\n');
  await page.locator('[data-facility-upload]').setInputFiles(studyFile);
  await page.waitForFunction(()=>document.querySelector('.design-notice')?.textContent.includes('数据已导入'));
  const commandBefore=await page.evaluate(async()=>{const context=window.STCTPlatformV19.instance.commandAdapter.createOperationalContext();await context.ready;const state=context.snapshot();return{plan:state.plan.planHash,run:state.execution.run.executionRunHash,events:state.execution.acceptedEvents.map(row=>row.eventHash),pending:context.offlineQueue.summary().pending};});

  await page.locator('.p7-steps [data-design-id="3"]').click();
  await page.locator('[data-design-action="facility-run"]').click();
  await page.waitForSelector('[data-p7-portfolio]',{timeout:120000});
  const results=await page.locator('[data-p7-portfolio]').first().locator('option').allTextContents();
  assert.ok(results.some(value=>/P=1/.test(value))&&results.some(value=>/P=2/.test(value))&&results.some(value=>/P=3/.test(value)));
  assert.ok(results.filter(value=>/#2/.test(value)).length>=2);
  pass('JF06-JF08-REAL-CP-SAT-COMPARISON',{resultCards:results.length,results});
  const desktopShot=await screenshot(page,'facility-desktop-results.png');
  const assignmentMap=page.locator('[data-p7-map-slot]');
  await assignmentMap.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const d=window.STCTPlatformV19.mapRuntime.diagnostics();return d.layers.includes('p7-design-relations')||d.mode==='SCHEMATIC';});
  const assignmentLineCount=await page.evaluate(()=>window.STCTPlatformV19.mapRuntime.snapshot().features.filter(row=>row.properties.kind==='assignment').length);
  assert.equal(assignmentLineCount,24);
  const assignmentMapFile=path.join(screenshotDir,'facility-assignment-map.png');
  await assignmentMap.screenshot({path:assignmentMapFile});
  const assignmentMapShot={file:assignmentMapFile,bytes:fs.statSync(assignmentMapFile).size};
  pass('JF10-ASSIGNMENT-MAP',{assignmentLineCount,screenshot:assignmentMapShot});

  const p2Option=await page.locator('[data-p7-portfolio]').first().locator('option').evaluateAll(options=>options.find(option=>/P=2 #1/.test(option.textContent))?.value);assert.ok(p2Option);
  await page.locator('[data-p7-portfolio]').first().selectOption(p2Option);
  await page.locator('.p7-steps [data-design-id="5"]').click();
  await page.locator('[data-design-action="facility-save"]').click();
  await page.waitForFunction(()=>document.querySelector('.design-notice')?.textContent.includes('方案已保存'));
  await page.locator('[data-design-action="facility-reopen"]').click();
  await page.waitForFunction(()=>document.querySelector('.design-notice')?.textContent.includes('REOPENED'));
  pass('JF12-SAVE-REOPEN',{message:await page.locator('.design-notice').first().textContent()});
  const exports=[];
  exports.push(await download(page,'facility-export-json','facility-recommendation.json'));
  exports.push(await download(page,'facility-export-csv','facility-recommendation.csv'));
  exports.push(await download(page,'facility-export-html','facility-recommendation.html'));
  pass('JF13-EXPORT-RECOMMENDATION',exports);

  const validate=page.locator(`[data-design-action="facility-validate"][data-design-id="${p2Option}"]:not([disabled])`);
  await validate.click();
  await page.waitForSelector('[data-p5-action="p6-run"]',{timeout:60000});
  await page.locator('[data-p5-action="p6-run"]').click();
  await page.waitForFunction(()=>{const message=document.querySelector('[data-p5-message]')?.textContent.trim()||'';return document.querySelector('[data-p5-action="p6-save"]')||(message&&!/^(处理中|Working|処理中)/.test(message));},null,{timeout:120000});
  if(!await page.locator('[data-p5-action="p6-save"]').count()){
    const diagnostic=await page.evaluate(()=>({message:document.querySelector('[data-p5-message]')?.textContent||'',text:document.querySelector('.platform-services')?.innerText||'',bridge:window.STCTPlatformV19.instance.diagnostics().services?.bridge||null}));
    fs.writeFileSync(path.join(evidenceDir,'facility-p6-browser-failure.json'),JSON.stringify(diagnostic,null,2)+'\n');
    throw Object.assign(new Error(`Facility P6 browser failed: ${diagnostic.message||'UNKNOWN'}`),{diagnostic});
  }
  const validationText=(await page.locator('.platform-services').innerText()).slice(0,1800);
  assert.match(validationText,/PASS/);
  pass('JF14-JF16-ISOLATED-COMMAND-VALIDATION',{text:validationText});
  const commandAfter=await page.evaluate(async()=>{const context=window.STCTPlatformV19.instance.commandAdapter.createOperationalContext();await context.ready;const state=context.snapshot();return{plan:state.plan.planHash,run:state.execution.run.executionRunHash,events:state.execution.acceptedEvents.map(row=>row.eventHash),pending:context.offlineQueue.summary().pending};});
  assert.deepEqual(commandAfter,commandBefore);
  pass('COMMAND-STATE-PROTECTED',commandAfter);

  const localeHeadings={};
  for(const locale of ['zh','en','ja']){await page.evaluate(value=>window.STCTPlatformV19.instance.setLocale(value),locale);await page.evaluate(()=>window.STCTPlatformV19.instance.navigate('/design/facility-location'));await page.waitForSelector('[data-design-route="/design/facility-location"]');localeHeadings[locale]=(await page.locator('.design-page-heading h1').textContent()).trim();assert.ok(localeHeadings[locale]);}
  pass('JF17-TRILINGUAL',localeHeadings);
  await page.evaluate(()=>{window.STCTPlatformV19.instance.setNoWebGL(true);window.STCTPlatformV19.instance.setReducedMotion(true);});
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-p7-kind="demand"]').click();
  const mobile=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,noWebGL:window.STCTPlatformV19.instance.snapshot().noWebGL,reducedMotion:window.STCTPlatformV19.instance.snapshot().reducedMotion,tableRows:document.querySelectorAll('.p7-map-list [data-kind="demand"]').length}));
  assert.ok(mobile.scrollWidth<=mobile.viewport+1);assert.equal(mobile.noWebGL,true);assert.equal(mobile.reducedMotion,true);assert.ok(mobile.tableRows>0);
  const mobileShot=await screenshot(page,'facility-mobile-no-webgl.png');
  pass('JF17-MOBILE-NO-WEBGL-REDUCED-MOTION',{...mobile,screenshot:mobileShot});
  await page.setViewportSize({width:844,height:390});
  const landscape=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,tableRows:document.querySelectorAll('.p7-map-list [data-kind="demand"]').length}));
  assert.ok(landscape.scrollWidth<=landscape.viewport+1);assert.ok(landscape.tableRows>0);
  const landscapeShot=await screenshot(page,'facility-landscape-no-webgl.png');
  pass('JF17-LANDSCAPE-NO-WEBGL',{...landscape,screenshot:landscapeShot});
  assert.equal(pageErrors.length,0);assert.equal(publicServiceRequests.length,0);
  pass('FACILITY-BROWSER-RUNTIME-HEALTH',{pageErrors,consoleErrors,publicServiceRequests});
  const output={schemaVersion:'stct-v1.9-facility-mvp1-browser-e2e-v1',status:'PASS',checks,desktopShot,assignmentMapShot,mobileShot,pageErrors,consoleErrors,publicServiceRequests};
  fs.writeFileSync(path.join(evidenceDir,'facility-browser-e2e.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output,null,2));
  await context.close();await browser.close();await close();
})().catch(async error=>{console.error(error.stack||error.message);try{await activeBrowser?.close();await close();}catch(_){}process.exitCode=1;});
