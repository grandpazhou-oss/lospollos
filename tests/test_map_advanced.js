'use strict';
const assert=require('node:assert/strict'),api=require('../platform-map-showcase-v19.js').advanced;
const id=(kind,a,b)=>encodeURIComponent([kind,a,b].join('\0'));
const links=[
 {relationId:id('outbound','W1','C1'),side:'candidate',warehouseId:'W1',fromNodeId:'W1',toNodeId:'C1',quantity:.125,color:'#2563eb',change:'NEW',coordinates:[[116,39],[116.11,39.01]]},
 {relationId:id('outbound','W1','C2'),side:'candidate',warehouseId:'W1',fromNodeId:'W1',toNodeId:'C2',quantity:10.567,color:'#2563eb',change:'UNCHANGED',coordinates:[[116,39],[116.111,39.011]]},
 {relationId:id('outbound','W2','C1'),side:'reference',warehouseId:'W2',fromNodeId:'W2',toNodeId:'C1',quantity:.125,color:'#059669',change:'REMOVED',coordinates:[[115,38],[116.11,39.01]]},
 {relationId:id('inbound','S1','W1'),side:'candidate',warehouseId:'W1',fromNodeId:'S1',toNodeId:'W1',quantity:20,color:'#2563eb',change:'NEW',coordinates:[[116,39],[116.11,39.01]]}
];
const before=JSON.stringify(links);for(const l of links){Object.freeze(l.coordinates[0]);Object.freeze(l.coordinates[1]);Object.freeze(l.coordinates);Object.freeze(l);}Object.freeze(links);
const chosen=links.filter(l=>l.side==='candidate'),groups=api.aggregateFlows(chosen,3);
assert.ok(groups.length<chosen.length);assert.equal(groups.reduce((s,g)=>s+g.quantity,0),chosen.reduce((s,g)=>s+g.quantity,0));assert.equal(groups.flatMap(g=>g.members).length,chosen.length);
assert.deepEqual(api.aggregateFlows([...chosen].reverse(),3).map(g=>g.members),groups.map(g=>g.members));
assert.equal(api.aggregateFlows(chosen,9).length,chosen.length,'High zoom expands actual relations, not only points');
assert.ok(groups.every(g=>Number.isFinite(g.to[0])&&Number.isFinite(g.to[1])));
const hexes=api.demandHexagons(chosen,100),quantity=hexes.reduce((s,h)=>s+h.properties.quantity,0);
assert.ok(Math.abs(quantity-10.692)<1e-12,'Demand columns exclude inbound quantity and do not double-count reference');
for(const h of hexes){assert.deepEqual(h.geometry.coordinates[0][0],h.geometry.coordinates[0].at(-1));assert.ok(Math.abs(h.properties.height-50000*h.properties.quantity)<1e-8);}
const doubled=api.demandHexagons(chosen.map(l=>({...l,quantity:l.quantity*2})),100);
assert.equal(doubled.length,hexes.length);assert.ok(doubled.every((h,i)=>Math.abs(h.properties.height-hexes[i].properties.height*2)<1e-8),'Same fixed scale, no period-wise renormalization');
const lens=api.lensTotals(links,[{id:'C1',x:10,y:10},{id:'C2',x:200,y:200},{id:'W1',x:10,y:10}],[0,0],50);
assert.deepEqual(lens.totals.outbound,{reference:.125,candidate:.125});assert.deepEqual(lens.totals.inbound,{reference:0,candidate:20});assert.equal(lens.changed,2,'Different legs remain separate; changed receiver counted once per leg');
const arc=api.arcPath(chosen[0]);assert.equal(arc.length,33);assert.equal(arc[0][2],0);assert.ok(arc[16][2]>0);assert.ok(Math.abs(arc.at(-1)[2])<1e-12);
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];assert.deepEqual(api.screenPoint([0,0,0],matrix,200,100),[100,50]);assert.equal(JSON.stringify(links),before,'No source mutation or rounding of business values');
assert.deepEqual(api.aggregateFlows([],3),[]);assert.deepEqual(api.demandHexagons([],100),[]);assert.ok(Object.isFrozen(api));
console.log('PASS advanced map: conservation, separate legs/sides, stable members, true flow expansion, linear cross-period scale, lens and 3D geometry (pure module, not browser acceptance)');
