'use strict';
const assert=require('node:assert/strict'),Map=require('../platform-supply-map-v8.js');
const node=(id,role,coordinate=[110,30],name=id)=>({nodeId:id,name,role,coordinateSystem:'WGS84',coordinate});
const leg=(fromNodeId,toNodeId,quantity,period,distanceKm,cost,demandId)=>({fromNodeId,toNodeId,quantity,period,distanceKm,cost,demandId,source:'LEDGER',distanceQuality:'VERIFIED_ROAD'});
const study={studyId:'SYNTHETIC',inputHash:'H',unit:'t',currency:'CNY',periods:['P1','P2'],nodes:[node('S','SUPPLIER'),node('W','DC'),node('E','DC'),node('C','CUSTOMER',null,'同名'),node('D','CUSTOMER',[112,31],'同名')]};
const old=[leg('W','C',2,'P1',10,0,'C-1'),leg('W','C',3,'P1',10,6,'C-2'),leg('W','C',5,'P2',null,null,'C-1'),leg('W','D',1,'P1',30,9,'D-1')];
const snap={schemaVersion:'stct-supply-chain-v5-snapshot-v1',studyHash:'H',snapshotHash:'FROZEN',analysisScope:'FULL_CHAIN',distanceBasis:'VERIFIED_ROAD',planningReference:{inbound:[leg('S','W',11,'P1',2,22)],outbound:old},rows:[{scenarioId:'X',inbound:[leg('S','W',11,'P1',2,22)],outbound:[leg('E','C',10,'P2',4,40,'C-1'),leg('W','D',1,'P1',30,9,'D-1')]}],decision:{focusScenarioId:'X'}};
const frozen=JSON.stringify({study,snap});
const model=Map.projectComparison(study,snap),c=model.relations.find(r=>r.fromNodeId==='W'&&r.toNodeId==='C');
assert.equal(c.before,10);assert.equal(c.after,0);assert.equal(c.beforeMetrics.recordCount,3);assert.deepEqual(c.beforeMetrics.demandIds,['C-1','C-2']);
assert.equal(c.beforeMetrics.cost,null);assert.equal(c.beforeMetrics.weightedKm,10);assert.equal(c.beforeMetrics.distanceCoverage,.5);assert.equal(c.beforeMetrics.volumeKm,null);assert.equal(c.mapped,false);
assert.equal(c.periodRows[0].before.cost,6);assert.equal(c.periodRows[0].before.quantity,5);assert.equal(c.periodRows[1].before.quantity,5);assert.equal(c.periodRows[1].before.weightedKm,null);
const fresh=model.relations.find(r=>r.fromNodeId==='E'&&r.toNodeId==='C');assert.equal(fresh.afterMetrics.cost,40);assert.equal(fresh.afterMetrics.volumeKm,40);assert.deepEqual(fresh.serviceBefore,[{id:'W',name:'W'}]);assert.deepEqual(fresh.serviceAfter,[{id:'E',name:'E'}]);
assert.ok(model.relations.every(r=>!r.relationId.includes('\0')));assert.equal(new Set(model.relations.map(r=>r.relationId)).size,model.relations.length);
for(const mode of ['BOTH','REFERENCE','CANDIDATE']){const filtered=Map.projectComparison(study,snap,{mode,change:'CHANGED'});const w=filtered.entities.find(e=>e.id==='W');assert.deepEqual(w.relationIds,[c.relationId]);assert.ok(filtered.features.filter(f=>f.geometry.type==='LineString').every(f=>mode==='BOTH'||f.properties.comparison===mode.toLowerCase()));}
const p1=Map.projectComparison(study,snap,{period:'P1'});assert.equal(p1.relations.find(r=>r.toNodeId==='C').before,5);assert.equal(p1.relations.find(r=>r.toNodeId==='C').beforeMetrics.cost,6);
assert.equal(Map.projectComparison(study,{...snap,studyHash:'OLD'}).relations.length,0);
for(const scope of ['OUTBOUND_ONLY','UPSTREAM_ONLY']){const m=Map.projectComparison(study,{...snap,analysisScope:scope,baseline:snap.planningReference});assert.ok(m.relations.every(r=>r.kind===(scope==='UPSTREAM_ONLY'?'inbound':'outbound')));}
const zero=Map.projectComparison(study,{...snap,planningReference:{outbound:[leg('W','D',1,'P1',0,0)]},rows:[{scenarioId:'X',outbound:[leg('W','D',1,'P1',0,0)]}]});assert.equal(zero.relations[0].beforeMetrics.cost,0);assert.equal(zero.relations[0].beforeMetrics.weightedKm,0);
assert.equal(JSON.stringify({study,snap}),frozen);
console.log(JSON.stringify({status:'PASS',kind:'Independent synthetic arithmetic and display projection',checks:['period totals','cost zero vs unknown','partial distance coverage','record IDs retained','same names not merged','map change-filter parity','three scopes','stale protection','immutable inputs']}));
// Warehouse identity, independent of node order, locale, filters or candidate selection.
const colored=Map.projectComparison(study,snap),lineColors=m=>Object.fromEntries(m.warehouseLegend.map(r=>[r.id,r.color]));
const colors=lineColors(colored);assert.equal(new Set(Object.values(colors)).size,Object.keys(colors).length);
for(const options of [{period:'P1'},{mode:'REFERENCE'},{mode:'CANDIDATE'},{change:'CHANGED'},{nodeId:'E'},{leg:'INBOUND'},{leg:'OUTBOUND'}])for(const f of Map.projectComparison(study,snap,options).features.filter(f=>f.geometry.type==='LineString')){assert.equal(f.properties.color,colors[f.properties.warehouseId]);assert.equal(f.properties.warehouseId,f.properties.layer.endsWith('inbound')?f.properties.toNodeId:f.properties.fromNodeId);}
const reversed=Map.projectComparison({...study,nodes:[...study.nodes].reverse()},snap,{},'ja');assert.deepEqual(lineColors(reversed),colors);
const alternate={...snap,rows:[...snap.rows,{scenarioId:'Y',inbound:snap.planningReference.inbound,outbound:snap.planningReference.outbound}]};for(const f of Map.projectComparison(study,alternate,{scenarioId:'Y'}).features.filter(f=>f.geometry.type==='LineString'))assert.equal(f.properties.color,colors[f.properties.warehouseId]);
for(const f of Map.project(study,snap).features.filter(f=>f.geometry.type==='LineString'))assert.equal(f.properties.color,colors[f.properties.warehouseId]);
const transfer={...snap,planningReference:{...snap.planningReference,transfer:[leg('W','E',1,'P1',2,0)]},rows:[{...snap.rows[0],transfer:[leg('W','E',2,'P1',2,0)]}]};for(const f of Map.projectComparison(study,transfer).features.filter(f=>f.properties.layer?.endsWith('transfer'))){assert.equal(f.properties.warehouseId,'W');assert.equal(f.properties.color,colors.W);}
const large={...study,nodes:[study.nodes[4],...Array.from({length:25},(_,i)=>node('W'+String(i).padStart(2,'0'),'DC',[110+i*.01,30]))]},largeSnap={...snap,planningReference:{outbound:[]},rows:[{scenarioId:'X',outbound:large.nodes.slice(1).map(n=>leg(n.nodeId,'D',1,'P1',1,0))}]};assert.equal(Map.projectComparison(large,largeSnap).warehouseLegend.length,25);assert.equal(new Set(Map.projectComparison(large,largeSnap).warehouseLegend.map(r=>r.color)).size,25);
assert.equal(JSON.stringify({study,snap}),frozen);console.log('Warehouse colors PASS: distinct, reorder/locale/period/filter/candidate invariant, inbound/outbound/transfer, legacy projection, >12 sites, immutable input');

// Marker color and comparison-specific warehouse state derive from the same projection.
for(const f of colored.features.filter(f=>f.properties.kind==='facility'))assert.equal(f.properties.color,colored.entities.find(e=>e.id===f.properties.entityId).warehouseColor);
const sites=Map.projectComparison(study,{...snap,rows:[{...snap.rows[0],selectedSiteIds:['E']}]});
assert.equal(sites.features.find(f=>f.geometry.type==='Point'&&f.properties.entityId==='W').properties.referenceSelected,true);assert.equal(sites.features.find(f=>f.geometry.type==='Point'&&f.properties.entityId==='E').properties.candidateSelected,true);
assert.equal(Map.projectComparison(study,{...snap,rows:[{...snap.rows[0],selectedSiteIds:['E']}]},{mode:'REFERENCE'}).features.find(f=>f.geometry.type==='Point'&&f.properties.entityId==='W').properties.selected,true);
assert.equal(JSON.stringify({study,snap}),frozen);console.log('Warehouse marker colors and reference/candidate state PASS');
