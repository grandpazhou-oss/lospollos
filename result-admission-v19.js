(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{
    Contract:require('./network-contract-v18.js'),Solver:require('./network-solver-v18.js'),Accounting:require('./network-accounting-v18.js'),Visualization:require('./network-visualization-v18.js')
  }:{Contract:root.STCTV18?.networkContract,Solver:root.STCTV18?.networkSolver,Accounting:root.STCTV18?.networkAccounting,Visualization:root.STCTV18?.networkVisualization});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.resultAdmission=api;
})(globalThis,function(dependencies){
  'use strict';
  const {Contract,Solver,Accounting,Visualization}=dependencies;
  const VERSION='stct-result-admission-v1.9-p5';
  const clone=value=>structuredClone(value);
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  function reject(code,issues=[]){throw Object.assign(new Error(code),{code,issues});}
  function contextKey(record,solveOptions={},accountingOptions={}){
    return Contract.hashArtifact({input:record.inputHash,routing:Contract.identityBundle(record.scenario).routingContextHash,solveOptions,accountingOptions,contract:Contract.VERSION,solver:Solver.VERSION,accounting:Accounting.VERSION,admission:VERSION});
  }
  function admit(record,candidate,options={}){
    const input=freeze(clone(record));
    const value=clone(candidate);
    if(!value?.plan||!value.accounting||value.schemaVersion!=='stct-design-evaluation-v1.9-p4')reject('DESIGN_EVALUATION_SCHEMA_INVALID');
    const identity=Contract.identityBundle(input.scenario);
    if(input.inputHash!==identity.networkInputHash||value.networkInputHash!==identity.networkInputHash)reject('DESIGN_STALE_EVALUATION_REJECTED');
    if(value.plan.routingContextHash!==identity.routingContextHash)reject('DESIGN_MATRIX_CONTEXT_MISMATCH');
    if(value.verification?.status!=='PASS'||value.accountingVerification?.status!=='PASS')reject('DESIGN_CLAIMED_VERIFICATION_FAILED');
    const authorities={canonical:Contract.VERSION,networkVerifier:Solver.VERSION,accounting:Accounting.VERSION,visualization:Visualization.VERSION};
    if(Contract.canonicalString(value.authority)!==Contract.canonicalString(authorities))reject('DESIGN_AUTHORITY_VERSION_MISMATCH');
    const verification=Solver.verifyNetworkPlan(input.scenario,value.plan);
    if(verification.status!=='PASS')reject('DESIGN_NETWORK_VERIFICATION_FAILED',verification.issues);
    // Candidate assumptions are evidence, never authority for its own recomputation.
    const expected=Accounting.computeAccounting(input.scenario,value.plan,input.scenario.assumptions.accountingOptions||{});
    const checked=Accounting.verifyAccounting(input.scenario,value.plan,value.accounting);
    if(checked.status!=='PASS'||Contract.canonicalString(value.accounting)!==Contract.canonicalString(expected))reject('DESIGN_ACCOUNTING_VERIFICATION_FAILED',checked.issues);
    const eligibility=Accounting.candidateEligibility(expected);
    if(!eligibility.eligible)reject('DESIGN_ACCOUNTING_INELIGIBLE',eligibility.reasons);
    const visual=Visualization.buildModel(input.scenario,value.plan);
    if(Visualization.verifySources(visual).status!=='PASS')reject('DESIGN_VISUAL_SOURCE_FAILED');
    if(value.visual&&Contract.canonicalString(value.visual)!==Contract.canonicalString(visual))reject('DESIGN_VISUAL_CONTEXT_MISMATCH');
    const artifact={schemaVersion:VERSION,networkInputHash:identity.networkInputHash,routingContextHash:identity.routingContextHash,plan:value.plan,accounting:expected,verification,accountingVerification:checked,visual,authority:authorities};
    const artifactHash=Contract.hashArtifact(artifact);
    if(value.artifactHash&&value.artifactHash!==artifactHash)reject('DESIGN_ARTIFACT_IDENTITY_MISMATCH');
    if(value.binding?.artifactHash&&value.binding.artifactHash!==artifactHash)reject('DESIGN_BINDING_ARTIFACT_MISMATCH');
    if(value.binding&&(value.binding.networkInputHash!==input.inputHash||value.binding.scenarioId!==value.scenarioId))reject('DESIGN_BINDING_CONTEXT_MISMATCH');
    const binding={scenarioId:input.scenarioId,networkInputHash:input.inputHash,artifactHash,reusedFrom:value.scenarioId!==input.scenarioId?value.scenarioId:value.binding?.reusedFrom||null};
    if(options.isCurrent&&!options.isCurrent(input))reject('DESIGN_CONTEXT_CHANGED_DURING_ADMISSION');
    return freeze({...value,scenarioId:input.scenarioId,changeHash:input.changeHash,verification,accounting:expected,accountingVerification:checked,visual,eligibility,artifact,artifactHash,binding,evaluationHash:artifactHash});
  }
  return Object.freeze({VERSION,admit,contextKey,freeze});
});
