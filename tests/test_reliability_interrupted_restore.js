'use strict';
const assert=require('node:assert/strict'),C=require('../supply-chain-controller-v19.js'),D=require('../supply-chain-design-v19.js');
const rows=new Map(),key=(store,id)=>store+':'+id;
const repository={record:(id,payload,refs=[])=>({id,payload:structuredClone(payload),refs,contentHash:D.hash(payload)}),async read(store,id){return id===undefined?[...rows.entries()].filter(([k])=>k.startsWith(store+':')).map(([,v])=>structuredClone(v)):structuredClone(rows.get(key(store,id))||null);},async commit({records,pointer,expectedRevision}){assert.equal(rows.get(key('pointers',pointer.id))?.revision||0,expectedRevision);for(const [store,values]of Object.entries(records))for(const value of values)rows.set(key(store,value.id),structuredClone(value));const saved={...pointer,revision:expectedRevision+1};rows.set(key('pointers',saved.id),structuredClone(saved));return{status:'SAVED',pointer:saved};}};
const study=D.createStudy({studyId:'INTERRUPT-SYNTHETIC-A',classification:'SYNTHETIC',nodes:[{nodeId:'W',role:'DC',coordinate:[120,30]},{nodeId:'C',role:'CUSTOMER',coordinate:[121,30]}],periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'W',period:'P1',quantity:2,unit:'m3'}],coordinateUse:'ASSUMED_WGS84_SCREENING'});
(async()=>{const originalStorage=globalThis.sessionStorage;try{
 const saved=C.createController({repository});saved.loadStudy(study);const archive=await saved.save();const before=JSON.stringify([...rows]);const checks=[];
 for(const [label,marker,expected]of [['MATCHING',{studyId:study.studyId,inputHash:study.inputHash},'INTERRUPTED'],['OTHER_STUDY',{studyId:'OTHER',inputHash:study.inputHash},'STUDY_READY'],['OTHER_INPUT',{studyId:study.studyId,inputHash:'OLD_INPUT'},'STUDY_READY'],['LEGACY',{},'INTERRUPTED']]){
  let token=JSON.stringify({jobId:'synthetic-job',base:'http://127.0.0.1:9999/supply-chain-jobs-v6',...marker}),cancelled=0;
  globalThis.sessionStorage={getItem:()=>token,removeItem:()=>{token=null;}};
  const c=C.createController({repository,fetch:async()=>{cancelled++;return{ok:true};}});assert.equal(token,null);await c.reopen(archive.pointer.id);assert.equal(c.viewState().status,expected);assert.equal(c.viewState().study.inputHash,study.inputHash);assert.equal(c.viewState().job,null);assert.equal(cancelled,1);assert.equal(JSON.stringify([...rows]),before,'recovery must not rewrite persisted inputs');
  await c.reopen(archive.pointer.id);assert.equal(c.viewState().status,'STUDY_READY','explicit next open acknowledges startup notice');assert.equal(c.viewState().lastError,null);checks.push(label);
 }
 console.log(JSON.stringify({status:'PASS',method:'Synthetic storage/resume marker and controlled cancel transport; not a native solve',checks,persistedInputsUnchanged:true}));
}finally{if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}})().catch(e=>{console.error(e);process.exitCode=1;});
