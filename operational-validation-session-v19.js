(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Contract:require('./network-contract-v18.js'),Envelope:require('./operational-validation-contract-v19.js'),Result:require('./operational-validation-result-v19.js')}:{Contract:root.STCTV18?.networkContract,Envelope:ns.operationalValidationContract,Result:ns.operationalValidationResult});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.operationalValidationSession=api;
})(globalThis,function({Contract,Envelope,Result}){
  const VERSION='stct-operational-validation-session-v1.9-p6';
  const TERMINAL=new Set(['RETURNED','FAILED','CANCELLED','STALE','UNSUPPORTED','MISSING_DEPENDENCY']);
  const clone=value=>structuredClone(value);
  const fail=(code)=>{throw Object.assign(new Error(code),{code});};
  function create(envelope,options={}){
    const check=Envelope.validateEnvelope(envelope);if(check.status!=='PASS')fail('OPERATIONAL_ENVELOPE_REJECTED');
    const sessionId=options.sessionId||`SESSION-${globalThis.crypto.randomUUID()}`;
    let generation=0,result=null,cancelled=false;
    const listeners=new Set(),history=[];
    let state={schemaVersion:VERSION,sessionId,sessionKind:'COMMAND_VALIDATION_SESSION',envelopeHash:envelope.envelopeHash,sourceSemanticKey:envelope.sourceSemanticKey,validationInputHash:envelope.validationInputHash,resourceProfileHash:envelope.resourceSnapshot.resourceProfileHash,status:'DRAFT',jobId:'',generation,progressStage:'DRAFT',processedEntities:0,resultRefs:[],lastError:null,sourceStudyId:envelope.sourceStudyId,sourceScenarioId:envelope.sourceScenarioId,portfolioIdentity:envelope.facilityPortfolioHash,operationalDate:envelope.operationalSlice.operationalDate};
    function transition(status,stage,detail={}){state={...state,status,progressStage:stage||status,...detail};const event={index:history.length+1,status:state.status,stage:state.progressStage,generation:state.generation,detail:clone(detail)};history.push(event);listeners.forEach(fn=>fn(snapshot(),event));return snapshot();}
    function snapshot(){return clone({...state,history,result});}
    function precheck(){if(state.status!=='DRAFT')fail('OPERATIONAL_SESSION_TRANSITION_INVALID');return transition('PRECHECKED','PRECHECKED');}
    function seal(){if(state.status!=='PRECHECKED')fail('OPERATIONAL_SESSION_TRANSITION_INVALID');transition('SEALED','SEALED');return transition('READY','READY');}
    function begin(){
      if(state.status!=='READY'&&!TERMINAL.has(state.status))fail('OPERATIONAL_SESSION_TRANSITION_INVALID');
      generation+=1;cancelled=false;const jobId=`JOB-${globalThis.crypto.randomUUID()}`;transition('RUNNING','PREPARING',{generation,jobId,processedEntities:0,lastError:null});return{sessionId,generation,jobId};
    }
    function progress(stage,callbackGeneration,processedEntities=0){if(callbackGeneration!==generation||cancelled)return{status:'REJECTED_STALE_GENERATION'};if(!['BUILDING_MATRIX','PLANNING','VERIFYING','SAVING'].includes(stage))fail('OPERATIONAL_PROGRESS_STAGE_INVALID');return transition(stage==='VERIFYING'?'VERIFYING':'RUNNING',stage,{processedEntities});}
    function accept(candidate,callbackGeneration){if(callbackGeneration!==generation||cancelled)return{status:'REJECTED_STALE_GENERATION'};const admitted=Result.admit(envelope,candidate,{sessionId,generation});result=admitted;return transition('RESULT_READY','RESULT_READY',{resultRefs:[admitted.resultHash],processedEntities:envelope.operationalScenario.orders.length});}
    function failJob(error,callbackGeneration){if(callbackGeneration!==generation||cancelled)return{status:'REJECTED_STALE_GENERATION'};return transition('FAILED','FAILED',{lastError:{code:error.code||'OPERATIONAL_VALIDATION_FAILED',message:error.message||String(error),detail:error.detail||null}});}
    async function run(runOptions={}){
      const started=begin(),active=started.generation;
      await new Promise(resolve=>(runOptions.defer||globalThis.setTimeout)(resolve,0));
      if(cancelled||active!==generation)return snapshot();
      progress('BUILDING_MATRIX',active,envelope.routingSnapshot.rows.length);
      await new Promise(resolve=>(runOptions.defer||globalThis.setTimeout)(resolve,0));
      if(cancelled||active!==generation)return snapshot();
      try{
        progress('PLANNING',active,envelope.operationalScenario.orders.length);
        const candidate=Result.execute(envelope,{sessionId,solveOptions:runOptions.solveOptions});
        if(cancelled||active!==generation)return snapshot();
        progress('VERIFYING',active,envelope.operationalScenario.orders.length);
        const admitted=Result.admit(envelope,candidate,{sessionId,generation:active});
        if(cancelled||active!==generation)return snapshot();
        result=admitted;return transition('RESULT_READY','RESULT_READY',{resultRefs:[admitted.resultHash],processedEntities:envelope.operationalScenario.orders.length});
      }catch(error){if(cancelled||active!==generation)return snapshot();failJob(error,active);throw error;}
    }
    function cancel(){if(!['RUNNING','VERIFYING'].includes(state.status))return{status:'NOT_CANCELLABLE',session:snapshot()};cancelled=true;generation+=1;transition('CANCELLED','CANCELLED',{generation,resultRefs:[],lastError:{code:'OPERATIONAL_VALIDATION_CANCELLED'}});return{status:'CANCELLED',session:snapshot()};}
    function rejectLateCallback(callbackGeneration){if(callbackGeneration!==generation)return{status:'REJECTED_STALE_GENERATION',generation};return{status:'CURRENT_GENERATION',generation};}
    function markReturned(){if(state.status!=='RESULT_READY')fail('OPERATIONAL_SESSION_TRANSITION_INVALID');return transition('RETURNED','RETURNED');}
    function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
    function dispose(){listeners.clear();cancelled=true;generation+=1;return{status:'DISPOSED',listenerCount:0};}
    transition('DRAFT','DRAFT');
    return Object.freeze({sessionId,envelope:clone(envelope),precheck,seal,begin,progress,accept,failJob,run,cancel,rejectLateCallback,markReturned,snapshot,subscribe,dispose,get result(){return clone(result);}});
  }
  function verifySnapshot(value){const issues=[];if(value?.schemaVersion!==VERSION)issues.push('SESSION_SCHEMA_INVALID');if(value?.sessionKind!=='COMMAND_VALIDATION_SESSION')issues.push('SESSION_KIND_INVALID');if(!value?.sessionId||!value?.envelopeHash||!value?.sourceSemanticKey||!value?.validationInputHash||!value?.resourceProfileHash)issues.push('SESSION_IDENTITY_MISSING');return{status:issues.length?'FAIL':'PASS',issues};}
  return Object.freeze({VERSION,create,verifySnapshot});
});
