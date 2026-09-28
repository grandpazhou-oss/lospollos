'use strict';
// Fixed local authority allowlist. User data can never select executable modules.
const files=['integrity-hash-v151.js','network-contract-v18.js','depot-assignment-v18.js','trip-chain-v18.js','pickup-custody-v18.js','dock-wave-v18.js','network-solver-v18.js','network-accounting-v18.js','operational-validation-contract-v19.js','operational-validation-result-v19.js'];
const modules=new Map();
self.require=name=>{const key=name.replace(/^\.\//,'');if(!modules.has(key))throw Object.assign(new Error('WORKER_DEPENDENCY_NOT_ALLOWED'),{code:'WORKER_DEPENDENCY_NOT_ALLOWED'});return modules.get(key);};
for(const file of files){self.module={exports:{}};self.exports=self.module.exports;importScripts(file);modules.set(file,self.module.exports);}
delete self.module;delete self.exports;
self.onmessage=event=>{
  try{
    const {action,envelope,sessionId,generation}=event.data;if(action!=='RUN_OPERATIONAL_VALIDATION')throw Object.assign(new Error('WORKER_ACTION_INVALID'),{code:'WORKER_ACTION_INVALID'});
    self.postMessage({type:'STAGE',stage:'PLANNING',generation,processedEntities:envelope.operationalScenario.orders.length});
    const Result=modules.get('operational-validation-result-v19.js'),candidate=Result.execute(envelope,{sessionId});
    self.postMessage({type:'STAGE',stage:'VERIFYING',generation,processedEntities:envelope.operationalScenario.orders.length});
    const result=Result.admit(envelope,candidate,{sessionId,generation});self.postMessage({type:'RESULT',generation,result});
  }catch(error){self.postMessage({type:'ERROR',generation:event.data.generation,code:error.code||error.message,detail:error.detail||null});}
};
