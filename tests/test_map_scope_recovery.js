'use strict';
// Display-only contracts against actual runtime functions; not a solver/browser test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../platform-map-runtime-v19.js'),'utf8');
const seam=`root.__scope={configure(m,state={},cb,locale='zh'){
 model=m;owner='SUPPLY';config={locale,route:'/design/supply-chain-study',onMapComparison:cb};views.clear();Object.assign(view(),state);map=null;peer=null;ready=false;
 const scope={hidden:true,innerHTML:''};host={querySelector:s=>s==='.p7-map-scope'?scope:{focus(){},remove(){},hidden:false},querySelectorAll:()=>[],classList:{remove(){}}};
 renderAnalysis=()=>{};list=()=>{};inspector=()=>{};updateSource=()=>{};renderMode=()=>{};fit=()=>{};
 },state:()=>view(),scopeItems,scopeEmpty,clearScope,renderScope,html:()=>host.querySelector('.p7-map-scope').innerHTML};`;
const sandbox={structuredClone};vm.runInNewContext(source.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox);const api=sandbox.__scope;
const model={provenance:{studyId:'SYNTHETIC',studyHash:'I',snapshotHash:'R',selectedScenarioId:'PLAN-B',mode:'CANDIDATE',leg:'OUTBOUND',period:'2027-02',changeFilter:'CHANGED',nodeId:'W'},entities:[{id:'W',label:'<Depot>',kind:'facility'}],layers:[{id:'facilities'},{id:'candidate-outbound'}],features:[{geometry:{type:'LineString',coordinates:[[10,10],[11,11]]},properties:{layer:'candidate-outbound',entityId:'W',fromNodeId:'W',toNodeId:'C',kind:'assignment'}}],relations:[{relationId:'R1',kind:'outbound'}]};
const original=JSON.stringify(model),state={activeLayerIds:['facilities'],relatedOnly:true,selectedEntityId:'W',analysisIds:[],searchQuery:'keep me',lineWidthMode:'uniform',split:true};
for(const locale of ['zh','en','ja']){
 api.configure(model,state,()=>true,locale);api.renderScope();assert.ok(api.html().includes('&lt;Depot&gt;'));assert.ok(!api.html().includes('<Depot>'));assert.equal(api.scopeEmpty().action,'layers');assert.equal(api.scopeItems().length,7);
}
let called=0;
for(const rejected of [()=>false,()=>{throw Error('stale');},()=>Promise.resolve(true),undefined]){
 api.configure(model,state,rejected);api.clearScope('ALL');assert.deepEqual(JSON.parse(JSON.stringify(api.state().activeLayerIds)),state.activeLayerIds);assert.equal(api.state().selectedEntityId,'W');assert.ok(api.state().scopeNotice);assert.equal(api.state().searchQuery,'keep me');
}
api.configure(model,state,(options,identity)=>{called++;assert.deepEqual(JSON.parse(JSON.stringify(options)),{scenarioId:'PLAN-B',mode:'BOTH',leg:'BOTH',period:'ALL',change:'ALL',nodeId:''});assert.deepEqual(JSON.parse(JSON.stringify(identity)),{studyId:'SYNTHETIC',studyHash:'I',snapshotHash:'R',route:'/design/supply-chain-study'});return true;});
api.clearScope('ALL');assert.equal(called,1);assert.equal(api.state().activeLayerIds,null);assert.equal(api.state().selectedEntityId,'');assert.equal(api.state().split,true);assert.equal(api.state().lineWidthMode,'uniform');assert.equal(api.state().searchQuery,'keep me');
api.configure(model,state,options=>{assert.equal(options.period,'ALL');assert.equal(options.leg,'OUTBOUND');assert.equal(options.mode,'CANDIDATE');assert.equal(options.scenarioId,'PLAN-B');assert.equal(options.nodeId,'W');return true;});api.clearScope('period');assert.equal(api.state().selectedEntityId,'W');assert.deepEqual(JSON.parse(JSON.stringify(api.state().activeLayerIds)),state.activeLayerIds);
api.configure(model,state,()=>{throw Error('local layer reset must not call adapter');});api.clearScope('layers');assert.equal(api.state().activeLayerIds,null);assert.equal(api.state().selectedEntityId,'W');assert.equal(api.scopeEmpty(),null);
api.configure({...model,features:[],relations:[{...model.relations[0],mapped:false}]},{});assert.equal(api.scopeEmpty().action,'objects');assert.match(api.scopeEmpty().message,/坐标/);
api.configure({...model,features:[],relations:[{...model.relations[0],mapped:true,change:'REMOVED'}]},{});assert.equal(api.scopeEmpty().action,'ALL');assert.ok(!api.scopeEmpty().message.includes('坐标'),'candidate-only removed relation is filtered, not missing coordinates');
api.configure({...model,features:[],relations:[]},{});assert.equal(api.scopeEmpty().action,'ALL');
api.configure({...model,features:[],provenance:{...model.provenance,snapshotHash:null}},{});assert.equal(api.scopeEmpty(),null);
api.configure(model,state,()=>{called++;return true;});api.clearScope('UNRECOGNIZED');assert.equal(called,1);assert.equal(api.state().selectedEntityId,'W');
assert.equal(JSON.stringify(model),original,'all display operations leave projection and result identity untouched');
console.log('PASS: three-language scope rendering/escaping, candidate-preserving reset, partial reset, stale/throw/async/no-adapter rejection, local layers, missing coordinates/no result, immutable projection. Node VM only.');
