'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const D=require('../supply-chain-design-v19.js');
const E=require('../supply-chain-explanation-v19.js');
const R=require('../supply-chain-report-v19.js');
const J=require('../supply-chain-v5-results-v19.js');
const Joint=require('../supply-chain-joint-v19.js');
const dir=process.env.STCT_V72_BROWSER_DIR;
assert.ok(dir&&fs.existsSync(dir),'STCT_V72_BROWSER_DIR must hold native browser evidence');
const cases=[['uc-outbound','uc-outbound-state.private.json',R],['uc-full','uc-full-state.private.json',J],['synthetic-full-cost',null,J]];
const report=[];
for(const [label,stateFile,service] of cases){
 const state=stateFile?JSON.parse(fs.readFileSync(path.join(dir,stateFile),'utf8')):null;
 const source=label==='synthetic-full-cost'?JSON.parse(fs.readFileSync(path.join(dir,'synthetic-full-cost.package.json'),'utf8')):JSON.parse(fs.readFileSync(path.join(dir,`${label}.package.json`),'utf8'));
 const study=D.createStudy(source.study),original=source.snapshot,rows=original.rows.map(row=>row.result||row);
 const permutations=[rows,[...rows].reverse(),[rows[2],rows[0],rows[rows.length-1],...rows.slice(1,-1).filter(row=>row!==rows[2])].filter((row,i,all)=>all.indexOf(row)===i),[...rows].sort((a,b)=>String(a.scenarioId).localeCompare(String(b.scenarioId)))];
 const expected=E.comparisonProjection(original).entries.map(entry=>entry.row.scenarioId),focus=original.decision.focusScenarioId;
 for(const candidates of permutations){
  const snapshot=service===R?R.createSnapshot(study,original.baseline,candidates,original.solverRuns,original.scenario,original.backendIdentity):J.createSnapshot(study,original.baseline,original.scenario,original.planningReference,candidates,original.solverRuns,(state?.jointRequest||Joint.buildRequest(study,original.scenario,{reference:false})),original.backendIdentity);
  const startHash=D.hash(snapshot),projection=E.comparisonProjection(snapshot);
  assert.deepEqual(projection.entries.map(entry=>entry.row.scenarioId),expected,`${label} display order`);
  assert.equal(snapshot.decision.focusScenarioId,focus,`${label} focus`);
  const html=service.toHtml(study,snapshot,'zh'),ids=[...html.matchAll(/<tr data-scenario-id="([^"]+)"/g)].map(row=>row[1]);assert.deepEqual(ids,expected,`${label} HTML order`);
  const md=service.toMarkdown(study,snapshot),csv=service.toComparisonCsv(study,snapshot);
  let previous=-1;for(const id of expected){const next=md.indexOf(` · ${id} |`,previous+1);assert.ok(next>previous,`${label} MD ${id}`);previous=next;}
  assert.deepEqual(csv.trim().split('\n').slice(1).map(line=>line.split(',')[2].replaceAll('"','')),expected,`${label} CSV order`);
  assert.equal(D.hash(snapshot),startHash);
 }
 report.push({label,candidates:rows.length,permutations:permutations.length,focus,order:expected,method:'REBUILT_WITH_SNAPSHOT_FACTORY_NO_SOLVE'});
}
console.log(JSON.stringify({status:'PASS',report}));
