(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./network-contract-v18.js'):root.STCTV18?.networkContract);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)(root.STCTPlatformV19=root.STCTPlatformV19||{}).platformRepository=api;
})(globalThis,function(Contract){
  'use strict';
  const SCHEMA_VERSION=4;
  const STORES=Object.freeze(['datasetVersions','studyVersions','scenarioRecords','evaluationArtifacts','bindings','facilityStudies','facilityMatrices','facilityResults','facilityVerifications','facilityOperationalBindings','supplyStudies','supplySnapshots','supplyProfiles','operationalEnvelopes','operationalSessions','operationalResults','operationalBindings','operationalEvidence','settings','pointers','audit']);
  const clone=value=>structuredClone(value);
  const error=(code,detail)=>Object.assign(new Error(code),{code,detail});
  function createRepository(options={}){
    const indexedDB=options.indexedDB||globalThis.indexedDB;
    const name=options.name||'stct-platform-v19-p5';
    let db=null,opening=null,closed=false;
    const listeners=new Set();
    const metrics=[];
    const measure=(stage,started)=>{metrics.push({stage,elapsedMs:performance.now()-started,evidenceClass:'MEASURED'});if(metrics.length>100)metrics.shift();};
    async function open(){
      if(closed)throw error('STORAGE_CLOSED');
      if(db)return db;
      if(opening)return opening;
      if(!indexedDB)throw error('STORAGE_UNAVAILABLE');
      opening=new Promise((resolve,reject)=>{
        let rejected=false;
        const req=indexedDB.open(name,SCHEMA_VERSION);
        req.onupgradeneeded=()=>{for(const store of STORES)if(!req.result.objectStoreNames.contains(store))req.result.createObjectStore(store,{keyPath:'id'});};
        req.onblocked=()=>{rejected=true;reject(error('STORAGE_BLOCKED'));};
        req.onerror=()=>reject(error(req.error?.name==='VersionError'?'STORAGE_NEWER_SCHEMA_READ_ONLY':'STORAGE_UNAVAILABLE',req.error?.name));
        req.onsuccess=()=>{if(rejected||closed){req.result.close();if(closed&&!rejected)reject(error('STORAGE_CLOSED'));return;}db=req.result;db.onversionchange=()=>{db.close();db=null;};resolve(db);};
      }).finally(()=>{opening=null;});
      return opening;
    }
    function validStore(store){if(!STORES.includes(store))throw error('STORAGE_UNKNOWN_COLLECTION');}
    async function read(store,id){
      const started=performance.now();
      validStore(store);const handle=await open();
      return new Promise((resolve,reject)=>{const tx=handle.transaction(store,'readonly');let result;const req=id===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(id);req.onsuccess=()=>{result=clone(req.result);};tx.oncomplete=()=>{measure('READ_'+store,started);resolve(result);};tx.onabort=tx.onerror=()=>reject(error('STORAGE_READ_FAILED',tx.error?.name));});
    }
    function record(id,payload,refs=[]){if(!id||typeof id!=='string')throw error('RECORD_ID_REQUIRED');return {id,payload:clone(payload),refs:clone(refs),contentHash:Contract.hashArtifact(payload)};}
    async function commit(input){
      const started=performance.now();
      const batch=clone(input);
      const records=batch.records||{};
      for(const [store,rows]of Object.entries(records)){
        validStore(store);if(['pointers','audit'].includes(store))throw error('RESERVED_COLLECTION');
        for(const row of rows){if(!row.id||row.contentHash!==Contract.hashArtifact(row.payload))throw error('RECORD_HASH_INVALID');}
      }
      if(!batch.pointer?.id||!Number.isInteger(batch.expectedRevision)||batch.expectedRevision<0)throw error('EXPECTED_REVISION_REQUIRED');
      const handle=await open();
      const saved=await new Promise((resolve,reject)=>{
        const tx=handle.transaction(STORES,'readwrite');let failure=null,pointer=null;
        const abort=(code,detail)=>{failure=error(code,detail);tx.abort();};
        const injected=stage=>{const code=options.fault?.(stage);if(!code)return false;abort(code==='QuotaExceededError'?'STORAGE_QUOTA_EXCEEDED':code,{stage,injected:true});return true;};
        tx.onabort=()=>reject(failure||error(tx.error?.name==='QuotaExceededError'?'STORAGE_QUOTA_EXCEEDED':'STORAGE_TRANSACTION_FAILED',tx.error?.name));
        tx.onerror=()=>{};
        tx.oncomplete=()=>resolve(pointer);
        const current=tx.objectStore('pointers').get(batch.pointer.id);
        current.onsuccess=()=>{
          if((current.result?.revision||0)!==batch.expectedRevision){abort('REVISION_CONFLICT',{current:current.result?.revision||0});return;}
          if(injected('BEFORE_RECORDS'))return;
          pointer={...batch.pointer,revision:batch.expectedRevision+1,savedAt:new Date().toISOString()};
          const all=Object.entries(records).flatMap(([store,rows])=>rows.map(row=>({store,row})));
          let pending=all.length;
          const finish=()=>{
            if(pending)return;
            if(injected('AFTER_RECORDS'))return;
            const refs=[...(pointer.refs||[]),...all.flatMap(({row})=>row.refs||[]),...(batch.catalogEntries||[]).flatMap(row=>row.refs||[])];
            let checking=refs.length;
            const write=()=>{
              if(checking)return;
              if(injected('BEFORE_POINTER'))return;
              tx.objectStore('pointers').put(pointer);
              if(injected('AFTER_POINTER'))return;
              for(const entry of batch.catalogEntries||[])tx.objectStore('pointers').add(entry);
              if(batch.activeSelection)tx.objectStore('pointers').put({id:'ACTIVE:'+pointer.scope,scope:pointer.scope,type:'SELECTION',selectedId:pointer.id,revision:pointer.revision,refs:pointer.refs});
              if(injected('AFTER_SELECTION'))return;
              tx.objectStore('audit').add({id:`${pointer.id}:${pointer.revision}`,scope:pointer.scope,action:batch.action||'SAVE',revision:pointer.revision,recordCount:all.length,savedAt:pointer.savedAt,evidenceClass:'DERIVED'});
            };
            for(const ref of refs){
              if(!STORES.includes(ref.store)||!ref.id){abort('REFERENCE_INVALID');return;}
              const req=tx.objectStore(ref.store).get(ref.id);req.onsuccess=()=>{if(!req.result){abort('REFERENCE_MISSING',{store:ref.store,id:ref.id});return;}checking--;write();};
            }
            write();
          };
          for(const {store,row}of all){const req=tx.objectStore(store).get(row.id);req.onsuccess=()=>{
            if(req.result&&req.result.contentHash!==row.contentHash){abort('IMMUTABLE_ID_COLLISION',{store,id:row.id});return;}
            if(!req.result)tx.objectStore(store).add(row);
            pending--;finish();
          };}
          finish();
        };
      });
      // A durable status requires transaction completion and an independent readback.
      const storageCommitMs=performance.now()-started,readbackStarted=performance.now();
      const readback=await read('pointers',saved.id);
      if(!readback||readback.revision<saved.revision)throw error('STORAGE_READBACK_FAILED');
      listeners.forEach(listener=>listener(clone(saved)));
      measure('ATOMIC_COMMIT_AND_READBACK',started);
      return {status:'SAVED',pointer:clone(saved),performance:{storageCommitMs,readbackMs:performance.now()-readbackStarted,evidenceClass:'MEASURED'}};
    }
    async function removeMany(entries,auditEntry){
      const started=performance.now();
      for(const entry of entries){validStore(entry.store);if(!entry.id||typeof entry.id!=='string')throw error('RECORD_ID_REQUIRED');}
      const handle=await open();
      await new Promise((resolve,reject)=>{
        const tx=handle.transaction(STORES,'readwrite');let failure=null;
        tx.onabort=()=>reject(failure||error(tx.error?.name==='QuotaExceededError'?'STORAGE_QUOTA_EXCEEDED':'STORAGE_TRANSACTION_FAILED',tx.error?.name));
        tx.onerror=()=>{};
        tx.oncomplete=()=>resolve();
        for(const {store,id} of entries){if(store==='audit')continue;tx.objectStore(store).delete(id);}
        if(auditEntry)tx.objectStore('audit').put(auditEntry);
      });
      measure('REMOVE',started);
    }
    return Object.freeze({open,read,list:store=>read(store),record,commit,removeMany,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){closed=true;db?.close();db=null;listeners.clear();},diagnostics(){return{schemaVersion:SCHEMA_VERSION,storage:'NATIVE_INDEXED_DB',origin:globalThis.location?.origin||'TEST',database:name,listenerCount:listeners.size,metrics:clone(metrics),open:Boolean(db),boundary:'LOCAL_BROWSER_PROFILE_AND_ORIGIN'};}});
  }
  return Object.freeze({SCHEMA_VERSION,STORES,createRepository});
});
