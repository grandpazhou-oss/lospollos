#!/usr/bin/env node
'use strict';
// Execute the production updateGrid closure with MapLibre method doubles.
// This proves style/source updates, not actual browser rendering.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const supplyMap=require('../platform-supply-map-v8.js');
const source=fs.readFileSync(path.join(__dirname,'..','platform-map-runtime-v19.js'),'utf8');
const start=source.indexOf('  function updateGrid('),end=source.indexOf('\n  function refreshLinked(',start);
assert.ok(start>=0&&end>start,'Production updateGrid closure is available');
const state={linkedOpen:true,gridDisplay:'before',linkedKind:'outbound',gridSize:1};
const model={entities:[{id:'increase',coordinate:[110,30]},{id:'decrease',coordinate:[112,30]},{id:'zero',coordinate:[114,30]},{id:'unknown',coordinate:null}]};
const relations=[{relationId:'positive',kind:'outbound',toNodeId:'increase',before:10.12345,after:20.12345},{relationId:'negative',kind:'outbound',toNodeId:'decrease',before:15,after:5},{relationId:'zero',kind:'outbound',toNodeId:'zero',before:0,after:0},{relationId:'missing',kind:'outbound',toNodeId:'unknown',before:3.7,after:4.8}];
const original=JSON.stringify({model,relations});
const sandbox={owner:'SUPPLY',view:()=>state,model,linkedResult:()=>({relations}),ns:{supplyMap}};
vm.runInNewContext(source.slice(start,end)+'\nglobalThis.update=updateGrid;',sandbox);
const update=sandbox.update,id='p7-analysis-grid',plain=x=>JSON.parse(JSON.stringify(x));
function mapDouble(){const sources=new Map(),layers=new Map([['p7-supply-points',{id:'p7-supply-points',type:'circle'}]]);return {sources,layers,sourceAdds:0,paintUpdates:0,getSource:key=>sources.get(key),getLayer:key=>layers.get(key),getStyle:()=>({layers:[...layers.values()]}),addSource(key,value){assert.equal(sources.has(key),false);this.sourceAdds++;sources.set(key,{data:plain(value.data),setData(data){this.data=plain(data);}});},addLayer(value){layers.set(value.id,plain(value));},setPaintProperty(key,property,value){assert.ok(layers.has(key));this.paintUpdates++;layers.get(key).paint[property]=plain(value);},removeLayer(key){layers.delete(key);},removeSource(key){assert.equal(layers.has(id+'-fill'),false);assert.equal(layers.has(id+'-line'),false);sources.delete(key);}};}
function color(target,value){const expression=target.getLayer(id+'-fill').paint['fill-color'];assert.deepEqual(expression.slice(0,3),['case',['<',['get','value'],0],'#187667']);return value<0?expression[2]:expression[3];}
function values(target){return target.getSource(id).data.features.map(f=>f.properties.value);}
const primary=mapDouble(),peer=mapDouble();update(primary);update(peer);
assert.deepEqual(values(primary),[10.12345,15,0]);assert.equal(color(primary,10),'#4165bb');
assert.equal(primary.getSource(id).data.features.length,3,'Unknown coordinates are excluded; zero-volume cells remain');
assert.equal(primary.getSource(id).data.features.at(-1).properties.intensity,0,'True zero remains zero');
const peerBefore=JSON.stringify([...peer.layers]);
state.gridDisplay='delta';update(primary);
assert.equal(color(primary,10),'#bc523d','Before to delta changes the existing fill layer to difference colors');
assert.equal(color(primary,-10),'#187667');assert.deepEqual(values(primary),[20.12345-10.12345,-10,0]);
assert.equal(JSON.stringify([...peer.layers]),peerBefore,'Updating primary does not silently mutate peer');
update(peer);assert.equal(color(peer,10),'#bc523d','Peer gets its own paint update');
state.gridDisplay='after';update(primary);assert.equal(color(primary,20),'#4165bb','Delta to after restores absolute-volume color');assert.deepEqual(values(primary),[20.12345,5,0]);
state.gridDisplay='before';update(peer);assert.equal(color(peer,10),'#4165bb','Delta to before restores absolute-volume color on peer');
assert.equal(primary.sourceAdds,1,'Mode switching updates existing source');assert.equal(peer.sourceAdds,1);
state.gridDisplay='off';update(primary);update(peer);
for(const target of [primary,peer]){assert.equal(target.getSource(id),undefined);assert.equal(target.getLayer(id+'-fill'),undefined);assert.equal(target.getLayer(id+'-line'),undefined);}
state.gridDisplay='delta';update(primary);update(peer);assert.equal(color(primary,10),'#bc523d');assert.equal(color(peer,10),'#bc523d');
state.gridDisplay='before';update(primary);update(peer);assert.equal(color(primary,10),'#4165bb');assert.equal(color(peer,10),'#4165bb');
state.linkedOpen=false;update(primary);assert.equal(primary.getSource(id),undefined,'Closing linked analysis clears overlay');
state.linkedOpen=true;sandbox.owner='DESIGN';update(peer);assert.equal(peer.getSource(id),undefined,'Non-supply maps keep no supply grid');update(null);
const grid=supplyMap.fixedGrid(model,relations);assert.equal(grid.missingBefore,3.7);assert.equal(grid.missingAfter,4.8);assert.deepEqual(grid.missingRelations,['missing']);
assert.equal(JSON.stringify({model,relations}),original,'All mode changes leave quantities and source model unchanged');
console.log(JSON.stringify({status:'PASS',tier:'UNIT_PRODUCTION_CLOSURE_MAPLIBRE_DOUBLES',cases:['before-delta','delta-after','delta-before','off-on','independent-peer','zero-and-missing-coordinates','source-immutability'],sourceAdds:[primary.sourceAdds,peer.sourceAdds],paintUpdates:[primary.paintUpdates,peer.paintUpdates]}));
