'use strict';
// Fixed local module list; uploaded content is never interpreted as code or a module path.
const files=['integrity-hash-v151.js','network-contract-v18.js','depot-assignment-v18.js','trip-chain-v18.js','pickup-custody-v18.js','dock-wave-v18.js','network-solver-v18.js','network-accounting-v18.js','scenario-lab-v18.js','network-visualization-v18.js','design-data-adapter-v19.js','result-admission-v19.js','design-strategic-context-v19.js','platform-settings-v19.js','design-study-store-v19.js','vendor/xlsx/xlsx.full.min.js','import-budget-v19.js','platform-import-session-v19.js','platform-repository-v19.js','operational-validation-contract-v19.js','operational-validation-result-v19.js','operational-validation-session-v19.js','facility-location-mvp1-v19.js','platform-study-service-v19.js','supply-chain-design-v19.js','supply-chain-explanation-v19.js','supply-chain-report-v19.js','supply-chain-joint-v19.js','supply-chain-v5-results-v19.js','platform-study-kind-registry-v8.js'];
const modules=new Map();
self.require=name=>{const key=name.replace(/^\.\//,'');if(!modules.has(key))throw new Error('WORKER_DEPENDENCY_NOT_ALLOWED');return modules.get(key);};
for(const file of files){self.module={exports:{}};self.exports=self.module.exports;importScripts(file);modules.set(file,self.module.exports);}
delete self.module;delete self.exports;
self.onmessage=async event=>{
 let repository;
 try{
  const {action,input,requestId}=event.data;
  if(action==='SUPPLY_SNAPSHOT'){if(!['OUTBOUND','JOINT'].includes(input?.kind)||!Array.isArray(input.args))throw new Error('WORKER_ACTION_INVALID');const service=modules.get(input.kind==='JOINT'?'supply-chain-v5-results-v19.js':'supply-chain-report-v19.js');const result=service.createSnapshot(...input.args);self.postMessage({type:'RESULT',requestId,result});return;}
  if(!['INSPECT','INSPECT_TYPED','IMPORT'].includes(action))throw new Error('WORKER_ACTION_INVALID');
  self.postMessage({type:'STAGE',requestId,stage:'VERIFYING',cancellable:true});
  repository=modules.get('platform-repository-v19.js').createRepository();
  const service=modules.get('platform-study-service-v19.js').createService(repository,{onStage:stage=>self.postMessage({type:'STAGE',requestId,stage,cancellable:stage!=='COMMITTING'})});
  const result=action==='INSPECT_TYPED'?modules.get('platform-study-kind-registry-v8.js').createRegistry({repository,legacyService:service,context:{}}).inspectPackage(input):action==='INSPECT'?service.inspectPackage(input):await service.importPackage(input);
  self.postMessage({type:'RESULT',requestId,result});
 }catch(error){self.postMessage({type:'ERROR',requestId:event.data?.requestId,code:error.code||error.message});}
 finally{repository?.close();}
};
