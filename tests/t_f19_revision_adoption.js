(function(root){
  'use strict';
  root.__tests=root.__tests||[];
  // Supersedes the historical adoption expectation: importing is not editing authority.
  root.__tests.push({id:'F19',title:'同 ID 导入拒绝隐式覆盖；显式编辑保留版本并发检查',run:async()=>{
    const C=root.STCTPlatformV19.supplyChainController,repo=root.STCTMemRepo.createRepository();
    const input={studyId:'STUDY-ADOPT',name:'Original',unit:'m3',nodes:[{nodeId:'W',role:'DC'},{nodeId:'C',role:'CUSTOMER'}],periodDemand:[{demandId:'D',customerNodeId:'C',period:'P',quantity:10,unit:'m3'}]};
    const owner=C.createController({repository:repo});owner.loadStudy(input);await owner.save();
    const imported=C.createController({repository:repo});imported.loadStudy({...input,name:'Imported different content'});
    let conflict=null;try{await imported.save();}catch(e){conflict=e.code;}
    const retained=await repo.read('pointers','SUPPLY:STUDY-ADOPT');
    const edit=C.createController({repository:repo});await edit.reopen('SUPPLY:STUDY-ADOPT');edit.updateStudy({name:'Explicit edit'});await edit.save();
    owner.updateStudy({name:'Stale edit'});let stale=null;try{await owner.save();}catch(e){stale=e.code;}
    const final=await repo.read('pointers','SUPPLY:STUDY-ADOPT');
    return{pass:conflict==='REVISION_CONFLICT'&&retained.revision===1&&stale==='REVISION_CONFLICT'&&final.revision===2,expected:'导入冲突保持 rev1；显式编辑推进至 rev2；过期编辑拒绝',actual:{importConflict:conflict,retainedRevision:retained.revision,staleConflict:stale,finalRevision:final.revision}};
  }});
})(typeof window!=='undefined'?window:globalThis);
