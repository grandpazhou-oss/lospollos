(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Import:require('./supply-chain-import-v19.js'),Design:require('./supply-chain-design-v19.js'),Report:require('./supply-chain-report-v19.js'),Joint:require('./supply-chain-joint-v19.js'),V5:require('./supply-chain-v5-results-v19.js')}:{Import:ns.supplyChainImport,Design:ns.supplyChainDesign,Report:ns.supplyChainReport,Joint:ns.supplyChainJoint,V5:ns.supplyChainV5Results});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.supplyChainController=api;
})(globalThis,function(dependencies){
  'use strict';
  const {Import,Design,Report,Joint,V5}=dependencies;
  const clone=value=>structuredClone(value);
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  function createController(options={}){
    const repository=options.repository,fetchValue=options.fetch||globalThis.fetch,endpoint=options.endpoint||globalThis.STCT_CONFIG?.facilityOptimizerApiUrl||'http://127.0.0.1:8787/facility-optimize-v19';
    let state={status:'EMPTY',workbook:null,profile:null,imported:null,study:null,baseline:null,scenario:null,candidates:[],planningReference:null,jointRequest:null,solverRuns:[],snapshot:null,staleResult:null,savedPointer:null,lastError:null,job:null,backendIdentity:null};
    let revision=0,activeRun=null,activeComparison=null,jobSupport=false,serviceIdentity=null;
    let packageExportCache=null;
    const resumeKey='STCT_SUPPLY_JOB_V6';
    try{const previous=globalThis.sessionStorage?.getItem(resumeKey);if(previous){const saved=JSON.parse(previous);globalThis.sessionStorage.removeItem(resumeKey);state.status='INTERRUPTED';state.lastError={code:'SUPPLY_RUN_INTERRUPTED',detail:{jobId:saved.jobId}};if(saved.base&&saved.jobId)fetchValue(`${saved.base}/${saved.jobId}/cancel`,{method:'POST'}).catch(()=>{});}}catch(_){}
    state=Design.deepFreeze(state);
    const snapshot=()=>clone(state),viewState=()=>state,set=patch=>(state=Design.deepFreeze({...state,...patch}),state);
    const terminal=new Set(['COMPLETE','PARTIAL','CANCELLED','FAILED']);
    const clearResume=jobId=>{try{const saved=JSON.parse(globalThis.sessionStorage?.getItem(resumeKey)||'null');if(!jobId||saved?.jobId===jobId)globalThis.sessionStorage?.removeItem(resumeKey);}catch(_){};};
    async function jsonRequest(url,init={},timeoutMs=10000){
      const abort=new AbortController();let timer;
      try{return await Promise.race([(async()=>{const response=await fetchValue(url,{...init,signal:abort.signal});return {response,body:await response.json()};})(),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Object.assign(new Error('SUPPLY_JOB_CONNECTION_TIMEOUT'),{code:'SUPPLY_JOB_CONNECTION_TIMEOUT'}));},Math.max(1,timeoutMs));})]);}
      finally{clearTimeout(timer);}
    }
    const cancelDetached=jobId=>jobId?jsonRequest(`${jobBase()}/${jobId}/cancel`,{method:'POST'},2000).catch(()=>{}):Promise.resolve();
    function advance(){const jobId=state.job?.jobId;revision++;activeRun=null;activeComparison?.abort();activeComparison=null;clearResume(jobId);if(jobId&&!terminal.has(state.job.status))void cancelDetached(jobId);return revision;}
    const checkRevision=expected=>{if(revision!==expected)fail('SUPPLY_RUN_OBSOLETE');};
    const expired=reason=>state.snapshot?{snapshotHash:state.snapshot.snapshotHash,studyHash:state.snapshot.studyHash,reason}:state.staleResult;
    function inspect(bytes,fileName){const workbook=Import.inspectWorkbook(bytes,fileName);advance();return set({job:null,workbook,profile:null,imported:null,study:null,baseline:null,scenario:null,candidates:[],planningReference:null,jointRequest:null,solverRuns:[],snapshot:null,staleResult:null,savedPointer:null,status:'WORKBOOK_READY',lastError:null});}
    function applyProfile(profile,context={}){if(!state.workbook)fail('SUPPLY_WORKBOOK_REQUIRED');const imported=Import.applyProfile(state.workbook,profile);const study=Design.createStudy({...imported,...context,studyId:context.studyId||`SUPPLY-${Date.now()}`,sourceRefs:[state.workbook.fileName],classification:context.classification||'BUSINESS_PRIVATE'});advance();return set({job:null,profile:clone(profile),imported,study,baseline:null,scenario:null,candidates:[],planningReference:null,jointRequest:null,solverRuns:[],snapshot:null,staleResult:null,savedPointer:null,status:'STUDY_READY',lastError:null});}
    function loadStudy(input,profile=null,staleResult=null){const study=Design.createStudy(input);advance();return set({job:null,profile:clone(profile),study,baseline:null,scenario:null,candidates:[],planningReference:null,jointRequest:null,solverRuns:[],snapshot:null,staleResult:clone(staleResult),savedPointer:null,status:'STUDY_READY',lastError:null});}
    function updateStudy(patch){if(!state.study)fail('SUPPLY_STUDY_REQUIRED');const study=Design.createStudy({...state.study,...clone(patch)});advance();return set({job:null,study,baseline:null,candidates:[],planningReference:null,jointRequest:null,solverRuns:[],staleResult:expired('STUDY_INPUT_CHANGED'),snapshot:null,status:'STUDY_READY',lastError:null});}
    function calculateBaseline(distanceBasis='VERIFIED_ROAD'){if(!state.study)fail('SUPPLY_STUDY_REQUIRED');const baseline=Design.evaluatePortfolio(state.study,{type:'OBSERVED_BASELINE',distanceBasis});advance();return set({job:null,baseline,candidates:[],planningReference:null,jointRequest:null,staleResult:expired('BASELINE_RECALCULATED'),snapshot:null,status:'BASELINE_READY',lastError:null});}
    function configureScenario(scenario){if(!state.study)fail('SUPPLY_STUDY_REQUIRED');const sameId=String(scenario.scenarioId||'CANDIDATE'),remaining=state.candidates.filter(row=>row.scenarioId!==sameId&&!row.scenarioId.startsWith(`${sameId}-`));advance();return set({job:null,scenario:clone(scenario),candidates:remaining,planningReference:null,jointRequest:null,solverRuns:state.solverRuns.filter(row=>row.scenarioId!==sameId),staleResult:expired('SCENARIO_CHANGED'),snapshot:null,status:'SCENARIO_READY',lastError:null});}
    async function runJoint(study,scenario,startedRevision){
      const url=endpoint.replace(/\/facility-optimize-v19(?:\?.*)?$/,'/supply-chain-optimize-v19');
      if(url===endpoint)fail('SUPPLY_JOINT_ENDPOINT_UNAVAILABLE');
      const send=async request=>{if(request.payload.schemaVersion.endsWith('-v2')&&!serviceIdentity?.capabilities?.includes('QUANTITY_SCALE_V2'))fail('SUPPLY_QUANTITY_PROTOCOL_UNSUPPORTED');const {response,body}=await jsonRequest(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.payload)},(Number(scenario.runBudgetSeconds||scenario.timeLimitSeconds)||30)*1000+5000);if(revision!==startedRevision)fail('SUPPLY_RUN_OBSOLETE');if(!response.ok)fail(body.error?.code||'SUPPLY_SOLVER_FAILED',body.error?.details||{});return{body,verified:Joint.verify(study,scenario,request,body)};};
      const runs=[];let planningReference=null;
      if(scenario.analysisScope==='FULL_CHAIN'){
        const request=Joint.buildRequest(study,scenario,{reference:true}),solved=await send(request);
        runs.push({type:'PLANNING_REFERENCE',scenarioId:scenario.scenarioId,requestId:request.payload.requestId,engine:solved.body.engine,attempted:solved.body.attempted,feasible:solved.body.feasible,timedOut:solved.body.timedOut,results:solved.body.results.map(row=>({status:row.status,facilityCount:row.facilityCount,objectiveValue:row.objectiveValue??null,solveTimeMs:row.solveTimeMs??null}))});
        if(solved.verified.length)planningReference=V5.fromVerified(study,scenario,request,solved.verified[0],0);
      }
      const request=Joint.buildRequest(study,scenario),solved=await send(request),candidates=solved.verified.map((row,index)=>V5.fromVerified(study,scenario,request,row,index+1));
      runs.push({type:'CANDIDATES',scenarioId:scenario.scenarioId,requestId:request.payload.requestId,engine:solved.body.engine,attempted:solved.body.attempted,feasible:solved.body.feasible,timedOut:solved.body.timedOut,candidateSetComplete:solved.body.candidateSetComplete,results:solved.body.results.map(row=>({status:row.status,facilityCount:row.facilityCount,objectiveValue:row.objectiveValue??null,solveTimeMs:row.solveTimeMs??null}))});
      return set({candidates,planningReference,jointRequest:request,solverRuns:runs,staleResult:expired('CANDIDATES_CHANGED'),snapshot:null,status:'CANDIDATES_READY'});
    }
    const jobBase=()=>endpoint.replace(/\/facility-optimize-v19(?:\?.*)?$/,'/supply-chain-jobs-v6');
    const jobSummary=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='results'));
    async function cancel(){
      if(activeComparison){activeComparison.abort();activeComparison=null;return set({status:'CANCELLED'});}
      const jobId=state.job?.jobId,startedRevision=revision;
      if(!jobId)return snapshot();
      const {response,body}=await jsonRequest(`${jobBase()}/${jobId}/cancel`,{method:'POST'});
      if(revision!==startedRevision||state.job?.jobId!==jobId)return snapshot();
      if(!response.ok)fail(body.error?.code||'SUPPLY_JOB_CANCEL_FAILED');
      if(body.jobId!==jobId||!terminal.has(body.status))fail('SUPPLY_JOB_PROTOCOL_INVALID');
      clearResume(jobId);
      return set({job:jobSummary(body),...(body.status==='CANCELLED'?{status:'CANCELLED'}:{})});
    }
    async function runViaJob(study,scenario,startedRevision,onProgress,runStartedAt){
      const joint=['UPSTREAM_ONLY','FULL_CHAIN'].includes(scenario.analysisScope);
      let reference=joint&&scenario.analysisScope==='FULL_CHAIN'?Joint.buildRequest(study,scenario,{reference:true}):null;
      let request=joint?Joint.buildRequest(study,scenario):Design.solverRequest(study,scenario);
      if(reference&&(reference.payload.quantityScale||10000)!==(request.payload.quantityScale||10000))fail('SUPPLY_QUANTITY_PRECISION_MISMATCH');
      if(joint&&request.payload.schemaVersion.endsWith('-v2')&&!serviceIdentity?.capabilities?.includes('QUANTITY_SCALE_V2'))fail('SUPPLY_QUANTITY_PROTOCOL_UNSUPPORTED');
      let requests=[...(reference?[{kind:'JOINT',phase:'PLANNING_REFERENCE',payload:reference.payload}]:[]),{kind:joint?'JOINT':'FACILITY',phase:'CANDIDATES',payload:request.payload}];
      const declaredBudgetSeconds=Math.min(300,Math.max(1,Number(scenario.runBudgetSeconds||scenario.timeLimitSeconds||30)));
      const preparationSeconds=runStartedAt==null?0:Math.max(0,(performance.now()-runStartedAt)/1000);
      const budgetSeconds=declaredBudgetSeconds-preparationSeconds;
      if(budgetSeconds<1)fail('SUPPLY_RUN_BUDGET_EXHAUSTED',{preparationSeconds,declaredBudgetSeconds});
      const identity={schemaVersion:'stct-supply-chain-run-v6',studyHash:study.inputHash,scenarioHash:Design.hash(scenario),modelVersion:'v6-cp-sat-1',declaredBudgetSeconds,requests:requests.map(row=>({kind:row.kind,phase:row.phase,payload:JSON.parse(JSON.stringify({...row.payload,requestId:null}))}))};
      const runSpecHash=Design.hash(identity);
      request={...request,payload:{...request.payload,requestId:`${runSpecHash}:CANDIDATES`}};
      if(reference)reference={...reference,payload:{...reference.payload,requestId:`${runSpecHash}:PLANNING_REFERENCE`}};
      requests=[...(reference?[{kind:'JOINT',phase:'PLANNING_REFERENCE',payload:reference.payload}]:[]),{kind:joint?'JOINT':'FACILITY',phase:'CANDIDATES',payload:request.payload}];
      const spec={schemaVersion:identity.schemaVersion,studyHash:identity.studyHash,scenarioHash:identity.scenarioHash,modelVersion:identity.modelVersion,declaredBudgetSeconds,preparationSeconds,budgetSeconds,runSpecHash,requests};
      const deadline=performance.now()+budgetSeconds*1000+5000;
      const {response:started,body:created}=await jsonRequest(jobBase(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(spec)},Math.min(10000,deadline-performance.now()));
      if(revision!==startedRevision){await cancelDetached(created.jobId);fail('SUPPLY_RUN_OBSOLETE');}
      if(!started.ok)fail(created.error?.code||'SUPPLY_JOB_START_FAILED');
      const checkJob=value=>{if(!value||value.jobId!==created.jobId||value.runSpecHash!==spec.runSpecHash||value.studyHash!==study.inputHash||value.backendInstanceId!==serviceIdentity?.instanceId||value.backendBuildFingerprint!==serviceIdentity?.buildFingerprint||value.completedAt&&!terminal.has(value.status)||!['PREPARING','SOLVING','VERIFYING',...terminal].includes(value.status))fail('SUPPLY_JOB_PROTOCOL_INVALID');};
      if(!created.jobId)fail('SUPPLY_JOB_PROTOCOL_INVALID');try{checkJob(created);}catch(error){await cancelDetached(created.jobId);throw error;}
      try{globalThis.sessionStorage?.setItem(resumeKey,JSON.stringify({jobId:created.jobId,base:jobBase()}));}catch(_){}
      set({job:jobSummary(created)});if(onProgress)onProgress(created);
      let job=created;
      try{
        while(!terminal.has(job.status)){
          if(performance.now()>=deadline)fail('SUPPLY_RUN_DEADLINE_EXCEEDED');
          await new Promise(resolve=>setTimeout(resolve,250));checkRevision(startedRevision);
          const {response,body}=await jsonRequest(`${jobBase()}/${created.jobId}`,{},Math.min(10000,deadline-performance.now()));
          checkRevision(startedRevision);if(!response.ok)fail(body.error?.code||'SUPPLY_JOB_STATUS_FAILED');checkJob(body);
          job=body;set({job:jobSummary(job)});if(onProgress)onProgress(job);
        }
        checkRevision(startedRevision);
        const {response:finalResponse,body:finalJob}=await jsonRequest(`${jobBase()}/${created.jobId}?results=1`,{},Math.min(10000,deadline-performance.now()));
        checkRevision(startedRevision);if(!finalResponse.ok)fail(finalJob.error?.code||'SUPPLY_JOB_RESULT_FAILED');checkJob(finalJob);
        if(!terminal.has(finalJob.status))fail('SUPPLY_JOB_PROTOCOL_INVALID');job=finalJob;
      }catch(error){await cancelDetached(created.jobId);throw error;}
      finally{clearResume(created.jobId);}
      if(job.status==='FAILED')fail(job.error?.code||'SUPPLY_JOB_FAILED',job.error?.detail||{});
      if(job.status==='CANCELLED'&&!Object.keys(job.results||{}).length)fail('SUPPLY_RUN_CANCELLED');
      const runs=[];let planningReference=null,candidates=[];
      if(reference&&job.results?.PLANNING_REFERENCE){
        const body=job.results.PLANNING_REFERENCE,verified=Joint.verify(study,scenario,reference,body);
        runs.push({type:'PLANNING_REFERENCE',scenarioId:scenario.scenarioId,requestId:reference.payload.requestId,engine:body.engine,attempted:body.attempted,feasible:body.feasible,timedOut:body.timedOut,candidateSetComplete:body.candidateSetComplete,countCoverage:body.countCoverage,results:body.results.map(row=>({status:row.status,facilityCount:row.facilityCount,objectiveValue:row.objectiveValue??null,solveTimeMs:row.solveTimeMs??null}))});
        if(verified.length)planningReference=V5.fromVerified(study,scenario,reference,verified[0],0);
      }
      if(job.results?.CANDIDATES){
        const body=job.results.CANDIDATES;
        candidates=joint?Joint.verify(study,scenario,request,body).map((row,index)=>V5.fromVerified(study,scenario,request,row,index+1)):Design.candidateResults(study,scenario,body);
        runs.push({type:'CANDIDATES',scenarioId:scenario.scenarioId,requestId:request.payload.requestId,engine:body.engine??null,attempted:body.attempted??null,feasible:body.feasible??null,timedOut:body.timedOut??null,candidateSetComplete:body.candidateSetComplete??null,countCoverage:body.countCoverage??null,results:body.results.map(row=>({status:row.status,facilityCount:row.facilityCount??null,objectiveValue:row.objectiveValue??null,solveTimeMs:row.solveTimeMs??null}))});
      }
      if(!candidates.length&&job.status==='CANCELLED')fail('SUPPLY_RUN_CANCELLED');
      return set({candidates,planningReference,jointRequest:joint?request:null,solverRuns:runs,job:jobSummary(job),backendIdentity:{...serviceIdentity,runSpecHash:spec.runSpecHash},staleResult:expired('CANDIDATES_CHANGED'),snapshot:null,status:job.status==='COMPLETE'?'CANDIDATES_READY':'PARTIAL_READY'});
    }
    async function run(options={}){
      if(!state.study||!state.scenario)fail('SUPPLY_STUDY_AND_SCENARIO_REQUIRED');
      if(activeRun)fail('SUPPLY_SOLVER_ALREADY_RUNNING');
      const study=state.study,scenario=clone(state.scenario),joint=['UPSTREAM_ONLY','FULL_CHAIN'].includes(scenario.analysisScope),request=joint?null:Design.solverRequest(study,scenario),startedRevision=revision;
      const runToken={revision:startedRevision};activeRun=runToken;set({status:'SOLVING',lastError:null,job:null});
      try{
        const service=await health(scenario.analysisScope);checkRevision(startedRevision);
        if(!service.available)fail('SUPPLY_SERVICE_INCOMPATIBLE',{endpoint,reason:service.reason||service.error||'UNAVAILABLE'});
        if(jobSupport)return await runViaJob(study,scenario,startedRevision,options.onProgress,options.startedAt);
        if(joint)return await runJoint(study,scenario,startedRevision);
        const {response,body}=await jsonRequest(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.payload)},(Number(scenario.runBudgetSeconds||scenario.timeLimitSeconds)||30)*1000+5000);
        if(revision!==startedRevision)fail('SUPPLY_RUN_OBSOLETE');
        if(!response.ok)fail(body.error?.code||'SUPPLY_SOLVER_FAILED',body.error?.details||{});
        if(body.requestId!==request.payload.requestId||body.studyHash!==study.inputHash)fail('SUPPLY_SOLVER_RESPONSE_MISMATCH');
        const generated=Design.candidateResults(study,scenario,body),byId=new Map(state.candidates.map(row=>[row.scenarioId,row]));
        for(const row of generated)byId.set(row.scenarioId,row);
        const log={scenarioId:scenario.scenarioId||'CANDIDATE',requestId:body.requestId,engine:body.engine,objective:request.objective,distanceBasis:request.distanceBasis,results:[...(body.results||[]),...(body.currentBaseline?[body.currentBaseline]:[])].map(row=>({facilityCount:row.facilityCount,rank:row.rank,status:row.status,reasonCode:row.reasonCode||null,solveTimeMs:row.solveTimeMs??null,relativeGap:row.relativeGap??null,objectiveValue:row.objectiveValue??null}))};
        return set({candidates:[...byId.values()],solverRuns:[...state.solverRuns.filter(row=>row.scenarioId!==log.scenarioId),log],backendIdentity:serviceIdentity,staleResult:expired('CANDIDATES_CHANGED'),snapshot:null,status:'CANDIDATES_READY'});
      }catch(error){if(revision===startedRevision&&activeRun===runToken)set({status:error.code==='SUPPLY_RUN_CANCELLED'?'CANCELLED':'FAILED',lastError:{code:error.code||'SUPPLY_SOLVER_FAILED',detail:error.detail||null}});throw error;}
      finally{if(activeRun===runToken)activeRun=null;}
    }
    function evaluateConfigured(assignments){if(!state.study||!state.scenario)fail('SUPPLY_STUDY_AND_SCENARIO_REQUIRED');const candidate=Design.evaluatePortfolio(state.study,state.scenario,assignments),byId=new Map(state.candidates.map(row=>[row.scenarioId,row]));byId.set(candidate.scenarioId,candidate);return set({candidates:[...byId.values()],staleResult:expired('CANDIDATES_CHANGED'),snapshot:null,status:'CANDIDATES_READY'});}
    function compare(){if(!state.study||!state.baseline)fail('SUPPLY_BASELINE_REQUIRED');const joint=['UPSTREAM_ONLY','FULL_CHAIN'].includes(state.scenario?.analysisScope);if(joint&&!state.jointRequest)fail('SUPPLY_JOINT_SOLVE_REQUIRED');const report=joint?V5.createSnapshot(state.study,state.baseline,state.scenario,state.planningReference,state.candidates,state.solverRuns,state.jointRequest,state.backendIdentity):Report.createSnapshot(state.study,state.baseline,state.candidates,state.solverRuns,state.scenario,state.backendIdentity);return set({snapshot:report,staleResult:null,status:'SNAPSHOT_READY'});}
    async function compareAsync(){
      if(!state.study||!state.baseline)fail('SUPPLY_BASELINE_REQUIRED');
      const startedRevision=revision,{study,baseline,scenario,planningReference,candidates,solverRuns,jointRequest}=state,joint=['UPSTREAM_ONLY','FULL_CHAIN'].includes(scenario?.analysisScope);
      if(joint&&!jointRequest)fail('SUPPLY_JOINT_SOLVE_REQUIRED');
      const abort=new AbortController();activeComparison?.abort();activeComparison=abort;set({status:'VERIFYING'});
      try{const report=await (joint?V5:Report).createSnapshotAsync(joint?[study,baseline,scenario,planningReference,candidates,solverRuns,jointRequest,state.backendIdentity]:[study,baseline,candidates,solverRuns,scenario,state.backendIdentity],abort.signal);checkRevision(startedRevision);if(abort.signal.aborted)fail('SUPPLY_RUN_CANCELLED');return set({snapshot:report,staleResult:null,status:'SNAPSHOT_READY'});}
      catch(error){if(revision===startedRevision&&activeComparison===abort)set({status:error.code==='SUPPLY_RUN_CANCELLED'?'CANCELLED':'FAILED',lastError:{code:error.code||'SUPPLY_SNAPSHOT_FAILED'}});throw error;}
      finally{if(activeComparison===abort)activeComparison=null;}
    }
    async function saveProfile(){if(!repository||!state.profile)fail('SUPPLY_PROFILE_NOT_READY');const profile=clone(state.profile),recordId=Design.hash(profile),pointerId=`SUPPLY_PROFILE:${profile.profileId||recordId}`,old=await repository.read('pointers',pointerId),pointer={id:pointerId,scope:'DESIGN',type:'SUPPLY_IMPORT_PROFILE',name:profile.profileId||'Import Mapping Profile',route:'/design/supply-chain-study',refs:[{store:'supplyProfiles',id:recordId}]};return repository.commit({records:{supplyProfiles:[repository.record(recordId,profile)]},pointer,expectedRevision:old?.revision||0,action:'SAVE_SUPPLY_PROFILE'});}
    async function listProfiles(){if(!repository)fail('SUPPLY_REPOSITORY_REQUIRED');return(await repository.read('pointers')).filter(row=>row.type==='SUPPLY_IMPORT_PROFILE');}
    async function listStudies(){if(!repository)fail('SUPPLY_REPOSITORY_REQUIRED');return(await repository.read('pointers')).filter(row=>row.type==='SUPPLY_CHAIN_STUDY');}
    async function getProfile(pointerId){if(!repository)fail('SUPPLY_REPOSITORY_REQUIRED');const pointer=await repository.read('pointers',pointerId),ref=pointer?.refs?.find(row=>row.store==='supplyProfiles');if(!ref)fail('SUPPLY_PROFILE_NOT_FOUND');const record=await repository.read('supplyProfiles',ref.id);if(!record||Design.hash(record.payload)!==record.contentHash)fail('SUPPLY_PROFILE_HASH_INVALID');return clone(record.payload);}
    async function openProfile(pointerId){const startedRevision=revision;if(!repository)fail('SUPPLY_REPOSITORY_REQUIRED');const pointer=await repository.read('pointers',pointerId),ref=pointer?.refs?.find(row=>row.store==='supplyProfiles');if(!ref)fail('SUPPLY_PROFILE_NOT_FOUND');const record=await repository.read('supplyProfiles',ref.id);if(!record||Design.hash(record.payload)!==record.contentHash)fail('SUPPLY_PROFILE_HASH_INVALID');checkRevision(startedRevision);return set({profile:record.payload});}
    async function health(scope='OUTBOUND_ONLY'){try{const {response,body}=await jsonRequest(endpoint.replace(/\/facility-optimize-v19(?:\?.*)?$/,'/health'),{method:'GET'},5000);const required=['FACILITY','SUPPLY_CHAIN_JOBS_V6',...(['UPSTREAM_ONLY','FULL_CHAIN'].includes(scope)?[scope]:[])],missing=required.filter(value=>!body.capabilities?.includes(value)),protocol=body.protocolVersion==='stct-supply-chain-jobs-v6'&&body.modelVersion==='v6-cp-sat-1',actualEndpoint=body.endpoint===new URL(endpoint).origin,identity=Boolean(body.instanceId&&body.startedAt&&/^[a-f0-9]{64}$/.test(body.buildFingerprint||'')),ready=Boolean(response.ok&&body.available&&body.dependencies?.supplyChainReady&&protocol&&actualEndpoint&&identity&&!missing.length);jobSupport=ready&&body.supplyChainJobsV6===true;const expected=options.expectedBuildFingerprint||globalThis.STCT_CONFIG?.expectedOptimizerBuildFingerprint||null,buildMatch=!expected||expected===body.buildFingerprint;serviceIdentity=ready?{endpoint,instanceId:body.instanceId,startedAt:body.startedAt,buildFingerprint:body.buildFingerprint,protocolVersion:body.protocolVersion,modelVersion:body.modelVersion,capabilities:body.capabilities,buildMatch}:null;return{available:ready&&jobSupport,endpoint,actualEndpoint:body.endpoint||null,instanceId:body.instanceId||null,startedAt:body.startedAt||null,buildFingerprint:body.buildFingerprint||null,protocolVersion:body.protocolVersion||null,modelVersion:body.modelVersion||null,capabilities:body.capabilities||[],dependencies:body.dependencies||null,buildMatch,compatibility:ready&&jobSupport?(buildMatch?'COMPATIBLE':'COMPATIBLE_BUILD_DIFFERS'):'INCOMPATIBLE',reason:!response.ok?'HTTP_ERROR':!body.available?'DEPENDENCY_UNAVAILABLE':!protocol?'PROTOCOL_OR_MODEL_MISMATCH':!actualEndpoint?'ENDPOINT_MISMATCH':!identity?'INSTANCE_IDENTITY_MISSING':missing.length?`MISSING_CAPABILITY:${missing.join(',')}`:!jobSupport?'JOBS_UNAVAILABLE':null,jobsV6:jobSupport};}catch(error){jobSupport=false;serviceIdentity=null;return{available:false,endpoint,compatibility:'INCOMPATIBLE',error:error.message};}}
    async function save(){
      if(!repository||!state.study)fail('SUPPLY_STUDY_REQUIRED');
      const savedRevision=revision,study=state.study,profile=state.profile,scenario=state.scenario,snapshotValue=state.snapshot,staleResult=state.staleResult;
      if(snapshotValue)(snapshotValue.schemaVersion==='stct-supply-chain-v5-snapshot-v1'?V5:Report).assertCurrent(study,snapshotValue);
      const studyId=study.inputHash,records={supplyStudies:[repository.record(studyId,study)]},refs=[{store:'supplyStudies',id:studyId}];
      if(snapshotValue){const snapshotId=snapshotValue.snapshotHash;records.supplySnapshots=[repository.record(snapshotId,snapshotValue)];refs.push({store:'supplySnapshots',id:snapshotId});}
      if(profile){const profileId=Design.hash(profile);records.supplyProfiles=[repository.record(profileId,profile)];refs.push({store:'supplyProfiles',id:profileId});}
      const pointerId=`SUPPLY:${study.studyId}`,old=await repository.read('pointers',pointerId);
      const expectedRevision=state.savedPointer?.id===pointerId?state.savedPointer.revision:0;
      if((old?.revision||0)!==expectedRevision)fail('REVISION_CONFLICT',{expected:expectedRevision,current:old?.revision||0});
      const historySnapshotHashes=[...new Set([...(old?.historySnapshotHashes||[]),...(old?.snapshotHash&&old.snapshotHash!==snapshotValue?.snapshotHash?[old.snapshotHash]:[])])];
      for(const id of historySnapshotHashes)refs.push({store:'supplySnapshots',id});
      const pointer={id:pointerId,scope:'DESIGN',type:'SUPPLY_CHAIN_STUDY',name:state.savedPointer?.inputHash===studyId?state.savedPointer.name:study.name,projectId:state.savedPointer?.projectId||`PROJECT:${study.assumptions?.demandGrowth?.rootStudyId||study.assumptions?.demandGrowth?.parentStudyId||study.studyId}`,route:'/design/supply-chain-study',inputHash:studyId,snapshotHash:snapshotValue?.snapshotHash||null,historySnapshotHashes,status:snapshotValue?'COMPLETE':'DRAFT',scenario:clone(scenario),staleResult:clone(staleResult),refs};
      if(revision!==savedRevision)fail('SUPPLY_SAVE_OBSOLETE');
      const saved=await repository.commit({records,pointer,expectedRevision,action:snapshotValue?'SAVE_SUPPLY_STUDY':'SAVE_SUPPLY_DRAFT'});
      if(revision===savedRevision&&state.study?.inputHash===studyId&&JSON.stringify(state.scenario)===JSON.stringify(scenario)&&state.snapshot?.snapshotHash===snapshotValue?.snapshotHash)set({savedPointer:saved.pointer});
      return saved;
    }
    async function reopen(pointerId){
      if(!repository)fail('SUPPLY_REPOSITORY_REQUIRED');
      const startedRevision=advance();
      const pointer=await repository.read('pointers',pointerId),refs=pointer?.refs||[],idFor=store=>refs.find(row=>row.store===store)?.id;
      if(pointer?.type!=='SUPPLY_CHAIN_STUDY')fail('SUPPLY_POINTER_INVALID');
      const [studyRecord,snapshotRecord,profileRecord]=await Promise.all([repository.read('supplyStudies',idFor('supplyStudies')),pointer.snapshotHash?repository.read('supplySnapshots',pointer.snapshotHash):null,idFor('supplyProfiles')?repository.read('supplyProfiles',idFor('supplyProfiles')):null]);
      if(!studyRecord||studyRecord.contentHash!==Design.hash(studyRecord.payload)||snapshotRecord&&snapshotRecord.contentHash!==Design.hash(snapshotRecord.payload)||profileRecord&&profileRecord.contentHash!==Design.hash(profileRecord.payload))fail('SUPPLY_SAVED_GRAPH_INVALID');
      const study=Design.createStudy(studyRecord.payload);
      if(pointer.snapshotHash&&!snapshotRecord)fail('SUPPLY_SAVED_GRAPH_INVALID');
      if(snapshotRecord)(snapshotRecord.payload.schemaVersion==='stct-supply-chain-v5-snapshot-v1'?V5:Report).assertCurrent(study,snapshotRecord.payload);
      checkRevision(startedRevision);
      return set({job:null,lastError:null,workbook:null,imported:null,study,scenario:clone(pointer.scenario||null),baseline:snapshotRecord?.payload.baseline||null,candidates:snapshotRecord?.payload.rows.map(row=>row.result||row)||[],planningReference:snapshotRecord?.payload.planningReference||null,jointRequest:null,solverRuns:snapshotRecord?.payload.solverRuns||[],snapshot:snapshotRecord?.payload||null,staleResult:snapshotRecord?null:clone(pointer.staleResult||null),profile:profileRecord?.payload||null,savedPointer:pointer,status:snapshotRecord?'SNAPSHOT_READY':'STUDY_READY'});
    }
    function exportPackage(){if(!state.study||!state.snapshot)fail('SUPPLY_SNAPSHOT_NOT_READY');if(packageExportCache?.study===state.study&&packageExportCache.profile===state.profile&&packageExportCache.snapshot===state.snapshot)return packageExportCache.text;(state.snapshot.schemaVersion==='stct-supply-chain-v5-snapshot-v1'?V5:Report).assertCurrent(state.study,state.snapshot);const value={schemaVersion:'stct-supply-chain-package-v1.9',study:state.study,profile:state.profile,snapshot:state.snapshot};value.packageHash=Design.hash(value);const text=JSON.stringify(value,null,2)+'\n';packageExportCache={study:state.study,profile:state.profile,snapshot:state.snapshot,text};return text;}
    function exportDraftPackage(){if(!state.study)fail('SUPPLY_STUDY_REQUIRED');Design.assertStudyCurrent(state.study);const value={schemaVersion:'stct-supply-chain-draft-v1',study:state.study,profile:state.profile,scenario:state.scenario,staleResult:state.staleResult};value.packageHash=Design.hash(value);return JSON.stringify(value,null,2)+'\n';}
    function importPackage(value){const packageValue=typeof value==='string'?JSON.parse(value):clone(value);if(!['stct-supply-chain-package-v1.9','stct-supply-chain-draft-v1'].includes(packageValue?.schemaVersion)||packageValue.packageHash!==Design.hash(Object.fromEntries(Object.entries(packageValue).filter(([key])=>key!=='packageHash'))))fail('SUPPLY_PACKAGE_INVALID');const study=Design.createStudy(packageValue.study);if(packageValue.schemaVersion==='stct-supply-chain-draft-v1'){advance();return set({job:null,lastError:null,workbook:null,imported:null,scenario:clone(packageValue.scenario||null),study,profile:packageValue.profile||null,baseline:null,candidates:[],planningReference:null,jointRequest:null,solverRuns:[],snapshot:null,staleResult:clone(packageValue.staleResult||null),status:'STUDY_READY',savedPointer:null});}(packageValue.snapshot.schemaVersion==='stct-supply-chain-v5-snapshot-v1'?V5:Report).assertCurrent(study,packageValue.snapshot);advance();return set({job:null,lastError:null,workbook:null,imported:null,scenario:clone(packageValue.snapshot.scenario||packageValue.snapshot.comparisonConfig||null),study,profile:packageValue.profile||null,baseline:packageValue.snapshot.baseline,candidates:packageValue.snapshot.rows.map(row=>row.result||row),planningReference:packageValue.snapshot.planningReference||null,jointRequest:null,solverRuns:packageValue.snapshot.solverRuns||[],snapshot:packageValue.snapshot,staleResult:null,status:'SNAPSHOT_READY',savedPointer:null});}
    function exportReport(format,locale='zh'){if(!state.study||!state.snapshot)fail('SUPPLY_SNAPSHOT_NOT_READY');const service=state.snapshot.schemaVersion==='stct-supply-chain-v5-snapshot-v1'?V5:Report;return({json:service.toJson,csv:service.toCsv,'comparison-csv':service.toComparisonCsv,md:service.toMarkdown,html:service.toHtml})[format]?.(state.study,state.snapshot,locale)||fail('SUPPLY_EXPORT_FORMAT_INVALID');}
    return Object.freeze({snapshot,viewState,inspect,applyProfile,loadStudy,updateStudy,calculateBaseline,configureScenario,run,cancel,evaluateConfigured,compare,compareAsync,saveProfile,listProfiles,getProfile,openProfile,listStudies,health,save,reopen,exportPackage,exportDraftPackage,importPackage,exportReport});
  }
  return Object.freeze({createController});
});
