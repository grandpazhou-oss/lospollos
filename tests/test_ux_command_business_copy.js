'use strict';
// Synthetic production mount/event tests. These are not browser or human observations.
const assert=require('node:assert/strict'),Adapter=require('../command-workspace-adapter-v19.js'),Actions=require('../operations-action-center-v19.js');
const target={innerHTML:'',classList:{add(){},remove(){}},querySelector(){return null;},querySelectorAll(){return[];}},handlers={},cleanups=[];
const scope={listen(_target,event,handler){handlers[event]=handler;},register(fn){cleanups.push(fn);}};
const adapter=Adapter.createAdapter({document:target}),context=adapter.createOperationalContext();
const identity=()=>({plan:context.snapshot().plan.planHash,run:context.snapshot().execution.run.executionRunHash});
function mount(path,locale){const descriptor=adapter.registry.get(path);return adapter.mountDescriptor(descriptor,{logicalPath:path,routeParams:{},scope},{target,snapshot:{locale,noWebGL:true},controller:{navigate(){}}});}
(async()=>{
 await context.ready;const original=identity();
 for(const [locale,severe,completion] of [['zh','严重','完成进度'],['en','Critical','Completion'],['ja','重大','完了率']]){
  let mounted=mount('/command/overview',locale);adapter.state.panelState.actionDetailId='ACTION_CENTER';adapter.render();
  const options=target.innerHTML.match(/<select data-command-filter="severity">([\s\S]*?)<\/select>/)[1];
  assert.match(options,new RegExp(`<option value="CRITICAL"(?: selected)?>${severe}</option>`));assert.ok(!options.includes(`value="${severe}"`));
  handlers.change({target:{dataset:{commandFilter:'severity'},value:'CRITICAL',matches:()=>false}});
  assert.equal(adapter.state.alertFilters.severity,'CRITICAL');assert.match(target.innerHTML,/<option value="CRITICAL" selected>/);
  const expected=Actions.project(context,{...adapter.state.alertFilters}).items;assert.ok(expected.every(row=>row.severity==='CRITICAL'));
  const visibleIds=[...target.innerHTML.matchAll(/data-action-item="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(visibleIds,expected.slice(0,100).map(row=>row.actionItemId));
  assert.match(target.innerHTML,/<details class="command-secondary-actions"><summary>/);assert.ok(!target.innerHTML.includes('<strong>PASS</strong>'));
  mounted.cleanup();mounted=mount('/command/analysis',locale);assert.ok(target.innerHTML.includes(`<th>${completion}</th>`));assert.ok(!target.innerHTML.includes('<th>Route</th>')||locale==='en');
  assert.ok(!target.innerHTML.includes('<small>DERIVED</small>'));assert.deepEqual(identity(),original);mounted.cleanup();
 }
 while(cleanups.length)cleanups.pop()();console.log(JSON.stringify({status:'PASS',method:'SYNTHETIC_PRODUCTION_COMMAND_MOUNTS_AND_FILTER_EVENTS_NO_BROWSER',checks:['three-locale-raw-filter-tokens','actual-filter-results','business-table-labels','technical-identities-folded','plan-run-identities-unchanged']}));
})().catch(error=>{console.error(error);process.exitCode=1;});
