'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=process.argv[2]||path.resolve(__dirname,'..'),F=require(path.join(root,'facility-location-mvp1-v19.js'));
let checks=0;const check=fn=>{fn();checks++};
const minimal={studyId:'SECURITY-SYNTHETIC',coordinateSystem:'WGS84',demands:[{demandId:'D',coordinate:[120,30],quantity:1}],sites:[{siteId:'S',coordinate:[120,30],fixedCost:1,capacity:{quantity:10}}],options:{facilityCounts:[1],currency:'CNY',costPeriod:'MONTH',transportCostPerUnitKm:1}};
const large={...minimal,demands:Array.from({length:100},(_,i)=>({...minimal.demands[0],demandId:'D'+i})),sites:Array.from({length:60},(_,i)=>({...minimal.sites[0],siteId:'S'+i}))};
for(const aliases of [false,true]){
 const input=aliases?{...large,demands:undefined,sites:undefined,demandPoints:large.demands,candidateSites:large.sites}:large;
 for(const run of [()=>F.normalizeStudy(input),()=>F.buildMatrix(input),()=>F.preflight(input),()=>F.createRequest(input)]){
  let calls=0,clones=0;const old=Math.sin,originalClone=global.structuredClone;Math.sin=x=>{calls++;return old(x)};global.structuredClone=x=>{clones++;return originalClone(x)};
  try{check(()=>assert.throws(run,{code:'FACILITY_SIZE_LIMIT'}));check(()=>assert.equal(calls,0));check(()=>assert.equal(clones,0));}finally{Math.sin=old;global.structuredClone=originalClone;}
 }
}
for(const alias of ['matrix','matrixInput'])check(()=>assert.throws(()=>F.normalizeStudy({...minimal,[alias]:{rows:Array(5001).fill({})}}),{code:'FACILITY_SIZE_LIMIT'}));
const study=F.normalizeStudy(minimal),matrix=F.buildMatrix(study),oversized={...matrix,rows:Array(5001).fill(matrix.rows[0])};
check(()=>assert.throws(()=>F.preflight(study,oversized),{code:'FACILITY_SIZE_LIMIT'}));
check(()=>assert.throws(()=>F.createRequest(study,oversized),{code:'FACILITY_SIZE_LIMIT'}));
check(()=>assert.throws(()=>F.verifyResult(study,oversized,{}),{code:'FACILITY_SIZE_LIMIT'}));
const controller=F.createController();controller.load(minimal);const original=controller.snapshot();check(()=>assert.throws(()=>controller.load(large),{code:'FACILITY_SIZE_LIMIT'}));check(()=>assert.deepEqual(controller.snapshot(),original));
const inclusive={...minimal,demands:Array.from({length:100},(_,i)=>({...minimal.demands[0],demandId:'D'+i})),sites:Array.from({length:50},(_,i)=>({...minimal.sites[0],siteId:'S'+i}))};
check(()=>assert.equal(F.buildMatrix(inclusive).rows.length,5000));
const source=fs.readFileSync(path.join(root,'dispatch.html'),'utf8'),start=source.indexOf('function uploadText('),end=source.indexOf('function copyCmd(){',start),elements={'preview-box':{style:{},innerHTML:'',querySelector:()=>null},'update-cmd':{textContent:''}};
const payload='<img src=x onerror=alert(1)>',sandbox={window:{location:{protocol:'http:'}},$:(id)=>elements[id],FileReader:class{readAsArrayBuffer(){this.onload({target:{result:new ArrayBuffer(0)}})}},XLSX:{read:()=>({SheetNames:[payload],Sheets:{[payload]:{}}}),utils:{sheet_to_json:()=>[[payload,'ordinary & < > "'],[payload,0]]}},fetch:()=>Promise.resolve({json:()=>Promise.resolve({success:false,error:payload,stdout:payload})}),FormData:class{append(){}},setTimeout,location:{reload(){}},alert:()=>assert.fail('unexpected execution')};
vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);sandbox.handleFile({name:payload,size:10});
check(()=>assert.ok(!elements['preview-box'].innerHTML.includes('<img')));
check(()=>assert.ok(elements['preview-box'].innerHTML.includes('&lt;img')));
check(()=>assert.ok(elements['preview-box'].innerHTML.includes('<td>0</td>')));
check(()=>assert.ok(elements['update-cmd'].textContent.includes(payload)));
const py=spawnSync('python3',[path.join(__dirname,'enterprise_origin_regression.py'),path.join(root,'optimizer/ortools_service.py')],{encoding:'utf8'});check(()=>assert.equal(py.status,0,py.stderr));
(async()=>{
 sandbox.uploadToServer();await new Promise(r=>setImmediate(r));check(()=>assert.ok(!elements['preview-box'].innerHTML.includes('<img')));
 sandbox.XLSX.read=()=>{throw new Error(payload)};sandbox.handleFile({name:'normal.xlsx',size:10});check(()=>assert.ok(!elements['preview-box'].innerHTML.includes('<img')));
 for(const siteId of ['=2+2',' +SUM(1,2)','\uFEFF@SUM(1,2)','-SUM(1,2)']){
  const raw={...minimal,sites:[{...minimal.sites[0],siteId}],options:{...minimal.options,currency:' \t@SUM(1,2)',costPeriod:'\uFEFF+SUM(1,2)'}};
  const c=F.createController({fetch:async(_url,init)=>{const p=JSON.parse(init.body);return {ok:true,json:async()=>({schemaVersion:F.RESULT_SCHEMA,requestId:p.requestId,studyHash:p.studyHash,engine:{id:'OR_TOOLS_CP_SAT',version:'CONTROLLED_TEST',workers:1,randomSeed:p.options.randomSeed},results:[{facilityCount:1,rank:1,status:'OPTIMAL',selectedSiteIds:[siteId],assignments:[{demandId:'D',siteId,distanceMeters:0}],serviceRate:1,objectiveValue:1,bestBound:1,cost:{fixed:1,handling:0,transport:0,total:1,currency:p.options.currency,period:p.options.costPeriod}}]})}}});
  c.load(raw);await c.run();const csv=c.exportRecommendation('csv');check(()=>assert.equal(c.snapshot().verification.status,'PASS'));check(()=>assert.ok(csv.includes('"'+"'"+siteId+'"')));check(()=>assert.ok(csv.includes('"'+"' \t@SUM(1,2)"+'"')));check(()=>assert.ok(csv.includes('"'+"'\uFEFF+SUM(1,2)"+'"')));check(()=>assert.ok(csv.includes('"1"')));check(()=>assert.equal(c.snapshot().study.sites[0].siteId,siteId));
 }
 console.log(JSON.stringify({suite:'ENTERPRISE_SECURITY_BOUNDARIES',status:'PASS',checks,method:'Controlled module, VM preview and actual Handler methods; no browser/native solver claim',origin:JSON.parse(py.stdout)}));
})().catch(e=>{console.error(e);process.exitCode=1});
