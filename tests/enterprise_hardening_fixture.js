/* Synthetic collaborators for controller/storage tests; NOT a solver or domain verifier.
 * The production controller, road client, and (in browser tests) repository are unmodified.
 */
(function(root){
  'use strict';
  const copy=value=>structuredClone(value);
  function stable(value){
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  // Collision-free canonical text for these fixtures, deliberately not a production hash.
  const hash=value=>'fixture:'+stable(value);
  function deepFreeze(value){
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.freeze(value);Object.values(value).forEach(deepFreeze);
    }
    return value;
  }
  function createStudy(input){
    const value=copy(input);delete value.inputHash;
    value.schemaVersion='fixture-study';
    value.inputHash=hash(value);
    return deepFreeze(value);
  }
  const Domain={SCHEMA:'fixture-study',hash,deepFreeze,createStudy,
    assertStudyCurrent(study){if(createStudy(study).inputHash!==study.inputHash)throw Error('fixture study mismatch');},
    solverRequest(study){return {payload:{requestId:'fixture',studyHash:study.inputHash}};}
  };
  const Reports={assertCurrent(study,snapshot){if(snapshot.studyHash!==study.inputHash)throw Error('fixture snapshot mismatch');}};
  function makeStudy(id='A',name='Original'){
    return createStudy({studyId:id,name,unit:'ton',coordinateUse:'WGS84',assumptions:{},periodDemand:[],distanceRows:[],nodes:[{nodeId:'DC',role:'DC',coordinate:[120,30]},{nodeId:'C',role:'CUSTOMER',coordinate:[120.01,30.01]}]});
  }
  function makePackage(study,full=false){
    const value=full?{schemaVersion:'stct-supply-chain-package-v1.9',study,profile:null,snapshot:{schemaVersion:'fixture-snapshot',snapshotHash:'fixture-snapshot',studyHash:study.inputHash,baseline:{},rows:[]}}:{schemaVersion:'stct-supply-chain-draft-v1',study,profile:null,scenario:null,staleResult:null};
    return {...value,packageHash:hash(value)};
  }
  function memoryRepository(){
    const stores=new Map();let commits=0;
    const store=name=>{if(!stores.has(name))stores.set(name,new Map());return stores.get(name);};
    return {
      async read(name,id){return copy(id===undefined?[...store(name).values()]:store(name).get(id));},
      record(id,payload,refs=[]){return {id,payload:copy(payload),refs:copy(refs),contentHash:hash(payload)};},
      async commit(batch){
        const old=store('pointers').get(batch.pointer.id);
        if((old?.revision||0)!==batch.expectedRevision)throw Object.assign(Error('REVISION_CONFLICT'),{code:'REVISION_CONFLICT'});
        for(const [name,rows] of Object.entries(batch.records||{}))for(const row of rows){
          if(store(name).has(row.id)&&store(name).get(row.id).contentHash!==row.contentHash)throw Error('IMMUTABLE_ID_COLLISION');
        }
        for(const [name,rows] of Object.entries(batch.records||{}))for(const row of rows)store(name).set(row.id,copy(row));
        const pointer={...copy(batch.pointer),revision:batch.expectedRevision+1,savedAt:new Date().toISOString()};
        store('pointers').set(pointer.id,pointer);commits++;
        return {status:'SAVED',pointer:copy(pointer)};
      },
      get commits(){return commits;}
    };
  }
  const fingerprint='a'.repeat(64);
  function healthBody(patch={}){return {available:true,endpoint:'http://127.0.0.1:8887',instanceId:'synthetic-instance',startedAt:'2026-10-06T00:00:00Z',buildFingerprint:fingerprint,protocolVersion:'stct-supply-chain-jobs-v6',modelVersion:'v6-cp-sat-1',capabilities:['FACILITY','SUPPLY_CHAIN_JOBS_V6','FULL_CHAIN','UPSTREAM_ONLY'],dependencies:{supplyChainReady:true},supplyChainJobsV6:true,...patch};}
  function installGlobals(target){target.STCTV18={networkContract:{hashArtifact:hash}};target.STCTPlatformV19={supplyChainImport:{},supplyChainDesign:Domain,supplyChainReport:Reports,supplyChainJoint:{},supplyChainV5Results:Reports};}
  const api={Domain,Reports,hash,makeStudy,makePackage,memoryRepository,healthBody,fingerprint,installGlobals};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnterpriseHardeningFixture=api;
})(globalThis);
