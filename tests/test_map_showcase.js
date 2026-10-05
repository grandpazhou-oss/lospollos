#!/usr/bin/env node
'use strict';
// Pure geometry/data checks plus lifecycle checks with explicit DOM/MapLibre/RAF doubles.
// This is a module contract test, not a native map or human usability acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','platform-map-showcase-v19.js'),'utf8');
const api=require('../platform-map-showcase-v19.js');
let assertions=0,groups=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const yes=(value,message)=>{assert.ok(value,message);assertions++;};
const near=(a,b,message)=>yes(Math.abs(a-b)<1e-8,message);
function test(name,fn){fn();groups++;console.log('PASS '+name);}
function link(id,side='candidate',quantity=.001,extra={}){return {type:'Feature',properties:{relationId:id,comparison:side,quantity,fromNodeId:'W',toNodeId:'C',warehouseId:'W',color:'#2563eb',change:'NEW',...extra},geometry:{type:'LineString',coordinates:[[10,10],[110,10]]}};}
function point(id,kind='customer',coordinate=[110,10],extra={}){return {type:'Feature',properties:{entityId:id,kind,...extra},geometry:{type:'Point',coordinates:coordinate}};}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
test('import is safe without a DOM or a map',()=>{const isolated={};vm.runInNewContext(source,isolated);eq(typeof isolated.STCTPlatformV19.mapShowcase.create,'function');});
test('stable IDs, direction, precision, and source immutability',()=>{
  const features=freeze([link('b','candidate',.001),link('a','reference',4),link('a','candidate',9),point('C'),point('W','facility',[10,10])]);
  const before=JSON.stringify(features),normal=api.prepareFeatures(features),reverse=api.prepareFeatures([...features].reverse());
  eq(normal,reverse);eq(normal.candidate[1].quantity,.001);eq(normal.pulse[0].relationId,'a');eq(normal.pulseSide,'candidate');eq(normal.candidate[0].fromNodeId,'W');eq(normal.candidate[0].toNodeId,'C');
  yes(normal.links.every(row=>!row.id.includes('\u0000')),'DOM IDs are printable');eq(JSON.stringify(features),before);
  normal.links[0].coordinates[0][0]=0;eq(features[1].geometry.coordinates[0][0],10,'cloned coordinate arrays');
});
test('context, invalid coordinates and nonpositive or unknown quantities never animate',()=>{
  const badGeometry=link('badcoord');badGeometry.geometry.coordinates[0][0]=null;
  const features=[link('valid'),link('valid'),link('zero','candidate',0),link('unknown','candidate',null),link('text','candidate','1'),link('negative','candidate',-1),link('context','candidate',1,{context:true}),link('badside','observed'),badGeometry];
  eq(api.prepareFeatures(features).links.map(row=>row.relationId),['valid']);
});
test('same-coordinate different node IDs survive and unsafe colors are neutral',()=>{
  const data=api.prepareFeatures([point('A'),point('B'),link('badcolor','candidate',1,{color:'url(javascript:bad)'}),link('rgb','candidate',1,{color:'rgb(23, 42, 51)'})]);
  eq(data.points.map(row=>row.id),['A','B']);eq(data.links[0].color,'#64748b');eq(data.links[1].color,'rgb(23, 42, 51)');
});
test('pulse selects bounded current candidate relations, never mixes sides',()=>{
  const features=Array.from({length:130},(_,i)=>link('r'+String(i).padStart(3,'0'),'candidate',i+1));features.push(link('reference','reference',99999));
  const data=api.prepareFeatures(features);eq(data.pulse.length,120);eq(data.pulseTotal,130);eq(data.pulse[0].quantity,130);yes(data.pulse.every(row=>row.side==='candidate'));
  const fallback=api.prepareFeatures([link('ref','reference',5)]);eq(fallback.pulseSide,'reference');eq(fallback.pulse.length,1);
});
test('change cap is deterministic and keeps full count available',()=>{
  const features=Array.from({length:1210},(_,i)=>link(String(i),'candidate',1));const data=api.prepareFeatures(features);
  eq(data.change.length,1200);eq(data.links.length,1210);eq(data.change,api.prepareFeatures(features.reverse()).change);
});
test('change cap never cuts one side from the same relation comparison',()=>{
  const features=Array.from({length:1199},(_,i)=>link('a'+String(i).padStart(4,'0'),'candidate',1));features.push(link('z-pair','reference',3),link('z-pair','candidate',5));const data=api.prepareFeatures(features);
  eq(data.change.length,1199);eq(data.links.length,1201);eq(data.change.filter(row=>row.relationId==='z-pair').length,0);eq(data.change,api.prepareFeatures([...features].reverse()).change);
});
test('pulse follows assignment coordinates forward with bounded local trails',()=>{
  const path=freeze([[0,0],[100,0],[100,100]]),before=JSON.stringify(path),f=api.pulseFrame(path,4500,'');
  eq(f.head,[100,50]);eq(f.tail,[100,26]);near(f.angle,90);eq(f.length,200);eq(JSON.stringify(path),before);
  const reverse=api.pulseFrame([[100,0],[0,0]],3000,'');eq(reverse.head,[50,0]);yes(reverse.tail[0]>reverse.head[0]);near(reverse.angle,180);
  const zero=api.pulseFrame([[1,2],[1,2]],5000,'');eq(zero.head,[1,2]);eq(zero.length,0);
  const f2=api.pulseFrame(path,3500,'same');eq(f2,api.pulseFrame(path,3500,'same'));
});
test('transition uses display opacity only with explicit phase boundaries',()=>{
  eq(api.changeFrame(0),{phase:0,referenceOpacity:1,candidateOpacity:0,spotlight:false,done:false});
  eq(api.changeFrame(4500),{phase:1,referenceOpacity:.5,candidateOpacity:.5,spotlight:true,done:false});
  eq(api.changeFrame(9000),{phase:2,referenceOpacity:0,candidateOpacity:1,spotlight:false,done:true});
  eq(api.changeFrame(-20),api.changeFrame(0));eq(api.changeFrame(1e9),api.changeFrame(9000));
});
test('viewport bounds retain crossings and exclude invalid or fully offscreen paths',()=>{
  eq(api.inBounds([[-10,5],[500,5]],400,300),true);eq(api.inBounds([[500,5],[600,5]],400,300),false);eq(api.inBounds([[5,500],[5,600]],400,300),false);eq(api.inBounds([[NaN,1],[2,2]],400,300),false);eq(api.inBounds([[1,1]],400,300),false);
});

// Minimal browser doubles: parse only actual element/attribute markup used by the module.
// Layout and native event behavior are independently covered in the real browser suite.
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.parentElement=null;this.attrs={};this.style={};this.dataset={};this.listeners=new Map();this.textContent='';this.disabled=false;this.classList={add:(...names)=>{this.className=[this.className,...names].filter(Boolean).join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>name&&!names.includes(name)).join(' ');}};}
  get className(){return this.attrs.class||'';}set className(value){this.attrs.class=value;}
  get isConnected(){return this===this.ownerDocument.body||Boolean(this.parentElement?.isConnected);}
  setAttribute(name,value){this.attrs[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  prepend(node){node.remove();node.parentElement=this;this.children.unshift(node);}
  after(node){const p=this.parentElement;node.remove();node.parentElement=p;p.children.splice(p.children.indexOf(this)+1,0,node);}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  matches(selector){if(selector.startsWith('.'))return selector.slice(1).split('.').every(c=>this.className.split(' ').includes(c));if(selector.startsWith('[')){const m=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return Boolean(m&&Object.hasOwn(this.attrs,m[1])&&(m[2]===undefined||this.attrs[m[1]]===m[2]));}return this.tagName===selector;}
  querySelectorAll(selector){if(selector.includes(' > ')){const [parent,child]=selector.split(' > ');return this.querySelectorAll(parent).flatMap(node=>node.children.filter(c=>c.matches(child)));}return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  set innerHTML(markup){for(const child of this.children)child.parentElement=null;this.children=[];const stack=[this],tags=markup.match(/<[^>]+>|[^<]+/g)||[];for(const token of tags){if(token.startsWith('</')){stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1).textContent+=decode(token);continue;}const m=token.match(/^<([\w-]+)/);if(!m)continue;const node=new Element(m[1],this.ownerDocument);for(const attr of token.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],decode(attr[2]||''));stack.at(-1).append(node);if(!token.endsWith('/>'))stack.push(node);}}
  addEventListener(event,handler){const set=this.listeners.get(event)||new Set();set.add(handler);this.listeners.set(event,set);}
  removeEventListener(event,handler){this.listeners.get(event)?.delete(handler);}
  emit(event,payload){for(const handler of [...this.listeners.get(event)||[]])handler(payload);}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return {width:400,height:300,left:0,top:0};}
}
function fixture(options={}){
  const doc={visibilityState:'visible',activeElement:null,listeners:new Map(),createElement:tag=>new Element(tag,doc),createElementNS:(_,tag)=>new Element(tag,doc)};
  for(const method of ['addEventListener','removeEventListener','emit'])doc[method]=Element.prototype[method];
  doc.body=new Element('body',doc);const host=doc.createElement('div');doc.body.append(host);
  const topbar=doc.createElement('div');topbar.className='p7-map-topbar';host.append(topbar);
  const analysis=doc.createElement('details');analysis.setAttribute('data-p7-toolgroup','analysis');const summary=doc.createElement('summary');analysis.append(summary);topbar.append(analysis);
  const pane=doc.createElement('div');pane.className='p7-map-pane is-reference';host.append(pane);const canvas=doc.createElement('canvas');pane.append(canvas);
  const layers=new Map([['p7-supply-relations',undefined],['p7-supply-relations-reference','visible'],['p7-supply-relations-candidate','none'],['p7-supply-points',undefined],['p7-supply-facilities','visible'],['p7-supply-coverage-halo','visible'],['p7-supply-clustered',undefined],['p7-supply-clustered-count','visible'],['p7-supply-warehouses','visible'],['background','visible']]);
  const handlers=new Map(),map={offset:0,getStyle:()=>({layers:[...layers.keys()].map(id=>({id}))}),getLayer:id=>layers.has(id)?{id}:undefined,getLayoutProperty:id=>layers.get(id),setLayoutProperty(id,key,value){layers.set(id,value===null?undefined:value);map.emit('styledata');},getCanvas:()=>canvas,project:p=>({x:p[0]+map.offset,y:p[1]}),on(event,handler){const set=handlers.get(event)||new Set();set.add(handler);handlers.set(event,set);},off(event,handler){handlers.get(event)?.delete(handler);},emit(event){for(const handler of [...handlers.get(event)||[]])handler();}};
  let requested=0,contextCalls=0;const pending=new Map(),sandbox={document:doc,setTimeout,clearTimeout,requestAnimationFrame:callback=>{const id=++requested;pending.set(id,callback);return id;},cancelAnimationFrame:id=>pending.delete(id)};
  vm.runInNewContext(source,sandbox,{filename:'platform-map-showcase-v19.js'});
  const features=freeze([link('old','reference',.001,{change:'REMOVED'}),link('new','candidate',.001),point('C'),point('W','facility',[10,10],{label:'Old warehouse',color:'#7c3aed',referenceSelected:true}),point('W2','facility',[20,10],{label:'New warehouse',color:'#dc2626',candidateSelected:true,selected:true})]);const before=JSON.stringify(features);
  const context={host,map,ready:true,showcaseReady:true,noWebGL:false,reducedMotion:false,locale:'en',dark:false,features,canCompare:true,scenarioName:'Candidate exact',referenceName:'Reference exact',periodLabel:'2026-01',selectedLabel:'',identity:'first',...options};
  const controller=sandbox.STCTPlatformV19.mapShowcase.create(()=>{contextCalls++;return context;});
  const tick=time=>{const entry=pending.entries().next().value;if(entry){pending.delete(entry[0]);entry[1](time);}};
  const click=(action,phase)=>{const panel=host.querySelector('.p7-showcase'),button=panel.querySelectorAll('[data-showcase-action="'+action+'"]').find(b=>phase===undefined||b.dataset.phase===String(phase));yes(button,'control exists '+action);panel.emit('click',{target:button});};
  return {controller,context,host,pane,canvas,doc,map,layers,handlers,pending,tick,click,summary,features,before,calls:()=>contextCalls};
}
test('pulse RAF uses cached context and stable SVG nodes; pause, reset and exit clean up',()=>{
  const f=fixture();yes(f.controller.open('pulse'));eq(f.controller.status().active,true);eq(f.pending.size,1);const particle=f.host.querySelector('[data-showcase-pulse]'),start=particle.getAttribute('cx'),calls=f.calls();
  f.tick(0);f.tick(1000);yes(particle.getAttribute('cx')!==start);eq(f.host.querySelector('[data-showcase-pulse]'),particle,'per-frame SVG nodes reused');eq(f.calls(),calls,'no model projection per RAF');
  f.click('pause');eq(f.pending.size,0);eq(f.controller.status().running,false);const paused=particle.getAttribute('cx');f.tick(2000);eq(particle.getAttribute('cx'),paused);
  f.click('reset');eq(f.controller.status().elapsedMs,0);eq(f.pending.size,1);f.click('close');eq(f.doc.activeElement,f.summary);eq(f.pending.size,0);eq(f.controller.status().active,false);eq(f.host.querySelector('.p7-showcase'),null);eq(f.host.querySelector('.p7-showcase-overlay'),null);eq(JSON.stringify(f.features),f.before);
  eq([...f.handlers.values()].reduce((n,s)=>n+s.size,0),0);eq(f.doc.listeners.get('visibilitychange').size,0);
});
test('change hides only business detail layers, survives own style events, restores exact visibility',()=>{
  const f=fixture(),before=new Map(f.layers);f.controller.open('change');eq(f.controller.status().active,true);eq(f.layers.get('p7-supply-warehouses'),'visible');eq(f.layers.get('background'),'visible');
  for(const [id] of before)if(!['p7-supply-warehouses','background'].includes(id))eq(f.layers.get(id),'none',id+' hidden');
  f.layers.set('p7-supply-coverage-halo','visible');f.controller.refresh();eq(f.layers.get('p7-supply-coverage-halo'),'none','runtime repaint cannot reveal hidden halo');f.controller.close();eq(f.layers,before,'undefined, visible and none restored exactly');
});
test('manual transition phases paint only their own side and keep candidate endpoint dots',()=>{
  const f=fixture();f.controller.open('change');const reference=f.host.querySelector('[data-showcase-side="reference"]'),candidate=f.host.querySelector('[data-showcase-side="candidate"]');
  yes(Number(reference.getAttribute('opacity'))>0);eq(Number(candidate.getAttribute('opacity')),0);yes(f.host.querySelector('.p7-showcase-summary').textContent.includes('Reference exact → Candidate exact'));
  f.click('phase',1);eq(Number(reference.getAttribute('opacity')),.44);eq(Number(candidate.getAttribute('opacity')),.44);eq(f.controller.status().running,false);eq(f.pending.size,0);
  f.click('phase',2);eq(Number(reference.getAttribute('opacity')),0);yes(Number(candidate.getAttribute('opacity'))>0);yes(Number(f.host.querySelector('[data-showcase-endpoint]').getAttribute('opacity'))>0);eq(f.controller.status().phase,'candidate');f.controller.close();
});
test('warehouse marker and label switch with the displayed reference and candidate phase',()=>{
  const f=fixture();f.controller.open('change');
  const old=f.host.querySelector('[data-showcase-warehouse="W"]'),next=f.host.querySelector('[data-showcase-warehouse="W2"]');
  yes(old);yes(next);eq(old.getAttribute('opacity'),'1');eq(next.getAttribute('opacity'),'0');
  yes(f.host.className.includes('p7-showcase-transition-active'));
  f.click('phase',2);eq(old.getAttribute('opacity'),'0');eq(next.getAttribute('opacity'),'1');
  yes(next.querySelector('[data-showcase-warehouse-label]'));f.controller.close();
  eq(f.host.classList.contains?.('p7-showcase-transition-active')||f.host.className.includes('p7-showcase-transition-active'),false);
});
test('shared endpoint colors are neutral, warehouse endpoints remain in the base layer',()=>{
  const f=fixture({features:[link('A','candidate',1),link('B','candidate',2,{warehouseId:'W2',fromNodeId:'W2',color:'#dc2626'}),point('C'),point('W','facility',[10,10]),point('W2','facility',[20,10])]});
  f.controller.open('change');f.click('phase',2);eq(f.host.querySelectorAll('[data-showcase-endpoint]').length,1);eq(f.host.querySelector('[data-showcase-endpoint]').getAttribute('fill'),'#64748b');f.controller.close();
});
test('paused camera movement reprojects cached assignments without advancing time',()=>{
  const f=fixture();f.controller.open('pulse');f.tick(0);f.tick(1000);f.click('pause');const before=Number(f.host.querySelector('[data-showcase-pulse]').getAttribute('cx')),elapsed=f.controller.status().elapsedMs;f.map.offset=50;f.map.emit('move');near(Number(f.host.querySelector('[data-showcase-pulse]').getAttribute('cx')),before+50);eq(f.controller.status().elapsedMs,elapsed);eq(f.pending.size,0);f.controller.close();
});
test('reduced motion never schedules RAF; static arrows and manual phases remain available',()=>{
  const f=fixture({reducedMotion:true});f.controller.open('pulse');eq(f.pending.size,0);yes(f.host.querySelector('[data-showcase-arrow]'));f.click('reset');eq(f.pending.size,0);f.controller.open('change');f.click('phase',2);eq(f.controller.status().phase,'candidate');eq(f.pending.size,0);f.controller.close();
});
test('hidden tab pauses and does not resume automatically',()=>{
  const f=fixture();f.controller.open();f.doc.visibilityState='hidden';f.doc.emit('visibilitychange');eq(f.pending.size,0);eq(f.controller.status().reason,'HIDDEN');f.doc.visibilityState='visible';f.doc.emit('visibilitychange');eq(f.pending.size,0);eq(f.controller.status().running,false);f.click('pause');eq(f.pending.size,1);f.controller.close();
});
test('pulse and transition automatically stop at their respective time budgets',()=>{
  for(const [mode,limit,reason] of [['pulse',60000,'LIMIT'],['change',9000,'COMPLETE']]){const f=fixture();f.controller.open(mode);f.tick(0);f.tick(limit+1);eq(f.controller.status().elapsedMs,limit);eq(f.controller.status().running,false);eq(f.pending.size,0);eq(f.controller.status().reason,reason);f.controller.close();}
});
test('unavailable geographic map, split view and missing comparison honestly disable playback',()=>{
  for(const options of [{noWebGL:true},{showcaseReady:false,unavailableReason:'Exit split first'},{canCompare:false}]){const f=fixture(options);f.controller.open('change');eq(f.pending.size,0);eq(f.controller.status().running,false);eq(f.layers.get('p7-supply-relations'),undefined);eq(f.host.querySelector('[data-showcase-action="pause"]').disabled,true);eq(f.host.querySelector('[data-showcase-side]'),null);f.click('pause');eq(f.pending.size,0);f.controller.close();}
});
test('model identity changes and style replacement terminate and restore the presentation',()=>{
  for(const cause of ['identity','style.load','layer-missing']){const f=fixture();f.controller.open('change');if(cause==='identity'){f.context.identity='second';f.controller.refresh();}else if(cause==='layer-missing'){f.layers.delete('p7-supply-points');f.map.emit('styledata');}else f.map.emit(cause);eq(f.controller.status().active,false);eq(f.pending.size,0);eq(f.layers.get('p7-supply-relations'),undefined);}
});
test('map disappearance pauses work; reopening cycles leave no pending frame or event handler',()=>{
  const f=fixture();f.controller.open();f.context.ready=false;f.tick(0);eq(f.controller.status().reason,'UNAVAILABLE');eq(f.pending.size,0);f.context.ready=true;f.controller.close();
  for(let i=0;i<5;i++){f.controller.open(i%2?'change':'pulse');f.tick(0);f.controller.close();eq(f.pending.size,0);eq([...f.handlers.values()].reduce((n,s)=>n+s.size,0),0);}eq(JSON.stringify(f.features),f.before);
});
console.log(`PASS map showcase: ${groups} groups, ${assertions} assertions (pure helpers and DOM/MapLibre/RAF doubles; not browser acceptance)`);
