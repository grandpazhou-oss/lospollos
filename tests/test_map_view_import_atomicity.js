#!/usr/bin/env node
'use strict';
// Real production closures and WebCrypto; storage/DOM/adapter doubles only. This is not browser evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),KEY='stct.map-analysis-views.v1',MAX=2000000,clone=structuredClone;
const identity={studyId:'SYNTHETIC-ATOMIC-VIEW',studyHash:'INPUT',snapshotHash:'SNAP',route:'/design/supply-chain-study'};
const comparison={scenarioId:'PLAN-B',referenceScenarioId:'PLAN-A',mode:'BOTH',leg:'BOTH',period:'2028-01',change:'ALL',nodeId:''};
const state={analysisIds:['A'],analysisDirection:'ANY',activeLayerIds:['facilities'],center:[110,30],zoom:4,bearing:0,pitch:0,split:false,selectedEntityId:'',relatedOnly:false,analysisOpen:true,note:'当前备注'};
const model={owner:'SUPPLY',provenance:{...identity,selectedScenarioId:'PLAN-B',referenceScenarioId:'PLAN-A',mode:'BOTH',leg:'BOTH',period:'2028-01',changeFilter:'ALL',nodeId:''},entities:[{id:'A'},{id:'B'}],layers:[{id:'facilities'}],relationContext:{scenarioName:'Plan B',periodLabel:'2028-01'}};
const originalModel=JSON.stringify(model),record=(id='imported',note='中文 / 日本語 / UTF-8')=>({id,name:'Synthetic view '+id,identity:clone(identity),comparison:clone(comparison),state:{...clone(state),note},label:'Synthetic fixture'});
const runtimeSource=fs.readFileSync(path.join(root,'platform-map-runtime-v19.js'),'utf8');
const seam=`
  root.__viewAtomicityUnit={
    configure(nextModel,nextConfig,state){
      model=nextModel;config=nextConfig;owner='SUPPLY';views.clear();Object.assign(view(),state);map=null;ready=false;styleCamera=null;
      const nodes=new Map();host={classList:{remove(){}},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',setAttribute(){},focus(){},remove(){}});return nodes.get(selector);},querySelectorAll(){return [];}};
      renderAnalysis=()=>{};list=()=>{};inspector=()=>{};updateSource=()=>{};renderMode=()=>{};resizeMaps=()=>{};syncCamera=()=>{};
    },readBookmarks,writeBookmarks,saveBookmark,importView,restoreBookmark,renderBookmarks,analysisClick,downloadBookmarkBackup,bookmarkError,
    state:()=>view(),model:()=>model,html:()=>host.querySelector('.p7-map-bookmarks').innerHTML
  };
`;
const store=new Map(),operations=[];let rejectWrite=false,uuid=0,downloadedBlob=null;
const sandbox={structuredClone,TextEncoder,Uint8Array,Blob,setTimeout:fn=>fn(),crypto:{subtle:webcrypto.subtle,randomUUID:()=>`new-${++uuid}`},localStorage:{getItem:key=>store.get(key)??null,setItem(key,value){operations.push(['write',value.length]);if(rejectWrite)throw Object.assign(new Error('storage quota blocked'),{name:'QuotaExceededError'});store.set(key,value);},removeItem:key=>{operations.push(['remove']);store.delete(key);}},URL:{createObjectURL(blob){downloadedBlob=blob;return 'blob:unit';},revokeObjectURL(){}}};
vm.runInNewContext(runtimeSource.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox,{filename:'platform-map-runtime-v19.js (atomicity unit seam)'});
const api=sandbox.__viewAtomicityUnit;
sandbox.document={createElement:()=>({click(){}})};
let calls=[],assertions=0;const results=[];
const eq=(actual,expected,label)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)),label);assertions++;};
const ok=(value,label)=>{assert.ok(value,label);assertions++;};
const raw=()=>store.get(KEY)??null;
const put=rows=>store.set(KEY,JSON.stringify({version:1,views:rows}));
function configure(options={}){calls=[];operations.length=0;rejectWrite=false;api.configure(clone(model),{locale:options.locale||'zh',route:identity.route,onMapComparison:(optionsArg,expected,dry=false)=>{calls.push({options:clone(optionsArg),identity:clone(expected),dry});return options.callback?options.callback(optionsArg,expected,dry):true;}},{...clone(state),bookmarkName:'New current view',bookmarksOpen:true,...clone(options.state||{})});}
async function signed(row){const payload={version:'stct-analysis-view-v1',view:row,provenance:clone(model.provenance),scope:{filtered:1,total:1},groups:[],relations:[],grid:{cells:[]}},bytes=new TextEncoder().encode(JSON.stringify(payload)),digest=await webcrypto.subtle.digest('SHA-256',bytes),value={...payload,contentSHA256:Buffer.from(digest).toString('hex')},text=JSON.stringify(value);return {size:Buffer.byteLength(text),text:async()=>text};}
async function run(name,fn){try{await fn();eq(JSON.stringify(model),originalModel,'input model unchanged');eq(JSON.stringify(api.model()),originalModel,'runtime model unchanged');results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message,stack:error.stack});}}
function remove(id){return api.analysisClick({target:{closest:selector=>selector==='[data-p7-bookmark-remove]'?{dataset:{p7BookmarkRemove:id}}:null}});}
function largeRecord(id){const row=record(id);row.state.regionGeometry={type:'Feature',properties:{description:'a'.repeat(600000)},geometry:{type:'Polygon',coordinates:[[[109,29],[111,29],[111,31],[109,31],[109,29]]]}};return row;}
sandbox.STCTPlatformV19.supplyMap=require('../platform-supply-map-v8.js');
function reverseKeys(value){if(Array.isArray(value))return value.map(reverseKeys);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverseKeys(value[key])]));return value;}

(async()=>{
  await run('save and import capacity rejection preserve original storage bytes',async()=>{
    configure();put([largeRecord('a'),largeRecord('b'),largeRecord('c')]);const before=raw();ok(before.length<MAX,'fixture fits normal read');
    configure({state:{regionGeometry:largeRecord('current').state.regionGeometry}});api.saveBookmark();eq(raw(),before,'over-capacity save does not write');eq(operations.length,0,'no setItem on capacity rejection');ok(api.state().bookmarkNotice.includes('容量不足'),'business capacity message');
    configure();await api.importView(await signed(largeRecord('d')));eq(raw(),before,'over-capacity import does not write');eq(calls.map(c=>c.dry),[true],'preflight only; no restore');eq(operations.length,0,'capacity checked before storage write');eq(api.state().note,state.note,'current filter state retained');
  });
  await run('quota failure keeps bytes, entered name and visible analysis',async()=>{
    configure();put([record('existing')]);const before=raw();rejectWrite=true;api.saveBookmark();eq(raw(),before,'save quota atomic');eq(api.state().bookmarkName,'New current view','name retained');
    calls=[];await api.importView(await signed(record()));eq(raw(),before,'import quota atomic');eq(calls.map(c=>c.dry),[true],'no restore after quota');eq(api.state().note,state.note,'current note retained');ok(api.state().viewNotice.includes('未回读'),'failure is not success');rejectWrite=false;
  });
  await run('old excessive storage stays recoverable and original backup is byte-identical',async()=>{
    configure();put(['a','b','c','d'].map(largeRecord));const before=raw();ok(before.length>MAX&&before.length<10000000,'oversized legacy fixture');assert.throws(()=>api.readBookmarks(),/MAP_VIEWS_TOO_LARGE/);assertions++;
    eq(api.readBookmarks(true).length,4,'recovery sees all original entries');api.renderBookmarks();ok(api.html().includes('data-p7-bookmark-backup'),'backup offered');ok(api.html().includes('data-p7-bookmark-remove="a"'),'deletion offered');
    api.downloadBookmarkBackup();eq(await downloadedBlob.text(),before,'raw backup byte fidelity');eq(raw(),before,'read and backup do not mutate');ok(api.restoreBookmark('a'),'legacy current view can restore');
    remove('a');eq(api.readBookmarks().map(row=>row.id),['b','c','d'],'deletion restores readable storage');ok(raw().length<MAX,'back under limit');
  });
  await run('old excessive storage can be reduced by multiple deletions',async()=>{
    configure();put(['a','b','c','d','e'].map(largeRecord));const before=raw();remove('a');ok(raw().length<before.length,'first deletion must make progress even while still excessive');
    eq(api.readBookmarks(true).map(row=>row.id),['b','c','d','e'],'only requested legacy entry removed');remove('b');eq(api.readBookmarks().map(row=>row.id),['c','d','e'],'second deletion crosses normal capacity boundary');
  });
  await run('legacy recovery cannot increase storage or bypass the safety bound',async()=>{
    configure();const rows=['a','b','c','d','e'].map(largeRecord);put(rows);const before=raw();
    for(const attempted of [rows,[...rows,largeRecord('f')]]){assert.throws(()=>api.writeBookmarks(attempted,true),/MAP_VIEWS_TOO_LARGE/);assertions++;eq(raw(),before,'recovery must strictly reduce stored characters');}
    store.set(KEY,' '.repeat(10000001));assert.throws(()=>api.readBookmarks(true),/MAP_VIEWS_TOO_LARGE/);assertions++;eq(raw().length,10000001,'unsafe oversized input retained for backup');
  });
  await run('same ID different content is rejected before any restore or write',async()=>{
    configure();put([record('same','原备注')]);const before=raw();await api.importView(await signed(record('same','修改备注')));
    eq(raw(),before,'original exact bytes retained');eq(calls,[],'conflict precedes adapter');eq(operations.length,0,'no write');eq(api.state().note,state.note,'old bookmark not silently restored');ok(api.state().viewNotice.includes('同编号视角的内容不同'),'specific conflict');
  });
  await run('same ID same content is idempotent including reordered object keys',async()=>{
    configure();const row=record('same');put([row]);const before=raw();await api.importView(await signed(row));eq(raw(),before,'no rewrite for duplicate');eq(operations.length,0,'no storage write');eq(calls.map(c=>c.dry),[true,false],'preflight and one restore');eq(api.state().note,row.state.note,'UTF-8 notes restored');
    configure();await api.importView(await signed(reverseKeys(row)));eq(raw(),before,'key ordering does not cause conflict');eq(operations.length,0,'reordered duplicate remains idempotent');eq(calls.map(c=>c.dry),[true,false],'reordered content restores once');
  });
  await run('unavailable candidate is rejected during pure preflight',async()=>{
    configure({callback:()=>false});put([record('existing')]);const before=raw(),row=record();row.comparison.scenarioId='MISSING';await api.importView(await signed(row));
    eq(raw(),before,'invalid comparison cannot enter storage');eq(operations.length,0,'no write');eq(calls.map(c=>c.dry),[true],'not restored');eq(api.state().note,state.note,'visible state unchanged');ok(api.state().viewNotice.includes('未保存此视角'),'candidate failure is explained');
  });
  await run('restore rejection rolls back only the just-imported write',async()=>{
    for(const previous of [null,[record('old')]]){configure({callback:(_o,_i,dry)=>dry});store.clear();if(previous)put(previous);const before=raw();await api.importView(await signed(record()));eq(raw(),before,'exact prior storage bytes restored');eq(calls.map(c=>c.dry),[true,false],'restore rejection observed');eq(api.state().note,state.note,'view not adopted');ok(api.state().viewNotice.includes('未回读'),'no false success');}
  });
  await run('rollback never overwrites a concurrent storage update',async()=>{
    const concurrent=JSON.stringify({version:1,views:[record('other-tab')]});configure({callback:(_o,_i,dry)=>{if(dry)return true;store.set(KEY,concurrent);return false;}});put([record('old')]);await api.importView(await signed(record()));eq(raw(),concurrent,'concurrent bytes remain');ok(api.state().viewNotice.includes('未回读'),'restore failure disclosed');
  });
  await run('real SHA-256 validation rejects tampering before adapter or storage',async()=>{
    configure();put([record('existing')]);const before=raw(),file=await signed(record()),tampered=(await file.text()).replace('中文 / 日本語 / UTF-8','tampered note');await api.importView({size:Buffer.byteLength(tampered),text:async()=>tampered});eq(raw(),before,'tampering leaves storage');eq(calls,[],'no adapter for bad digest');eq(operations.length,0,'no write');ok(api.state().viewNotice.includes('未回读'),'not reopened');
  });
  await run('three locales explain capacity, conflict and unavailable comparison',async()=>{
    const markers={zh:['容量','同编号','候选'],en:['storage','view ID','candidate'],ja:['容量','表示ID','候補']};
    for(const locale of ['zh','en','ja']){configure({locale});['MAP_VIEWS_TOO_LARGE','VIEW_ID_CONFLICT','VIEW_COMPARISON_UNAVAILABLE'].forEach((code,index)=>{const message=api.bookmarkError(new Error(code));ok(message.includes(markers[locale][index]),locale+' business message '+code);ok(!message.includes(code),'no internal code as business explanation');});}
  });
  await run('adapter preflight is pure and rejects invalid candidates, references and identities',async()=>{
    configure();const source=fs.readFileSync(path.join(root,'design-workspace-adapter-v19.js'),'utf8'),start=source.indexOf('    function restoreMapComparison('),end=source.indexOf('    function locale()',start),study={studyId:identity.studyId,inputHash:identity.studyHash,periods:['2028-01'],nodes:[{nodeId:'A'},{nodeId:'B'}]},snapshot={studyHash:identity.studyHash,snapshotHash:identity.snapshotHash,rows:[{scenarioId:'PLAN-A'},{scenarioId:'PLAN-B'}],decision:{rankedScenarioIds:['PLAN-A','PLAN-B']}},current={study,snapshot,staleResult:false};
    let renders=0;const context={supplyController:{viewState:()=>current},studyContext:{snapshot:()=>({current:{studyId:identity.studyId}})},state:{route:identity.route},supplyComparison:{snapshotHash:'UNINITIALIZED',scenarioId:'OLD',period:'ALL'},render:()=>renders++,locale:()=> 'zh',root:{STCTPlatformV19:{supplyMap:{projectComparison:()=>({provenance:{selectedScenarioId:'PLAN-B',mode:'BOTH',leg:'BOTH',period:'ALL',changeFilter:'ALL',nodeId:''}})}}}};
    vm.runInNewContext(source.slice(start,end)+'\n globalThis.restore=restoreMapComparison;',context,{filename:'design-workspace-adapter-v19.js (preflight unit seam)'});
    const before=JSON.stringify({current,comparison:context.supplyComparison,state:context.state});ok(context.restore(comparison,identity,true),'valid preflight accepted');eq(renders,0,'preflight no render');eq(JSON.stringify({current,comparison:context.supplyComparison,state:context.state}),before,'preflight no comparison initialization');
    for(const patch of [{scenarioId:'MISSING'},{referenceScenarioId:'MISSING'},{period:'2099-01'},{nodeId:'MISSING'},{mode:'UNKNOWN'},{leg:'UNKNOWN'},{change:'UNKNOWN'}])eq(context.restore({...comparison,...patch},identity,true),false,'invalid options rejected');
    for(const patch of [{studyId:'OTHER'},{studyHash:'OLD'},{snapshotHash:'OLD'},{route:'/design/overview'}])eq(context.restore(comparison,{...identity,...patch},true),false,'invalid identity rejected');
    eq(renders,0,'all invalid preflights no render');eq(JSON.stringify({current,comparison:context.supplyComparison,state:context.state}),before,'invalid preflights do not mutate');ok(context.restore(comparison,identity),'actual restore accepted');eq(renders,1,'actual restore renders once');eq(context.supplyComparison.scenarioId,'PLAN-B','actual restore changes candidate');
  });
  const result={status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',tier:'SYNTHETIC_VM_WITH_REAL_WEBCRYPTO',assertions,sourceHashes:['platform-map-runtime-v19.js','design-workspace-adapter-v19.js','platform-supply-map-v8.js'].map(p=>({path:p,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')})),results};
  console.log(JSON.stringify(result,null,2));if(result.status==='FAIL')process.exitCode=1;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
