'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const I=require('../platform-import-session-v19.js'),Operations=require('../operations-data-adapter-v19.js'),Command=require('../command-operational-context-v19.js'),C=require('../network-contract-v18.js');
(async()=>{
 const session=await I.readFiles([new File([fs.readFileSync(process.argv[2])],'network.xlsx')]);
 const report=I.validate(session,{scope:'COMMAND',coordinateSystem:'WGS84',weightUnit:'kg',volumeUnit:'m3',observationPeriod:'2026-09-01',costPeriod:'MODEL_RUN',currency:'CNY',classification:'SYNTHETIC'});
 const dataset={payload:{normalizedScenario:report.normalizedScenario,validationReport:report,versionId:'SYNTHETIC-UPLOAD-V1',settings:report.settings}};
 const context=Command.createContext();await context.ready;
 const before=C.hashArtifact(context.snapshot()),draft=Operations.createDraft(dataset);assert.equal(draft.snapshot().status,'DRAFT');draft.generate();assert.equal(C.hashArtifact(context.snapshot()),before);
 assert.equal(draft.snapshot().orderIds.length,12);assert.ok(draft.snapshot().orderIds.every(id=>id.startsWith('P5-UPLOAD-ORDER-')));
 assert.equal(draft.apply(context).code,'COMMAND_RESET_REVIEW_AND_BACKUP_REQUIRED');
 const result=draft.apply(context,{confirmed:true,backupHash:C.hashArtifact(context.snapshot())});assert.equal(result.status,'ADOPTED');const after=context.snapshot();assert.equal(after.execution.acceptedEvents.length,0);assert.equal(after.alerts.alerts.length,0);assert.equal(after.plan.planHash,draft.appliedPlan().planHash);
 const pending=Command.createContext();await pending.ready;await pending.driver.acceptRoute();await pending.driver.depart();await pending.driver.goOffline();await pending.driver.arrive();const pendingBefore=C.hashArtifact(pending.snapshot());assert.equal(draft.apply(pending,{confirmed:true,backupHash:pendingBefore}).code,'COMMAND_PENDING_ACK_PROTECTED');assert.equal(C.hashArtifact(pending.snapshot()),pendingBefore);
 console.log(JSON.stringify({status:'PASS',checks:['UPLOAD_DRAFT_ISOLATED','EXISTING_NETWORK_ENGINE_VERIFIED','EXPLICIT_APPLY','NO_SEEDED_EXECUTION_OR_ALERTS','PENDING_QUEUE_PROTECTED'],runStatus:after.execution.run.status,planHash:after.plan.planHash},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
