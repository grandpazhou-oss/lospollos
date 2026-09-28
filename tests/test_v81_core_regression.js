'use strict';
const assert=require('node:assert/strict');
const Contract=require('../network-contract-v18.js');
const Context=require('../platform-study-context-v8.js');
const Kinds=require('../platform-study-kind-registry-v8.js');
const Routes=require('../design-route-mount-registry-v19.js');
const Supply=require('../supply-chain-controller-v19.js');
const Facility=require('../facility-location-mvp1-v19.js');
globalThis.STCTPlatformV19=globalThis.STCTPlatformV19||{};
require('../platform-map-runtime-v19.js');require('../platform-map-adapters-v19.js');require('../platform-task-views-v19.js');
globalThis.STCTPlatformV19.mapRuntime={...globalThis.STCTPlatformV19.mapRuntime,park(){},mount(){}};
const Adapter=require('../design-workspace-adapter-v19.js');
const routes=Routes.createRegistry().list().map(row=>row.logicalPath);
assert.deepEqual(routes,Kinds.DESIGN_ROUTES);
for(const kind of [null,...Context.STUDY_KINDS])for(const route of routes){const access=Kinds.routeCapability(kind,route);assert.ok(['APPLICABLE_WRITABLE','APPLICABLE_READ_ONLY','NEEDS_INPUT','NOT_APPLICABLE','NOT_IMPLEMENTED'].includes(access.status));}
assert.equal(Kinds.routeCapability('SUPPLY_CHAIN_PERIOD','/design/facility-location').reason,'USE_SUPPLY_NETWORK_ANALYSIS');
assert.equal(Kinds.routeCapability('SUPPLY_CHAIN_PERIOD','/design/operational-validation').reason,'PERIOD_DEMAND_IS_NOT_DISPATCH_ORDERS');

const raw={studyId:'ATOMIC-PARENT',name:'Atomic parent',classification:'SYNTHETIC_TEST',nodes:[{nodeId:'F',role:'FACTORY',coordinate:[120,30]},{nodeId:'W',role:'DC',coordinate:[120,30]},{nodeId:'C',role:'CUSTOMER',coordinate:[120.1,30]}],periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'W',period:'P1',quantity:10,unit:'m3'}],observedInbound:[{flowId:'I',fromNodeId:'F',toNodeId:'W',period:'P1',quantity:10,unit:'m3'}]};
const rows=new Map();let rejectDerived=true;
const repository={record:(id,payload,refs=[])=>({id,payload:structuredClone(payload),refs,contentHash:Contract.hashArtifact(payload)}),async read(store,id){return id===undefined?[...rows].filter(([key])=>key.startsWith(store+':')).map(([,value])=>structuredClone(value)):structuredClone(rows.get(store+':'+id)||null);},async list(store){return this.read(store);},async commit({records={},pointer,expectedRevision=0}){if(rejectDerived&&pointer.id.includes('-GROWTH-'))throw Object.assign(new Error('injected commit failure'),{code:'TEST_COMMIT_FAILED'});const old=rows.get('pointers:'+pointer.id);assert.equal(old?.revision||0,expectedRevision);for(const[store,entries]of Object.entries(records))for(const entry of entries)rows.set(store+':'+entry.id,structuredClone(entry));const saved={...pointer,revision:expectedRevision+1,savedAt:new Date().toISOString()};rows.set('pointers:'+pointer.id,structuredClone(saved));return{status:'SAVED',pointer:saved};}};
const supply=Supply.createController({repository});supply.loadStudy(raw);supply.configureScenario({scenarioId:'FULL',type:'NETWORK_CANDIDATE',analysisScope:'FULL_CHAIN',objective:'VOLUME_KM',objectiveScope:'TWO_END',distanceBasis:'GEOGRAPHIC_SCREENING',facilityCounts:[1],selectedSiteIds:['W'],sourceMode:'FREE',supplierTotalMode:'ADJUSTABLE',capacityPolicy:'UNBOUNDED_SCREENING',homogeneousDemandConfirmed:true,allowAllSupplierSiteEdgesConfirmed:true});
const context=Context.createContext();context.select({studyKind:'SUPPLY_CHAIN_PERIOD',studyId:supply.snapshot().study.studyId,inputHash:supply.snapshot().study.inputHash});
const adapter=Adapter.createAdapter({document:{activeElement:null},downloader(){}});adapter.setStudyContext(context);adapter.setSupplyController(supply);
const listeners={},target={innerHTML:'',classList:{add(){},remove(){}},querySelector(){return null;},querySelectorAll(){return[];},contains(){return false;}};
adapter.mount({logicalPath:'/design/demand-growth',routeParams:{},scope:{listen(node,type,listener){if(node===target)listeners[type]=listener;},register(){}}},{target,snapshot:{locale:'zh'},controller:{navigate(){}}});
async function growth(){await listeners.click({target:{closest:selector=>selector==='[data-design-action]'?{dataset:{designAction:'supply-demand-10'},disabled:false}:null}});}

(async()=>{
  const parent=supply.snapshot().study,scenario=supply.snapshot().scenario;
  await growth();
  assert.equal(supply.snapshot().study.inputHash,parent.inputHash,'Failed derived save must restore parent controller');
  assert.equal(context.snapshot().current.inputHash,parent.inputHash,'Failed derived save must retain parent selection');
  assert.deepEqual(supply.snapshot().scenario,scenario);
  assert.equal((await repository.list('pointers')).filter(row=>row.id.includes('-GROWTH-')).length,0,'Failed commit leaves no derived catalog row');
  rejectDerived=false;await growth();
  assert.equal(context.snapshot().current.studyId,supply.snapshot().study.studyId);
  assert.equal(supply.snapshot().scenario.analysisScope,'FULL_CHAIN');
  assert.equal(supply.snapshot().study.periodDemand[0].quantity,11);
  assert.equal((await repository.read('pointers','SUPPLY:'+parent.studyId)).inputHash,parent.inputHash);
  const firstGrowth=supply.snapshot().study;
  await new Promise(resolve=>setTimeout(resolve,2));
  await supply.reopen('SUPPLY:'+parent.studyId);context.select({studyKind:'SUPPLY_CHAIN_PERIOD',studyId:parent.studyId,inputHash:parent.inputHash});await growth();
  const secondGrowth=supply.snapshot().study;
  assert.notEqual(secondGrowth.studyId,firstGrowth.studyId);
  assert.equal(secondGrowth.periodDemand[0].quantity,11,'Repeated derivation from C must not compound growth');
  assert.equal(secondGrowth.assumptions.demandGrowth.parentStudyId,parent.studyId);
  await new Promise(resolve=>setTimeout(resolve,2));await growth();
  const thirdGrowth=supply.snapshot().study;
  assert.equal(thirdGrowth.periodDemand[0].quantity,12.1,'Derivation from C2 is an explicit second generation');
  assert.equal(thirdGrowth.assumptions.demandGrowth.parentStudyId,secondGrowth.studyId);

  const firstTab=Supply.createController({repository}),secondTab=Supply.createController({repository});
  await Promise.all([firstTab.reopen('SUPPLY:'+parent.studyId),secondTab.reopen('SUPPLY:'+parent.studyId)]);
  firstTab.updateStudy({name:'First tab edit'});secondTab.updateStudy({name:'Second tab unsaved edit'});
  await firstTab.save();await assert.rejects(()=>secondTab.save(),{code:'REVISION_CONFLICT'});
  assert.equal(secondTab.snapshot().study.name,'Second tab unsaved edit');
  assert.equal((await repository.read('pointers','SUPPLY:'+parent.studyId)).name,'First tab edit');
  const draft=secondTab.exportDraftPackage(),recovered=Supply.createController({repository});
  recovered.importPackage(draft);assert.equal(recovered.snapshot().study.name,'Second tab unsaved edit');

  let resolveFetch;const late=Facility.createController({fetch:()=>new Promise(resolve=>{resolveFetch=resolve;})});
  const makeStudy=id=>({studyId:id,name:id,coordinateSystem:'WGS84',dataClassification:'SYNTHETIC',demands:[{demandId:'D',coordinate:[120,30],demand:{quantity:1,weight:0,volume:0}}],sites:[{siteId:'S',coordinate:[120,30],capacity:{quantity:2,weight:0,volume:0},fixedCost:0}],options:{facilityCounts:[1],costPeriod:'P1',currency:'CNY',transportCostPerUnitKm:0}});
  late.load(makeStudy('A'));const pending=late.run();late.load(makeStudy('B'));resolveFetch({ok:true,json:async()=>({})});assert.equal((await pending).status,'SUPERSEDED');assert.equal(late.snapshot().study.studyId,'B');assert.equal(late.snapshot().status,'READY');
  console.log(JSON.stringify({status:'PASS',method:'SYNTHETIC_MODULE_FAULT_INJECTION',routeKindCases:routes.length*(Context.STUDY_KINDS.length+1),growthRollback:true,repeatedGrowthLineage:true,twoTabStaleSaveRejected:true,unsavedDraftExportRecovered:true,lateFacilityResultIgnored:true}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
