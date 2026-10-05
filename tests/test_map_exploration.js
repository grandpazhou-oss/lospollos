#!/usr/bin/env node
'use strict';
// Synthetic projection and asynchronous MapLibre adapter tests, not a solver run.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Supply=require('../platform-supply-map-v8.js');
const study={studyId:'SYNTHETIC-EXPLORATION',inputHash:'input',unit:'t',periods:['2027-01','2027-02'],nodes:[{nodeId:'S',role:'SUPPLIER',coordinate:[110,30]},{nodeId:'A',role:'DC',coordinate:[111,30]},...Array.from({length:305},(_,i)=>({nodeId:'C'+i,role:'CUSTOMER',coordinate:[112+i%10*.001,31]}))].map(n=>({...n,name:n.nodeId,coordinateSystem:'WGS84'}))};
const row=(from,to,q,p='2027-01')=>({fromNodeId:from,toNodeId:to,quantity:q,period:p,km:null,cost:null});
const snapshot={schemaVersion:'stct-supply-chain-v5-snapshot-v1',studyHash:'input',snapshotHash:'snapshot',analysisScope:'FULL_CHAIN',planningReference:{inbound:[row('S','A',100),row('S','A',300,'2027-02')],outbound:[row('A','C0',25),row('A','C0',75,'2027-02')]},rows:[{scenarioId:'B',selectedSiteIds:['A'],inbound:[row('S','A',100),row('S','A',300,'2027-02')],outbound:[row('A','C0',50),row('A','C0',150,'2027-02')]}],decision:{focusScenarioId:'B'}};
const frozen=JSON.stringify({study,snapshot}),full=Supply.projectComparison(study,snapshot);
assert.equal(full.flowScale.maximum,400);assert.deepEqual(full.relationContext.periods,study.periods);
for(const options of [{period:'2027-01'},{period:'2027-02'},{mode:'CANDIDATE',leg:'OUTBOUND',nodeId:'C0'},{mode:'REFERENCE',change:'UNCHANGED'}]){
 const projection=Supply.projectComparison(study,snapshot,options);assert.deepEqual(projection.flowScale,full.flowScale);
 for(const f of projection.features.filter(f=>f.geometry.type==='LineString'))assert.equal(f.properties.flowWidth,1.5+5.5*Math.sqrt(f.properties.quantity/400));
}
assert.equal(Supply.flowWidth(100,400),4.25);assert.equal(Supply.flowWidth(400,400),7);
for(const quantity of [NaN,Infinity,null,undefined,-1,0])assert.equal(Supply.flowWidth(quantity,400),1.5);
assert.ok(full.relations.every(r=>r.beforeMetrics.cost===null&&r.afterMetrics.cost===null));
assert.equal(Supply.projectComparison(study,{...snapshot,studyHash:'OLD'}).flowScale.maximum,0);
assert.equal(JSON.stringify({study,snapshot}),frozen);
const source=fs.readFileSync(require.resolve('../platform-map-runtime-v19.js'),'utf8');
const seam=`root.__test={setup(m,target){model=m;owner='SUPPLY';config={locale:'en',reducedMotion:true};views.clear();map=target;ready=true;host={hidden:false,querySelector:()=>({hidden:false})};},state:()=>view(),density,activeFeatures,populateClusters,expandCluster,cleanSource,setModel:m=>model=m,setSourceId:id=>sourceId=id};`;
const sandbox={structuredClone,performance,STCTPlatformV19:{supplyMap:Supply}};vm.runInNewContext(source.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox);
const api=sandbox.__test,sources=new Map(),layers=new Map(),filters=new Map(),jumps=[];
let resolveZoom;
const target={getSource:id=>sources.get(id),addSource(id,s){sources.set(id,{...s,setData(data){this.data=data;},getClusterExpansionZoom:()=>new Promise(r=>resolveZoom=r)});},addLayer:l=>layers.set(l.id,l),setFilter:(id,f)=>filters.set(id,f),getMaxZoom:()=>22,easeTo:o=>jumps.push(o),getStyle:()=>({layers:[...layers.values()]}),removeLayer:id=>layers.delete(id),removeSource:id=>sources.delete(id)};
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 api.setup(full,target);assert.equal(api.density().limited,false);assert.equal(api.density().shown,305);
 const draw=api.activeFeatures();assert.equal(draw.filter(f=>f.geometry.type==='Point').length,307);assert.equal(draw.filter(f=>f.geometry.type==='LineString').length,4);
 api.populateClusters(target,'p7-supply',draw);assert.equal(sources.get('p7-supply-clustered').data.features.length,305);assert.equal(sources.get('p7-supply-clustered').cluster,true);
 assert.ok(plain(filters.get('p7-supply-points')).flat(5).includes('demand'));
 const cluster={source:'p7-supply-clustered',properties:{cluster_id:1},geometry:{coordinates:[112,31]}};
 let pending=api.expandCluster(cluster,target);resolveZoom(9);await pending;assert.deepEqual(plain(jumps),[{center:[112,31],zoom:9,duration:0}]);
 pending=api.expandCluster(cluster,target);api.setModel({...full,provenance:{...full.provenance,studyId:'OTHER'}});resolveZoom(10);await pending;assert.equal(jumps.length,1,'late expansion must not move another study');
 api.setup(full,target);pending=api.expandCluster(cluster,target);api.populateClusters(target,'p7-supply',draw);resolveZoom(10);await pending;assert.equal(jumps.length,1,'late expansion after a source filter update is ignored');
 api.state().selectedEntityId='A';api.populateClusters(target,'p7-supply',api.activeFeatures());assert.equal(sources.get('p7-supply-clustered').data.features.length,0);assert.ok(!plain(filters.get('p7-supply-points')).flat(5).includes('demand'));
 api.state().selectedEntityId='';api.state().multiSelect=true;api.populateClusters(target,'p7-supply',draw);assert.equal(sources.get('p7-supply-clustered').data.features.length,0);
 api.state().lineWidthMode='uniform';assert.ok(api.activeFeatures().filter(f=>f.geometry.type==='LineString').every(f=>f.properties.displayWidth===null));
 api.setSourceId('p7-supply');sources.set('p7-supply',{});layers.set('base',{id:'base',source:'p7-supply'});api.cleanSource();assert.equal(sources.size,0);assert.equal(layers.size,0);
 assert.equal(JSON.stringify({study,snapshot}),frozen);console.log('PASS map exploration: stable quantitative domain, 305 objects without sampling, missing costs, unchanged snapshots, native-source configuration, async identity guard, reduced motion, focus/multiselect, uniform width and source cleanup. Node doubles; no browser/solver claim.');
})().catch(e=>{console.error(e);process.exitCode=1;});
