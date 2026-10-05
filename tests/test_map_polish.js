'use strict';
// Synthetic Node VM vectors: presentation, hit target geometry and local list scroll.
// Browser business-control checks are recorded separately; no solver claim here.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../platform-map-runtime-v19.js'),'utf8');
const seam=`root.__polish={setup(m,locale='zh',h=null){model=m;config={locale};owner='SUPPLY';views.clear();host=h;map=null;ready=true;},state:()=>view(),setMap:m=>map=m,hitFeatures,nodeOverview,relationDetail,supplyToolbar,closeToolGroups,syncObjectList,list,inspector};`;
const sandbox={STCTPlatformV19:{businessNumber:{number:(n,locale,digits=1)=>Number.isFinite(n)?n.toLocaleString(locale,{maximumFractionDigits:digits}):'—',exact:n=>String(n)}}};
vm.runInNewContext(source.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox);
const api=sandbox.__polish;
const metrics=(q,cost=null)=>({quantity:q,weightedKm:q?10:null,distanceCoverage:1,volumeKm:q?10*q:null,cost,recordCount:1,sources:['<source>'],demandIds:['C']});
const relation={relationId:'R',fromNodeId:'A',toNodeId:'C',fromName:'<Warehouse>',toName:'Destination',kind:'outbound',before:12.25,after:24.5,unit:'t',currency:'USD',change:'VOLUME_CHANGED',mapped:true,beforeMetrics:metrics(12.25),afterMetrics:metrics(24.5),serviceBefore:[],serviceAfter:[],periodRows:[{period:'2027-01',before:metrics(12.25),after:metrics(24.5)}]};
const entity={id:'A',kind:'facility',label:'<Warehouse>',relationIds:['R']},other={id:'C',kind:'customer',label:'Destination'};
const model={entities:[entity,other],relations:[relation],features:[{properties:{relationId:'R'}}],layers:[{id:'x',label:'<layer>'}],relationContext:{scenarioName:'<Plan>',periodLabel:'January',unit:'t',mode:'BOTH',distanceLabel:'GEOGRAPHIC'},provenance:{}};
const original=JSON.stringify(model);
for(const locale of ['zh','en','ja']){
 api.setup(model,locale);const html=api.nodeOverview(entity);assert.ok(html.includes('&lt;Plan&gt;'));assert.ok(html.includes('12.3'));assert.ok(html.includes('24.5'));
 for(const section of ['overview','periods','source']){api.state().detailSection=section;const detail=api.relationDetail(relation,entity);for(const key of ['overview','periods','source'])assert.ok(detail.includes(`data-p7-detail-pane="${key}"${section===key?'':' hidden'}`));assert.ok(detail.includes('&lt;Warehouse&gt;'));assert.ok(detail.includes('&lt;source&gt;'));assert.ok(detail.includes('—'),'unknown cost not converted to zero');}
 const toolbar=api.supplyToolbar();assert.equal((toolbar.match(/data-p7-toolgroup=/g)||[]).length,3);assert.ok(toolbar.includes('&lt;layer&gt;'));assert.ok(toolbar.includes('data-p7-swipe'));assert.ok(toolbar.includes('data-p7-bookmarks'));
}
assert.equal(JSON.stringify(model),original,'rendering never changes snapshot/model data');
const projected=[],target={getStyle:()=>({layers:[{id:'p7-test'},{id:'basemap'},{id:'p7-neutral'}]}),queryRenderedFeatures:(box,options)=>{projected.push({box,options});return []}};
api.setup(model);api.setMap(target);api.hitFeatures({x:20,y:30},target,12);assert.deepEqual(JSON.parse(JSON.stringify(projected[0])),{box:[[8,18],[32,42]],options:{layers:['p7-test']}});
let focused=0;const groups=[0,1].map(()=>({open:true,querySelector:()=>({focus(){focused++;}})}));
api.setup(model,'en',{querySelectorAll:()=>groups.filter(g=>g.open)});assert.equal(api.closeToolGroups(true),true);assert.equal(focused,1);assert.equal(api.closeToolGroups(true),false);
const nodes=new Map();let selectedBox={top:190,bottom:220};const row={dataset:{p7Entity:'A'},getBoundingClientRect:()=>selectedBox},list={scrollTop:0,getBoundingClientRect:()=>({top:100,bottom:200})};const toggle={setAttribute(k,v){this[k]=v;}};const details={open:true,querySelectorAll:()=>[row]};
nodes.set('.p7-entity-details',details);nodes.set('[data-p7-objects]',toggle);nodes.set('.p7-map-list',list);nodes.set('.p7-search-count',{});nodes.set('[data-p7-search-clear]',{});nodes.set('.p7-entity-details summary',{});
api.setup(model,'en',{querySelector:s=>nodes.get(s)});api.state().selectedEntityId='A';api.syncObjectList();assert.equal(list.scrollTop,20);selectedBox={top:90,bottom:120};api.syncObjectList();assert.equal(list.scrollTop,10);assert.equal(toggle['aria-expanded'],true);
api.state().entityKind='customer';api.list('Destination');assert.ok(list.innerHTML.includes('Selected object · outside list filters'));assert.ok(list.innerHTML.includes('aria-current="true"'));assert.equal((list.innerHTML.match(/data-p7-entity="A"/g)||[]).length,1);assert.equal(nodes.get('.p7-search-count').textContent,'1 matching objects');assert.equal(api.state().entityKind,'customer','selection does not silently clear list filters');
const aside={innerHTML:'',classList:{toggle(){},remove(){}}};
api.setup(model,'en',{querySelector:()=>aside});Object.assign(api.state(),{selectedEntityId:'A',selectedRelationId:'OLD_SCOPE_RELATION',relationTab:'inbound'});api.inspector();assert.equal(api.state().selectedRelationId,'');assert.ok(aside.innerHTML.includes('data-p7-inspector-tab="overview"'),'switching scopes cannot leave node tabs hidden by a stale relation');
assert.equal(JSON.stringify(model),original);
console.log('PASS map polish: three languages, progressive detail panes, escaping, unknown costs, immutable model, enlarged hit targets, menu Escape, list-only scroll, selected object outside filters. Node VM only.');
