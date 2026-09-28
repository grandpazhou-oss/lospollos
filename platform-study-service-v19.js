(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Contract:require('./network-contract-v18.js'),Store:require('./design-study-store-v19.js'),Import:require('./platform-import-session-v19.js'),Data:require('./design-data-adapter-v19.js'),Context:require('./design-strategic-context-v19.js'),Envelope:require('./operational-validation-contract-v19.js'),OperationalResult:require('./operational-validation-result-v19.js'),OperationalSession:require('./operational-validation-session-v19.js'),Facility:require('./facility-location-mvp1-v19.js')}:{Contract:root.STCTV18?.networkContract,Store:ns.designStudyStore,Import:ns.importSession,Data:ns.designDataAdapter,Context:ns.designStrategicContext,Envelope:ns.operationalValidationContract,OperationalResult:ns.operationalValidationResult,OperationalSession:ns.operationalValidationSession,Facility:ns.facilityLocationMvp1});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.studyService=api;
})(globalThis,function(dependencies){
  'use strict';
  const {Contract,Store,Import,Data,Context,Envelope,OperationalResult,OperationalSession,Facility}=dependencies;
  const clone=value=>structuredClone(value);
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const TYPES=Object.freeze(['DESIGN_STUDY','DESIGN_PORTFOLIO','FACILITY_STUDY','COMMAND_PLAN','COMMAND_EXECUTION','OPERATIONAL_VALIDATION','CAPSULE','BASELINE']);
  function graphFail(code,detail){throw Object.assign(new Error(code),{code,detail});}
  function compactValidationReport(report){
    return clone({schemaVersion:'stct-dataset-validation-summary-p5.1',status:report.status,totalRecords:report.totalRecords,acceptedRecords:report.acceptedRecords,rejectedRecords:report.rejectedRecords,issueCounts:report.issueCounts||{},canonicalDataHash:report.canonicalDataHash,mappingHash:report.mappingHash,unitContextHash:report.unitContextHash,networkInputHash:report.networkInputHash,performance:report.performance||null});
  }
  function validateStudyGraph(records,pointers=[]){
    const map=new Map();
    for(const [store,rows] of Object.entries(records||{}))for(const row of rows||[])map.set(`${store}:${row.id}`,row);
    const admissions=new Map();
    for(const studyRow of records.studyVersions||[]){
      const snapshot=studyRow.payload,datasetId=snapshot.datasetVersionRefs?.[0]||snapshot.dataSource?.sourceRef;
      const dataset=map.get(`datasetVersions:${datasetId}`);
      if(!dataset){
        if(!snapshot.datasetVersionRefs?.length&&!String(datasetId||'').startsWith('DATASET-'))continue;
        graphFail('STUDY_DATASET_REFERENCE_MISSING',{studyVersionId:studyRow.id,datasetId});
      }
      const baseline=snapshot.history?.records?.[0];
      if(!baseline||baseline.inputHash!==Contract.identityBundle(dataset.payload.normalizedScenario).networkInputHash||Contract.canonicalString(baseline.scenario)!==Contract.canonicalString(dataset.payload.normalizedScenario))graphFail('STUDY_DATASET_BASELINE_MISMATCH',{studyVersionId:studyRow.id,datasetId});
      if(snapshot.dataSource?.sourceRef!==datasetId||Contract.canonicalString(snapshot.dataSource.scenario)!==Contract.canonicalString(dataset.payload.normalizedScenario))graphFail('STUDY_SOURCE_VERSION_MISMATCH',{studyVersionId:studyRow.id,datasetId});
      const byScenario=new Map(snapshot.history.records.map(row=>[row.scenarioId,row]));
      for(const [index,record] of snapshot.history.records.entries()){
        if(record.inputHash!==Contract.identityBundle(record.scenario).networkInputHash)graphFail('STUDY_INPUT_MISMATCH',{scenarioId:record.scenarioId});
        if(index&&(!record.parentScenarioId||!byScenario.has(record.parentScenarioId)||record.parentInputHash!==byScenario.get(record.parentScenarioId).inputHash||!record.changeHash))graphFail('STUDY_SCENARIO_LINEAGE_INVALID',{scenarioId:record.scenarioId});
      }
      for(const result of snapshot.results||[]){
        const record=byScenario.get(result.scenarioId);if(!record)graphFail('STUDY_RESULT_REFERENCE_MISSING',{scenarioId:result.scenarioId});
        const artifactRow=map.get(`evaluationArtifacts:${result.artifactHash}`);
        const bindingId=`${snapshot.studyId}:${result.scenarioId}:${result.artifactHash}`;
        const bindingRow=map.get(`bindings:${bindingId}`);
        if(!artifactRow||!bindingRow)graphFail('STUDY_ARTIFACT_DEPENDENCY_MISSING',{scenarioId:result.scenarioId});
        const key=`${record.inputHash}:${result.artifactHash}`;
        let admitted=admissions.get(key);
        if(!admitted){
          admitted=Context.createContext({dataSource:Data.adoptNetworkScenario(record.scenario,{sourceType:'STUDY_GRAPH_REVALIDATION',sourceRef:datasetId})}).admit(record,result);
          admissions.set(key,admitted);
        }
        if(admitted.artifactHash!==artifactRow.id||Contract.canonicalString(admitted.artifact)!==Contract.canonicalString(artifactRow.payload))graphFail('STUDY_ARTIFACT_CONTENT_MISMATCH',{scenarioId:result.scenarioId});
        if(Contract.canonicalString(admitted.binding)!==Contract.canonicalString(bindingRow.payload))graphFail('STUDY_BINDING_CONTENT_MISMATCH',{scenarioId:result.scenarioId});
      }
    }
    for(const pointer of pointers||[]){
      if(pointer.type==='SELECTION'||pointer.type==='CAPSULE')continue;
      for(const ref of pointer.refs||[])if(!map.has(`${ref.store}:${ref.id}`))graphFail('PACKAGE_REFERENCE_MISSING',{pointerId:pointer.id,ref});
    }
    return {status:'PASS',studyCount:(records.studyVersions||[]).length,artifactAdmissionCount:admissions.size};
  }
  function createService(repository,options={}){
    let saveState='CLEAN',savedStudyHash=null;
    async function saveDataset(report,options={}){
      if(!['READY','DATA_ONLY_SAVED'].includes(report.status))fail('DATASET_VALIDATION_REQUIRED');
      const existing=await repository.list('datasetVersions');
      const duplicate=existing.find(row=>Contract.hashArtifact(row.payload.source.map(source=>source.rawFileHash))===Contract.hashArtifact(report.source.map(source=>source.rawFileHash)));
      if(duplicate&&!options.duplicateAction)return{status:'DUPLICATE_CONFIRMATION_REQUIRED',existing:duplicate};
      if(duplicate&&options.duplicateAction==='REUSE')return{status:'SAVED',dataset:duplicate};
      const datasetId=options.datasetId||'DATASET-'+globalThis.crypto.randomUUID();
      const parent=options.parentVersionId?existing.find(row=>row.id===options.parentVersionId):null;
      if(options.parentVersionId&&!parent)fail('DATASET_PARENT_MISSING');
      if(parent&&parent.payload.datasetId!==datasetId)fail('DATASET_PARENT_ID_MISMATCH');
      const versionNumber=parent?parent.payload.versionNumber+1:1;
      const payload={schemaVersion:'stct-dataset-version-p5.1',datasetId,versionNumber,parentVersionId:parent?.id||null,kind:'NETWORK_DATA',scope:report.settings.scope,source:report.source.map(source=>({...source,classification:report.settings.classification})),canonicalDataHash:report.canonicalDataHash,mappingHash:report.mappingHash,unitContextHash:report.unitContextHash,totalRecords:report.totalRecords,acceptedRecords:report.acceptedRecords,rejectedRecords:report.rejectedRecords,records:clone(report.records),normalizedScenario:clone(report.normalizedScenario),conversionLedger:clone(report.conversionLedger),settings:clone(report.settings),validationReport:compactValidationReport(report)};
      const versionId=datasetId+':'+versionNumber+':'+Contract.hashArtifact(payload).slice(-12);payload.versionId=versionId;
      const record=repository.record(versionId,payload,parent?[{store:'datasetVersions',id:parent.id}]:[]);
      const pointerId='DATASET:'+datasetId;const pointer=await repository.read('pointers',pointerId);
      await repository.commit({records:{datasetVersions:[record]},pointer:{id:pointerId,scope:payload.scope,type:'DATASET',refs:[{store:'datasetVersions',id:versionId}]},expectedRevision:pointer?.revision||0,action:'SAVE_DATASET_VERSION'});
      return {status:'SAVED',dataset:record};
    }
    function createDesignStudy(dataset,options={}){
      const value=dataset.payload;
      if(value.scope==='COMMAND')fail('DATASET_SCOPE_DESIGN_REQUIRED');
      if(!value.normalizedScenario||value.validationReport.status!=='READY')fail('MISSING_REQUIRED_INPUT');
      if(value.canonicalDataHash!==Contract.hashArtifact({network:value.normalizedScenario,candidateSites:value.records.candidateSites||[],costParameters:value.records.costParameters||[]}))fail('DATASET_CANONICAL_HASH_MISMATCH');
      const dataSource={...Data.adoptNetworkScenario(value.normalizedScenario,{sourceType:'FILE_UPLOAD',sourceRef:value.versionId,facilityData:{candidateSites:clone(value.records.candidateSites||[]),costParameters:clone(value.records.costParameters||[]),observationPeriod:value.settings.observationPeriod,costPeriod:value.settings.costPeriod,currency:value.settings.currency}}),parentStudyRef:options.parent?clone(options.parent):null,staleReason:options.parent?'DATASET_VERSION_CHANGED':null};
      return Store.createStore({context:Context.createContext({dataSource}),studyId:'STUDY-'+globalThis.crypto.randomUUID(),deferBaseline:Boolean(options.parent),staleReason:options.parent?'DATASET_VERSION_CHANGED':null});
    }
    function datasetDiff(left,right){
      const a=left.payload.records,b=right.payload.records,changes=[];
      for(const [kind,idField]of Object.entries(Import.IDS)){
        const before=new Map((a[kind]||[]).map(row=>[row[idField],row])),after=new Map((b[kind]||[]).map(row=>[row[idField],row]));
        for(const [id,row]of before)if(!after.has(id))changes.push({kind,id,type:'REMOVED'});else if(Contract.hashArtifact(row)!==Contract.hashArtifact(after.get(id)))changes.push({kind,id,type:'CHANGED'});
        for(const id of after.keys())if(!before.has(id))changes.push({kind,id,type:'ADDED'});
      }
      const totals=records=>({orders:records.orders?.length||0,volume:(records.orders||[]).reduce((sum,row)=>sum+Number(row.demand?.volume||0),0),weight:(records.orders||[]).reduce((sum,row)=>sum+Number(row.demand?.weight||0),0)});
      return {from:left.id,to:right.id,changes,before:totals(a),after:totals(b)};
    }
    async function deletionImpact(store,id){
      const references=[];
      for(const collection of ['datasetVersions','studyVersions','scenarioRecords','evaluationArtifacts','bindings','pointers'])for(const row of await repository.list(collection))if((row.refs||[]).some(ref=>ref.store===store&&ref.id===id))references.push({store:collection,id:row.id});
      return {store,id,references,status:references.length?'DEPENDENCY_BLOCKED':'ARCHIVE_PREFERRED',permanentDeletionEnabled:false};
    }
    async function saveStudy(store,options={}){
      saveState='SAVING';
      try{
        const snapshot=store.exportSnapshot();
        const datasetId=snapshot.dataSource.sourceRef;
        const dataset=await repository.read('datasetVersions',datasetId);if(!dataset)fail('STUDY_DATASET_REFERENCE_MISSING');
        const active=snapshot.history.records[snapshot.history.cursor];
        const id=options.id||`DESIGN:${snapshot.studyId}:${active.scenarioId}`;
        const previous=await repository.read('pointers',id);
        const versionId=`${id}:${Contract.hashArtifact({snapshot,parentVersionId:previous?.refs.find(ref=>ref.store==='studyVersions')?.id||null,revision:(options.expectedRevision||0)+1})}`;
        snapshot.studyVersionId=versionId;snapshot.parentStudyVersionId=previous?.refs.find(ref=>ref.store==='studyVersions')?.id||null;
        snapshot.datasetVersionRefs=[datasetId];snapshot.sourceWorkspace='DESIGN';snapshot.businessSettingsSnapshot=clone({...dataset.payload.settings,accountingOptions:active.scenario.assumptions.accountingOptions||{},costNormalization:active.scenario.assumptions.costNormalization||null});
        snapshot.businessSettingsVersionRef='INLINE:'+Contract.hashArtifact(snapshot.businessSettingsSnapshot);
        const refs=[{store:'datasetVersions',id:datasetId}];if(snapshot.parentStudyVersionId)refs.push({store:'studyVersions',id:snapshot.parentStudyVersionId});
        const records={studyVersions:[repository.record(versionId,snapshot,refs)],scenarioRecords:[],evaluationArtifacts:[],bindings:[]};
        for(const record of snapshot.history.records)records.scenarioRecords.push(repository.record(`${snapshot.studyId}:${record.scenarioId}:${record.inputHash}`,record));
        for(const result of snapshot.results){
          const record=snapshot.history.records.find(row=>row.scenarioId===result.scenarioId);
          const admitted=store.context.admit(record,result);
          if(!records.evaluationArtifacts.some(row=>row.id===result.artifactHash))records.evaluationArtifacts.push(repository.record(result.artifactHash,admitted.artifact));
          records.bindings.push(repository.record(`${snapshot.studyId}:${result.scenarioId}:${result.artifactHash}`,result.binding,[{store:'evaluationArtifacts',id:result.artifactHash}]));
        }
        const pointer={id,name:options.name||active.label,scope:'DESIGN',type:options.type||'DESIGN_STUDY',sourceWorkspace:'DESIGN',targetWorkspace:'DESIGN',parent:active.parentScenarioId||snapshot.dataSource.parentStudyRef?.studyId||null,scenarioId:active.scenarioId,studyId:snapshot.studyId,inputHash:active.inputHash,archived:false,datasetVersionId:datasetId,observationPeriod:dataset.payload.settings.observationPeriod,verification:store.snapshot().evaluation?.verification.status||'NOT_RUN',freshness:store.snapshot().evaluation?'CURRENT':snapshot.dataSource.staleReason||'NEEDS_REEVALUATION',route:'/design/network-scenarios',refs:[{store:'studyVersions',id:versionId},{store:'datasetVersions',id:datasetId}],bindingRefs:records.bindings.map(row=>row.id)};
        const result=await repository.commit({records,pointer,expectedRevision:options.expectedRevision||0,action:'SAVE_STUDY',activeSelection:true});
        saveState='SAVED';savedStudyHash=store.snapshot().studyHash;return result;
      }catch(error){saveState=error.code==='REVISION_CONFLICT'?'CONFLICT':'SAVE_FAILED';throw error;}
    }
    async function openStudy(id){
      saveState='RESTORING';
      try{
        const pointer=await repository.read('pointers',id);if(!pointer||pointer.scope!=='DESIGN')fail('STUDY_NOT_FOUND');
        const ref=pointer.refs.find(row=>row.store==='studyVersions');const row=await repository.read(ref.store,ref.id);
        if(!row||row.contentHash!==Contract.hashArtifact(row.payload))fail('STUDY_SNAPSHOT_HASH_INVALID');
        const datasetRef=pointer.refs.find(item=>item.store==='datasetVersions');const dataset=await repository.read(datasetRef.store,datasetRef.id);
        if(!dataset||dataset.contentHash!==Contract.hashArtifact(dataset.payload))fail('STUDY_DATASET_MISSING');
        const related={studyVersions:[row],datasetVersions:[dataset],scenarioRecords:[],evaluationArtifacts:[],bindings:[]};
        for(const record of row.payload.history.records){const saved=await repository.read('scenarioRecords',`${row.payload.studyId}:${record.scenarioId}:${record.inputHash}`);if(saved)related.scenarioRecords.push(saved);}
        for(const result of row.payload.results||[]){const artifact=await repository.read('evaluationArtifacts',result.artifactHash),binding=await repository.read('bindings',`${row.payload.studyId}:${result.scenarioId}:${result.artifactHash}`);if(artifact)related.evaluationArtifacts.push(artifact);if(binding)related.bindings.push(binding);}
        validateStudyGraph(related,[pointer]);
        const hydrationStarted=performance.now(),store=Store.fromSnapshot(row.payload);savedStudyHash=store.snapshot().studyHash;saveState='CLEAN';return{store,pointer,performance:{studyHydrationMs:performance.now()-hydrationStarted,evidenceClass:'MEASURED'}};
      }catch(error){saveState='RESTORE_FAILED';throw error;}
    }
    async function metadata(id,patch,expectedRevision){
      if(Object.keys(patch).some(key=>!['name','archived'].includes(key)))fail('CATALOG_METADATA_FIELD_INVALID');
      const current=await repository.read('pointers',id);if(!current)fail('CATALOG_ENTRY_NOT_FOUND');
      return repository.commit({pointer:{...current,...patch},expectedRevision,action:patch.archived===undefined?'RENAME':'ARCHIVE_CHANGE'});
    }
    async function exportPackage(ids){
      const catalog=await repository.list('pointers');const selected=catalog.filter(row=>ids.includes(row.id));if(selected.length!==ids.length)fail('EXPORT_ENTRY_MISSING');
      const studies=new Set(selected.map(row=>row.studyId).filter(Boolean));
      const pointers=catalog.filter(row=>ids.includes(row.id)||(row.studyId&&studies.has(row.studyId)&&row.type!=='SELECTION'));
      const records={},visited=new Set();
      async function visit(ref){const key=ref.store+':'+ref.id;if(visited.has(key))return;visited.add(key);const row=await repository.read(ref.store,ref.id);if(!row)fail('EXPORT_DEPENDENCY_MISSING');(records[ref.store]=records[ref.store]||[]).push(row);for(const child of row.refs||[])await visit(child);}
      for(const pointer of pointers){for(const ref of pointer.refs)await visit(ref);for(const id of pointer.bindingRefs||[])await visit({store:'bindings',id});}
      const hasP6=Object.keys(records).some(store=>store.startsWith('operational'));
      const payload={schemaVersion:hasP6?'stct-study-package-p6':'stct-study-package-p5',application:'Supply Chain Decision Platform',records,pointers,omittedOriginalBytes:true,missingEvidence:['ORIGINAL_UPLOAD_BYTES'],sourceRefs:pointers.map(row=>row.id),createdAt:new Date().toISOString(),importPolicy:hasP6?'READ_ONLY_REVIEW_EXPLICIT_ACTIVATION_REQUIRED':'P5_COMPATIBLE'};
      payload.packageHash=Contract.hashArtifact(payload);return payload;
    }
    function inspectPackage(input){
      const value=typeof input==='string'?Import.parseJson(input,128*1024*1024):Import.safe(clone(input));
      if(value.schemaVersion==='stct-design-study-readonly-v1.9-p4'){
        const {exportHash,...payload}=value;
        if(!exportHash||Contract.hashArtifact(payload)!==exportHash)fail('PACKAGE_HASH_INVALID');
        return {status:'LEGACY_READ_ONLY',businessVerification:'UNVERIFIABLE',missingDependencies:['RECONSTRUCTIBLE_DATASET_AND_STUDY'],payload:value};
      }
      if(!['stct-study-package-p5','stct-study-package-p6'].includes(value.schemaVersion))return {status:'UNSUPPORTED_PACKAGE_SCHEMA',businessVerification:'NOT_RUN',missingDependencies:['SUPPORTED_PACKAGE_SCHEMA'],payload:value};
      const {packageHash,...payload}=value;if(Contract.hashArtifact(payload)!==packageHash)fail('PACKAGE_HASH_INVALID');
      const map=new Map();
      for(const [store,rows]of Object.entries(value.records))for(const row of rows){if(row.contentHash!==Contract.hashArtifact(row.payload))fail('PACKAGE_INTERNAL_HASH_INVALID');const key=store+':'+row.id;if(map.has(key))fail('PACKAGE_DUPLICATE_RECORD');map.set(key,row);}
      for(const row of [...map.values(),...value.pointers])for(const ref of row.refs||[])if(!map.has(ref.store+':'+ref.id))fail('PACKAGE_REFERENCE_MISSING');
      const visited=new Set(),visiting=new Set();
      function visit(key){if(visiting.has(key))fail('PACKAGE_REFERENCE_CYCLE');if(visited.has(key))return;visiting.add(key);for(const ref of map.get(key).refs||[])visit(ref.store+':'+ref.id);visiting.delete(key);visited.add(key);}
      for(const key of map.keys())visit(key);
      for(const row of value.records.evaluationArtifacts||[])if(row.id!==Contract.hashArtifact(row.payload))fail('PACKAGE_ARTIFACT_ID_MISMATCH');
      for(const row of value.records.bindings||[]){const artifact=map.get('evaluationArtifacts:'+row.payload.artifactHash);if(!artifact||artifact.payload.networkInputHash!==row.payload.networkInputHash)fail('PACKAGE_BINDING_CONTEXT_MISMATCH');}
      for(const pointer of value.pointers)for(const id of pointer.bindingRefs||[])if(!map.has('bindings:'+id))fail('PACKAGE_BINDING_REFERENCE_MISSING');
      for(const row of value.records.studyVersions||[]){
        if(!row.payload?.dataSource?.scenario?.routingContext?.providerId||row.payload.results?.some(result=>!result.authority?.networkVerifier))return {status:'READ_ONLY_NEEDS_REVALIDATION',businessVerification:'UNVERIFIABLE',missingDependencies:['MATRIX_OR_VERIFIER_CONTEXT'],payload:value};
        Store.fromSnapshot(row.payload);
      }
      for(const row of value.records.datasetVersions||[])if(row.payload.normalizedScenario&&row.payload.canonicalDataHash!==Contract.hashArtifact({network:row.payload.normalizedScenario,candidateSites:row.payload.records.candidateSites||[],costParameters:row.payload.records.costParameters||[]}))fail('PACKAGE_DATASET_HASH_INVALID');
      for(const row of value.records.facilityStudies||[])if(row.id!==row.payload.studyHash||Facility.normalizeStudy(row.payload).studyHash!==row.id)fail('PACKAGE_FACILITY_STUDY_INVALID');
      for(const row of value.records.facilityResults||[]){const verification=(value.records.facilityVerifications||[]).find(item=>item.payload.resultSetHash===row.id),study=(value.records.facilityStudies||[]).find(item=>item.id===verification?.payload.studyHash),matrix=(value.records.facilityMatrices||[]).find(item=>item.id===verification?.payload.matrixHash);if(!study||!matrix||Facility.verifyResult(study.payload,matrix.payload,row.payload).status!=='PASS')fail('PACKAGE_FACILITY_RESULT_INVALID');}
      validateStudyGraph(value.records,value.pointers);
      if(value.schemaVersion==='stct-study-package-p6'){
        for(const row of value.records.operationalEnvelopes||[])if(Envelope.validateEnvelope(row.payload).status!=='PASS')fail('PACKAGE_OPERATIONAL_ENVELOPE_INVALID');
        for(const row of value.records.operationalSessions||[])if(OperationalSession.verifySnapshot(row.payload).status!=='PASS')fail('PACKAGE_OPERATIONAL_SESSION_INVALID');
        for(const row of value.records.operationalResults||[]){const envelopeRow=(value.records.operationalEnvelopes||[]).find(item=>item.id===row.payload.envelopeHash);if(!envelopeRow)fail('PACKAGE_OPERATIONAL_ENVELOPE_MISSING');OperationalResult.admit(envelopeRow.payload,row.payload,{sessionId:row.payload.validationSessionId});}
        for(const row of value.records.operationalBindings||[]){if(!(value.records.operationalResults||[]).some(item=>item.id===row.payload.resultHash))fail('PACKAGE_OPERATIONAL_BINDING_INVALID');}
      }
      return{status:'READY',businessVerification:'PASS',payload:value,activationPolicy:value.schemaVersion==='stct-study-package-p6'?'READ_ONLY_REVIEW':'P5_COMPATIBLE'};
    }
    async function importPackage(input){
      const inspected=inspectPackage(input);if(inspected.status!=='READY')return inspected;
      const value=inspected.payload;
      // One transaction imports the entire graph under a backup catalog entry.
      const id='BACKUP:'+value.packageHash;
      if(await repository.read('pointers',id))return {status:'DUPLICATE',id};
      const entries=[];
      for(const pointer of value.pointers){const existing=await repository.read('pointers',pointer.id);if(existing){if(Contract.hashArtifact(existing)!==Contract.hashArtifact(pointer))fail('PACKAGE_CATALOG_ID_COLLISION');}else entries.push(pointer);}
      options.onStage?.('COMMITTING');
      await repository.commit({records:value.records,pointer:{id,scope:'DESIGN',type:'CAPSULE',name:'Imported study backup',entries:value.pointers,refs:value.pointers.flatMap(row=>row.refs)},catalogEntries:entries,expectedRevision:0,action:'IMPORT_STUDY_PACKAGE'});
      return{status:'SAVED',id,entries:value.pointers};
    }
    return Object.freeze({saveDataset,createDesignStudy,datasetDiff,deletionImpact,saveStudy,openStudy,metadata,exportPackage,inspectPackage,importPackage,validateStudyGraph,list:()=>repository.list('pointers'),status:store=>store&&['CLEAN','SAVED'].includes(saveState)&&store.snapshot().studyHash!==savedStudyHash?'DIRTY':saveState,repository});
  }
  return Object.freeze({TYPES,createService,validateStudyGraph});
});
