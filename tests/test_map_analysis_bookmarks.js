#!/usr/bin/env node
'use strict';
// Unit-only closure seams: evaluates the actual source in a Node VM with storage,
// camera and rendering doubles. This is not browser interaction evidence.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const clone=value=>structuredClone(value);
const plain=value=>JSON.parse(JSON.stringify(value));
const KEY='stct.map-analysis-views.v1';
let assertions=0;
function eq(actual,expected,label){assert.deepEqual(plain(actual),plain(expected),label);assertions++;}
function yes(value,label){assert.equal(value,true,label);assertions++;}
function no(value,label){assert.equal(value,false,label);assertions++;}
function throws(fn,label){assert.throws(fn,undefined,label);assertions++;}

const identity={studyId:'SYNTHETIC-VIEW',studyHash:'INPUT-1',snapshotHash:'SNAP-1',route:'/design/supply-chain-study'};
const comparison={scenarioId:'PLAN-B',mode:'BOTH',leg:'BOTH',period:'2027-11',change:'ALL',nodeId:'NODE-B'};
const savedState={analysisIds:['NODE-A','NODE-B'],analysisDirection:'BETWEEN',activeLayerIds:['facilities'],center:[116.5,39.2],zoom:7.25,bearing:20,pitch:15,split:true,selectedEntityId:'NODE-B',relatedOnly:true,analysisOpen:true};
const bookmark=()=>({id:'view-1',name:'<script>view</script>',identity:clone(identity),comparison:clone(comparison),state:clone(savedState),label:'Plan B · November'});
const model={owner:'SUPPLY',provenance:{...identity,selectedScenarioId:'PLAN-B',mode:'BOTH',leg:'BOTH',period:'2027-11',changeFilter:'ALL',nodeId:'NODE-B'},entities:[{id:'NODE-A'},{id:'NODE-B'}],layers:[{id:'facilities'},{id:'demands'}],relationContext:{scenarioName:'Plan B',periodLabel:'November'}};
const runtimeSource=fs.readFileSync(path.join(root,'platform-map-runtime-v19.js'),'utf8');
const seam=`
  root.__bookmarkUnit={
    configure(nextModel,nextConfig,state,nextMap=null,isReady=false){
      model=nextModel;config=nextConfig;owner='SUPPLY';views.clear();Object.assign(view(),state);map=nextMap;ready=isReady;styleCamera=null;
      const nodes=new Map();host={classList:{remove(){}},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',setAttribute(){},focus(){},remove(){}});return nodes.get(selector);},querySelectorAll(){return [];}};
      renderAnalysis=()=>{};list=()=>{};inspector=()=>{};updateSource=()=>{};renderMode=()=>{};resizeMaps=()=>{};syncCamera=()=>{};
    },readBookmarks,validBookmark,saveBookmark,restoreBookmark,renderBookmarks,
    state:()=>view(),camera:()=>styleCamera,html:()=>host.querySelector('.p7-map-bookmarks').innerHTML
  };
`;
assert.ok(runtimeSource.endsWith('})(globalThis);\n'));
const store=new Map();let rejectWrite=false,uuid=0;
const sandbox={structuredClone,crypto:{randomUUID:()=>`view-${++uuid}`},localStorage:{getItem:key=>store.get(key)??null,setItem(key,value){if(rejectWrite)throw new Error('QuotaExceededError');store.set(key,value);}}};
vm.runInNewContext(runtimeSource.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox,{filename:'platform-map-runtime-v19.js (unit seam)'});
const api=sandbox.__bookmarkUnit;
function configure(opts={}){api.configure(clone(opts.model||model),{locale:'zh',route:identity.route,onMapComparison:opts.callback||(()=>true)},clone(opts.state||{...savedState,bookmarkName:'Working view',bookmarksOpen:true}),opts.map||null,Boolean(opts.ready));}
function put(rows=[bookmark()]){store.set(KEY,JSON.stringify({version:1,views:rows}));}
configure();eq(api.readBookmarks(),[],'missing storage is an empty list');put();yes(api.validBookmark(api.readBookmarks()[0]),'valid view');
for(const key of ['studyId','studyHash','snapshotHash','route']){const row=bookmark();row.identity[key]+='-different';no(api.validBookmark(row),`reject changed ${key}`);}
for(const patch of [{presentation:'invented'},{presentation:true},{analysisIds:['MISSING']},{analysisDirection:'UNKNOWN'},{activeLayerIds:['missing-layer']},{center:[181,39]},{center:[116,91]},{center:[116]},{center:['116',39]},{zoom:25},{pitch:90},{bearing:null},{selectedEntityId:'MISSING'},{analysisOpen:'true'},{split:null},{clusterEnabled:'false'},{lineWidthMode:'UNKNOWN'},{comparisonLayout:'unknown'},{swipePosition:101},{swipePosition:'50'}]){const row=bookmark();Object.assign(row.state,patch);no(api.validBookmark(row),`invalid state ${JSON.stringify(patch)}`);}
for(const patch of [{linkedScope:'BAD'},{linkedKind:'BAD'},{linkedRanges:{distance:{min:-1,max:1,unknown:false}}},{linkedRanges:{quantity:{min:1,max:0,unknown:false}}},{note:'x'.repeat(2001)},{gridSize:3},{qualityFilter:'MAGIC_ROAD'},{regionGeometry:{type:'LineString',coordinates:[]}}]){const row=bookmark();Object.assign(row.state,patch);no(api.validBookmark(row),'reject invalid extended analysis state');}
for(const bad of ['not json','null',JSON.stringify({version:2,views:[]}),JSON.stringify({version:1,views:[null]}),JSON.stringify({version:1,views:Array.from({length:51},bookmark)}),' '.repeat(2000001)]){store.set(KEY,bad);throws(()=>api.readBookmarks(),'reject malformed or excessive storage');}
put([bookmark(),bookmark()]);throws(()=>api.readBookmarks(),'duplicate IDs cannot ambiguously restore or remove views');
put();api.renderBookmarks();assert.ok(api.html().includes('&lt;script&gt;view&lt;/script&gt;'),'saved name is escaped');assert.ok(!api.html().includes('<script>view</script>'));assertions+=2;

store.clear();configure();const beforeModel=JSON.stringify(model);api.saveBookmark();eq(api.readBookmarks().length,1,'save one view');const saved=api.readBookmarks()[0];eq(saved.identity,identity,'save exact identity');eq(saved.comparison,comparison,'save selected snapshot candidate and node filter');eq(saved.state,{...savedState,presentation:'relations',comparisonLayout:'split',swipePosition:50,clusterEnabled:true,lineWidthMode:'quantity',linkedOpen:false,linkedScope:'NETWORK',linkedKind:'ALL',linkedRanges:{},regionGeometry:null,regionRule:'EITHER',gridSize:1,gridDisplay:'off',qualityFilter:'ALL',note:''},'save view state and display preferences only');yes(api.validBookmark(saved),'own saved view passes guard');eq(JSON.stringify(model),beforeModel,'no mutation of projection');assert.ok(api.state().bookmarkNotice.includes('已保存'));assertions++;
const beforeQuota=store.get(KEY);configure();rejectWrite=true;api.saveBookmark();rejectWrite=false;eq(store.get(KEY),beforeQuota,'quota failure leaves old storage');eq(api.state().bookmarkName,'Working view','quota failure retains name');assert.ok(api.state().bookmarkNotice.includes('未保存'));assertions++;
store.set(KEY,'broken JSON');configure();api.saveBookmark();eq(store.get(KEY),'broken JSON','malformed storage is not overwritten');
store.clear();configure({state:{...savedState,center:[541,39.2],bookmarkName:'Wrapped world',bookmarksOpen:true}});api.saveBookmark();const wrapped=api.readBookmarks()[0];eq(wrapped.state.center,[-179,39.2],'world-copy longitude is normalized for equivalent saved camera');yes(api.validBookmark(wrapped),'world-copy saved view can restore');
store.clear();const noResult=clone(model);noResult.provenance.snapshotHash=null;configure({model:noResult});api.saveBookmark();eq(store.size,0,'no result cannot create bookmark');
put(Array.from({length:10},(_,i)=>({...bookmark(),id:`view-${i}`})));configure();api.saveBookmark();eq(api.readBookmarks().length,10,'per-study limit is enforced');

put();let calls=0,jumps=[];configure({callback:(options,expected)=>{calls++;eq(options,comparison,'callback receives comparison');eq(expected,identity,'callback receives identity');return true;},map:{jumpTo:camera=>jumps.push(camera),getCanvas:()=>({style:{}})},ready:true,state:{analysisIds:[],analysisDirection:'ANY',bookmarksOpen:true}});const beforeRestore=store.get(KEY);api.restoreBookmark('view-1');eq(calls,1,'restore callback called once');eq(jumps,[{center:savedState.center,zoom:savedState.zoom,bearing:savedState.bearing,pitch:savedState.pitch}],'restore camera after callback');eq(api.state().analysisIds,savedState.analysisIds,'restore multi-selection');eq(api.state().activeLayerIds,savedState.activeLayerIds,'restore layers');eq(api.state().analysisDirection,'BETWEEN','restore direction');eq(store.get(KEY),beforeRestore,'restore does not rewrite storage');
eq(api.state().presentation,'relations','old bookmark without presentation keeps its original comparison rendering');
eq(api.state().clusterEnabled,true,'old bookmark defaults to clustering');eq(api.state().lineWidthMode,'quantity','old bookmark defaults to volume widths');
const custom=bookmark();custom.state.clusterEnabled=false;custom.state.lineWidthMode='uniform';put([custom]);configure();api.restoreBookmark('view-1');eq(api.state().clusterEnabled,false,'restores disabled clustering');eq(api.state().lineWidthMode,'uniform','restores uniform widths');put();
configure({ready:false});api.restoreBookmark('view-1');eq(api.camera().center,savedState.center,'defer camera until style ready');eq(api.camera().owner,'SUPPLY','deferred camera owner is bound');
configure({callback:()=>false,state:{analysisIds:['NODE-A'],analysisDirection:'ANY',bookmarksOpen:true}});api.restoreBookmark('view-1');eq(api.state().analysisIds,['NODE-A'],'callback rejection does not alter selected objects');assert.ok(api.state().bookmarkNotice.includes('不能直接恢复'));assertions++;
const stale=bookmark();stale.identity.snapshotHash='OLD';put([stale]);calls=0;configure({callback:()=>{calls++;return true;}});api.restoreBookmark('view-1');eq(calls,0,'stale bookmark rejected before adapter callback');

// Coverage is a local display preference; a round trip cannot alter the result identity.
for(const mode of ['coverage','relations']){
  store.clear();configure({state:{...savedState,split:false,analysisOpen:false,presentation:mode,bookmarkName:'Display '+mode}});api.saveBookmark();const row=api.readBookmarks()[0];
  eq(row.state.presentation,mode,'save explicit presentation');yes(api.validBookmark(row),'new display preference validates');
  configure({state:{presentation:mode==='coverage'?'relations':'coverage',analysisIds:[],bookmarksOpen:true}});yes(api.restoreBookmark(row.id),'saved display restores successfully');
  eq(api.state().presentation,mode,'restore explicit presentation');eq(api.state().split,false,'coverage restore does not enable split');eq(row.identity,identity,'display preference never changes snapshot identity');
}
store.clear();configure({state:{...savedState,presentation:'coverage',bookmarksOpen:true}});const invalidDisplay=bookmark();invalidDisplay.state.presentation='wrong';put([invalidDisplay]);no(api.restoreBookmark(invalidDisplay.id),'reject unknown presentation before altering view');eq(api.state().presentation,'coverage','invalid saved preference leaves current presentation unchanged');

// Adapter test seam uses the real function bodies, with current study/controller
// and render counters supplied as module-level doubles; no UI/app injection.
const adapterSource=fs.readFileSync(path.join(root,'design-workspace-adapter-v19.js'),'utf8');
const start=adapterSource.indexOf('    function restoreMapComparison('),end=adapterSource.indexOf('    function locale()',start);
assert.ok(start>=0&&end>start,'adapter seam boundaries exist');
const study={studyId:identity.studyId,inputHash:identity.studyHash,periods:['2027-10','2027-11'],nodes:[{nodeId:'NODE-A'},{nodeId:'NODE-B'}]};
let current={study,snapshot:{studyHash:identity.studyHash,snapshotHash:identity.snapshotHash,rows:[{scenarioId:'PLAN-A'},{scenarioId:'PLAN-B'}]},staleResult:false};
let selectedStudy=identity.studyId,renders=0;
const adapterSandbox={supplyController:{viewState:()=>current},studyContext:{snapshot:()=>({current:{studyId:selectedStudy}})},state:{route:identity.route},supplyComparison:{snapshotHash:null},render:()=>{renders++;},locale:()=> 'zh',root:{STCTPlatformV19:{supplyMap:{projectComparison:()=>({provenance:{selectedScenarioId:'PLAN-B',mode:'BOTH',leg:'BOTH',period:'ALL',changeFilter:'ALL',nodeId:''}})}}}};
vm.runInNewContext(adapterSource.slice(start,end)+'\n globalThis.restore=restoreMapComparison;',adapterSandbox,{filename:'design-workspace-adapter-v19.js (unit seam)'});
const restore=adapterSandbox.restore;
yes(restore(comparison,identity),'adapter accepts actual nodeId field');eq(renders,1,'adapter renders once');eq(adapterSandbox.supplyComparison.scenarioId,'PLAN-B','adapter retains selected candidate');
for(const patch of [{scenarioId:'MISSING'},{period:'2029-01'},{nodeId:'MISSING'},{mode:'UNKNOWN'},{leg:'UNKNOWN'},{change:'UNKNOWN'}]){no(restore({...comparison,...patch},identity),`adapter rejects ${JSON.stringify(patch)}`);}
for(const patch of [{studyId:'OTHER'},{studyHash:'OLD'},{snapshotHash:'OLD'},{route:'/design/overview'}])no(restore(comparison,{...identity,...patch}),'adapter rejects stale identity');
current.staleResult=true;no(restore(comparison,identity),'adapter rejects stale result');current.staleResult=false;
selectedStudy='OTHER';no(restore(comparison,identity),'adapter rejects switched public study');selectedStudy=identity.studyId;
current.snapshot.studyHash='OTHER';no(restore(comparison,identity),'adapter rejects snapshot belonging to another input');current.snapshot.studyHash=identity.studyHash;
adapterSandbox.state.route='/design/overview';const overviewIdentity={...identity,route:'/design/overview'},overview={...comparison,period:'ALL',nodeId:''};const beforeOverview=renders;yes(restore(overview,overviewIdentity),'overview accepts only its displayed comparison');eq(renders,beforeOverview,'overview does not mutate/re-render analysis comparison');no(restore({...overview,scenarioId:'PLAN-A'},overviewIdentity),'overview rejects non-displayed candidate');no(restore({...overview,period:'2027-11'},overviewIdentity),'overview rejects non-displayed period');
console.log(`PASS map analysis bookmark unit checks (${assertions} assertions; Node VM doubles, not browser evidence)`);
