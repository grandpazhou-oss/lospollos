'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../supply-chain-explanation-v19.js');
const V5=require('../supply-chain-v5-results-v19.js');

const evidence=process.env.STCT_V7_REPLAY_PACKAGES || null;
if(evidence)for(const [file,scope,relations,periods,metric] of [
  ['uc-upstream.package.json','UPSTREAM_ONLY',12,84,'INBOUND_VOLUME_KM'],
  ['uc-full.package.json','FULL_CHAIN',3,21,'TWO_END_VOLUME_KM'],
]){
  const packageValue=JSON.parse(fs.readFileSync(path.join(evidence,file)));
  const {study,snapshot}=packageValue;
  const refreshed=structuredClone(snapshot);
  delete refreshed.decision;
  refreshed.decision=E.selection(refreshed);
  const brief=E.businessBrief(refreshed);
  assert.equal(brief.scope,scope);
  assert.equal(brief.uniqueChangedRelations,relations);
  assert.equal(brief.changedPeriodRecords,periods);
  assert.equal(brief.relationBreakdown.added+brief.relationBreakdown.removed+brief.relationBreakdown.volumeOnly,relations);
  assert.equal(refreshed.decision.rankingMetric,metric);
  for(const locale of ['zh','en','ja']){
    const html=V5.toHtml(study,snapshot,locale);
    assert.ok(html.includes(brief.candidateId));
    assert.ok(html.includes(String(relations)));
    assert.ok(html.includes(String(periods)));
    if(scope==='UPSTREAM_ONLY')assert.doesNotMatch(html,/Both-end volume-km|両端物量キロ|两端物量公里|全链物量公里/);
  }
  const md=V5.toMarkdown(study,snapshot,'zh');
  assert.ok(md.includes(brief.candidateId));
  if(scope==='UPSTREAM_ONLY')assert.doesNotMatch(md,/两端物量公里|全链物量公里/);
  const csv=V5.toCsv(study,snapshot);
  assert.ok(csv.includes('focusScenarioId,reportScope,uniqueChangedRelations,changedPeriodRecords'));
  assert.ok(csv.includes(`"${brief.candidateId}","${scope}","${relations}","${periods}"`));
}
const shortRows=[{supplierId:'S',siteId:'A',period:'P1',beforeVolume:5,afterVolume:0,change:'REMOVED'},{supplierId:'S',siteId:'A',period:'P2',beforeVolume:0,afterVolume:5,change:'NEW'}];
for(const count of [2,7]){
  const rows=[...shortRows,...Array.from({length:count-2},(_,index)=>({...shortRows[0],period:`P${index+3}`,beforeVolume:3,afterVolume:2,change:'VOLUME_CHANGED'}))];
  const snapshot={schemaVersion:'stct-supply-chain-v5-snapshot-v1',analysisScope:'UPSTREAM_ONLY',decision:{focusScenarioId:'X',kind:'THEORETICAL_DISTANCE_SCREENING',rankingMetric:'INBOUND_VOLUME_KM',referenceStatus:'NO_KNOWN_VIOLATION',tiedScenarioIds:[]},scenario:{objective:'VOLUME_KM'},rows:[{scenarioId:'X',selectedSites:[{name:'A'}],relationRows:rows,customerChanges:[],capacityByPeriod:[],comparison:{inbound:{changeRate:-0.1},outbound:{changeRate:null},totalVolumeKmBefore:10,totalVolumeKmAfter:9,costBefore:null,costAfter:null}}],distanceBasis:'VERIFIED_ROAD',unit:'m3',currency:'CNY'};
  const brief=E.businessBrief(snapshot);
  assert.equal(brief.uniqueChangedRelations,1);
  assert.equal(brief.changedPeriodRecords,count);
  assert.equal(brief.relationBreakdown.volumeOnly,1);
  assert.equal(brief.periodBreakdown.added+brief.periodBreakdown.removed+brief.periodBreakdown.volumeOnly,count);
}
console.log(JSON.stringify({status:'PASS',method:'HISTORICAL_NATIVE_SNAPSHOT_REPLAY_AND_SYNTHETIC_RELATION_VECTORS',checks:['uc_upstream_12_84','uc_full_3_21','scope_titles_three_languages','markdown_and_csv_focus','two_vs_seven_period_relation_identity']}));
