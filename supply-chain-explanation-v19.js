(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./supply-chain-design-v19.js'):root.STCTPlatformV19?.supplyChainDesign);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)(root.STCTPlatformV19=root.STCTPlatformV19||{}).supplyChainExplanation=api;
})(globalThis,function(Design){
  'use strict';
  const round=value=>value==null?null:Number(value);
  const sum=(rows,key)=>rows.reduce((total,row)=>total+(row[key]||0),0);
  const unique=values=>[...new Set(values)];
  const pair=row=>`${row.demandId}\u0000${row.period}`;
  const name=(nodes,id)=>nodes.get(id)?.name||id;
  const metric=(legs,unit)=>{
    const known=legs.filter(row=>row.volumeKm!=null),numerator=sum(known,'volumeKm'),denominator=sum(known,'quantity'),all=sum(legs,'quantity');
    const sample=legs.map(pair).sort();
    return { weightedKm:denominator?numerator/denominator:null, numeratorVolumeKm:denominator?numerator:null, denominatorVolume:denominator, totalVolume:all, coverageRatio:all?denominator/all:null, samplePeriodRecords:sample.length, sampleSetHash:Design.hash(sample), unit, source:'VERIFIED_RESULT_LEGS' };
  };
  function build(study,snapshot){
    const nodes=new Map(study.nodes.map(row=>[row.nodeId,row]));
    const periods=study.periods;
    const demandIds=unique(study.periodDemand.map(row=>row.demandId));
    const addressKeys=unique(study.periodDemand.map(row=>{
      const node=nodes.get(row.customerNodeId)||{};
      return String(node.address||node.customerAddress||'').trim().toLowerCase()||
        (Array.isArray(node.coordinate)?node.coordinate.join(','):`NODE:${row.customerNodeId}`);
    }));
    const demandVolume=sum(study.periodDemand,'quantity');
    const baseByKey=new Map(snapshot.baseline.outbound.map(row=>[pair(row),row]));
    const baselineInbound=snapshot.baseline.metrics.inbound;
    const solverRows=(snapshot.solverRuns||[]).flatMap(run=>run.results||[]);
    const feasible=solverRows.filter(row=>['OPTIMAL','FEASIBLE'].includes(row.status)).length;
    const solver={ attempted:solverRows.length, feasible, infeasible:solverRows.filter(row=>row.status==='INFEASIBLE').length, timedOut:solverRows.filter(row=>/TIME/.test(row.status)).length, unverified:solverRows.filter(row=>!['OPTIMAL','FEASIBLE','INFEASIBLE'].includes(row.status)&&!/TIME/.test(row.status)).length, displayed:snapshot.rows.length, deduplicated:Math.max(0,feasible-snapshot.rows.length), evidence:'SOLVER_RUN_LOG' };
    const rows=snapshot.rows.map(item=>{
      const candidate=item.result;
      const selected=new Set(candidate.selectedSiteIds);
      const changed=candidate.outbound.map(after=>({before:baseByKey.get(pair(after)),after})).filter(row=>row.before&&row.before.fromNodeId!==row.after.fromNodeId);
      const affectedDemandIds=unique(changed.map(row=>row.after.demandId));
      const moves=new Map(),contributors=new Map();
      for(const {before,after} of changed){
        const key=`${before.fromNodeId}\u0000${after.fromNodeId}`;
        const movement=moves.get(key)||{fromSiteId:before.fromNodeId,fromName:name(nodes,before.fromNodeId),toSiteId:after.fromNodeId,toName:name(nodes,after.fromNodeId),demandIds:[],volume:0};
        movement.demandIds.push(after.demandId);movement.volume+=after.quantity;moves.set(key,movement);
        const customer=nodes.get(after.toNodeId)||{};
        const contributionKey=`${after.demandId}\u0000${key}`;
        const contribution=contributors.get(contributionKey)||{demandId:after.demandId,customerName:customer.name||after.demandId,fromName:movement.fromName,toName:movement.toName,volume:0,beforeVolumeKm:0,afterVolumeKm:0,knownVolume:0,source:after.source||before.source||null};
        contribution.volume+=after.quantity;
        if(before.volumeKm!=null&&after.volumeKm!=null){contribution.beforeVolumeKm+=before.volumeKm;contribution.afterVolumeKm+=after.volumeKm;contribution.knownVolume+=after.quantity;}
        contributors.set(contributionKey,contribution);
      }
      const moved=[...moves.values()].map(row=>({...row,businessRecords:unique(row.demandIds).length,demandIds:unique(row.demandIds).sort()})).sort((a,b)=>b.volume-a.volume);
      const top=[...contributors.values()].map(row=>({...row,beforeKm:row.knownVolume?row.beforeVolumeKm/row.knownVolume:null,afterKm:row.knownVolume?row.afterVolumeKm/row.knownVolume:null,improvementVolumeKm:row.knownVolume?row.beforeVolumeKm-row.afterVolumeKm:null})).sort((a,b)=>(b.improvementVolumeKm??-Infinity)-(a.improvementVolumeKm??-Infinity)).slice(0,8);
      const siteLoads=study.nodes.filter(node=>['DC','WAREHOUSE'].includes(node.role)).map(node=>{
        const values=periods.map(period=>{
          const before=sum(snapshot.baseline.outbound.filter(row=>row.fromNodeId===node.nodeId&&row.period===period),'quantity');
          const after=sum(candidate.outbound.filter(row=>row.fromNodeId===node.nodeId&&row.period===period),'quantity');
          const capacity=candidate.capacityByPeriod.find(row=>row.siteNodeId===node.nodeId&&row.period===period);
          return {period,before,after,capacity:capacity?.capacity??null,capacityStatus:capacity?.status||'NOT_SELECTED'};
        });
        const beforePeak=values.reduce((best,row)=>row.before>best.volume?{period:row.period,volume:row.before}:best,{period:null,volume:0});
        const afterPeak=values.reduce((best,row)=>row.after>best.volume?{period:row.period,volume:row.after}:best,{period:null,volume:0});
        const beforeTotal=sum(values,'before'),afterTotal=sum(values,'after');
        return {siteId:node.nodeId,name:node.name||node.nodeId,selected:selected.has(node.nodeId),beforeTotal,afterTotal,change:afterTotal-beforeTotal,changeRate:beforeTotal?(afterTotal-beforeTotal)/beforeTotal:null,beforeMonthlyAverage:periods.length?beforeTotal/periods.length:null,afterMonthlyAverage:periods.length?afterTotal/periods.length:null,beforePeak,afterPeak,periods:values,unit:study.unit,meaning:'THROUGHPUT_NOT_STORAGE_CAPACITY'};
      });
      const paired=(common,side)=>({weightedKm:common[side+'WeightedKm'],numeratorVolumeKm:common[side+'VolumeKm'],denominatorVolume:common.commonVolume,totalVolume:common[side+'TotalVolume'],coverageRatio:common.coverageRatio,samplePeriodRecords:common.sampleCount,sampleSetHash:common.sampleSetHash,unit:study.unit,source:'COMMON_KNOWN_RESULT_LEGS'});
      const affectedCommon=Design.commonDistance(changed.map(row=>row.before),changed.map(row=>row.after),'OUTBOUND');
      const affectedBefore=paired(affectedCommon,'before'),affectedAfter=paired(affectedCommon,'after');
      const outboundCommon=item.comparison.outboundCommon||Design.commonDistance(snapshot.baseline.outbound,candidate.outbound,'OUTBOUND');
      const outboundBefore=paired(outboundCommon,'before'),outboundAfter=paired(outboundCommon,'after');
      const sameOutboundCoverage=outboundCommon.sameTotalVolume&&outboundCommon.commonVolume>0;
      const missingCosts=unique([...snapshot.baseline.metrics.applicableCostParts,...candidate.metrics.applicableCostParts].filter(part=>snapshot.baseline.metrics.costParts[part]==null||candidate.metrics.costParts[part]==null));
      return { scenarioId:item.scenarioId,scenarioType:candidate.scenarioType,status:candidate.status,selectedSites:study.nodes.filter(node=>selected.has(node.nodeId)).map(node=>({siteId:node.nodeId,name:node.name||node.nodeId})),inactiveSites:study.nodes.filter(node=>['DC','WAREHOUSE'].includes(node.role)&&!selected.has(node.nodeId)).map(node=>({siteId:node.nodeId,name:node.name||node.nodeId})),distanceBasis:candidate.distanceBasis,outbound:{before:outboundBefore,after:outboundAfter,changeKm:sameOutboundCoverage&&outboundBefore.weightedKm!=null&&outboundAfter.weightedKm!=null?outboundAfter.weightedKm-outboundBefore.weightedKm:null,changeRate:sameOutboundCoverage&&outboundBefore.weightedKm>0&&outboundAfter.weightedKm!=null?(outboundAfter.weightedKm-outboundBefore.weightedKm)/outboundBefore.weightedKm:null,comparable:sameOutboundCoverage},affected:{businessRecords:affectedDemandIds.length,periodRecords:changed.length,volume:sum(changed.map(row=>row.after),'quantity'),shareOfDemand:demandVolume?sum(changed.map(row=>row.after),'quantity')/demandVolume:null,demandIds:affectedDemandIds.sort(),before:affectedBefore,after:affectedAfter,moves:moved,topContributors:top},siteLoads,cost:{complete:item.comparison.completeOperatingCost,steadyState:round(candidate.metrics.steadyStateCost),firstPeriod:round(candidate.metrics.firstPeriodCost),steadyImprovementRate:item.comparison.steadyStateImprovementRate,firstPeriodImprovementRate:item.comparison.firstPeriodImprovementRate,comparableParts:item.comparison.comparableCostParts,missingParts:missingCosts,assumedRateCount:snapshot.assumedRateCount},inbound:{configured:candidate.inbound.length>0,knownVolumeKmSubtotal:candidate.metrics.inbound.knownVolumeKmSubtotal,knownVolume:candidate.metrics.inbound.knownDistanceVolume,totalVolume:candidate.metrics.inbound.totalVolume,coverageRatio:candidate.metrics.inbound.coverageRatio},capacity:{unknownPeriods:candidate.capacityByPeriod.filter(row=>row.status==='UNKNOWN').length,exceededPeriods:candidate.capacityByPeriod.filter(row=>row.status==='EXCEEDED').length,checkedPeriods:candidate.capacityByPeriod.filter(row=>row.status==='PASS').length},solverEvidence:candidate.solverEvidence||null };
    });
    return {schemaVersion:'stct-supply-chain-explanation-v1.9',studyHash:study.inputHash,distanceBasis:snapshot.baseline.distanceBasis,unit:study.unit,currency:study.currency,periods,records:{businessDemand:demandIds.length,uniqueDeliveryAddresses:addressKeys.length,demandPeriod:study.periodDemand.length,observedInboundBusiness:unique(study.observedInbound.map(row=>row.flowId)).length,observedInboundPeriod:study.observedInbound.length,demandVolume,source:'STUDY_INPUT'},baselineInbound:{knownVolumeKmSubtotal:baselineInbound.knownVolumeKmSubtotal,knownVolume:baselineInbound.knownDistanceVolume,totalVolume:baselineInbound.totalVolume,unknownVolume:baselineInbound.totalVolume-baselineInbound.knownDistanceVolume,coverageRatio:baselineInbound.coverageRatio,fullVolumeKm:baselineInbound.numeratorVolumeKm,unit:study.unit,source:'OBSERVED_INBOUND_LEGS'},config:snapshot.comparisonConfig||null,solver,rows};
  }
  function selection(snapshot){
    if(snapshot.decision)return snapshot.decision;
    const joint=snapshot.schemaVersion==='stct-supply-chain-v5-snapshot-v1',scope=joint?snapshot.analysisScope:snapshot.comparisonConfig?.objectiveScope||'OUTBOUND_ONLY',objective=joint?snapshot.scenario?.objective:snapshot.comparisonConfig?.objective;
    const candidates=(snapshot.rows||[]).map(item=>{const result=joint?item:item.result,comparison=item.comparison,capacity=joint?result.capacityByPeriod:result.capacityByPeriod;
      const comparable=joint?(comparison.inbound.comparable&&(scope!=='FULL_CHAIN'||comparison.outbound.comparable)):comparison.sameScope&&comparison.outboundCommon?.sameTotalVolume&&comparison.outboundCommon?.commonVolume>0&&(scope!=='TWO_END'||comparison.inboundScopeComparable);
      const cost=joint?comparison.costAfter:comparison.completeOperatingCost?result.metrics.steadyStateCost:null,beforeCost=joint?comparison.costBefore:comparison.completeOperatingCost?snapshot.baseline.metrics.steadyStateCost:null;
      const metric=joint?(scope==='UPSTREAM_ONLY'?result.metrics.inbound.volumeKm:result.metrics.totalVolumeKm):scope==='TWO_END'?result.metrics.totalVolumeKm:result.metrics.outbound.numeratorVolumeKm;
      const metricComplete=joint?comparable:comparable&&result.metrics.outbound.coverageRatio===1&&(scope!=='TWO_END'||result.metrics.inbound.coverageRatio===1);
      const sites=joint?result.selectedSites.map(site=>site.nodeId):result.selectedSiteIds;
      return {id:item.scenarioId,cost,beforeCost,metric:metricComplete?metric:null,ready:capacity.every(row=>row.status==='PASS'),eligible:!['INFEASIBLE','FAILED','UNVERIFIED'].includes(result.status)&&!capacity.some(row=>row.status==='EXCEEDED')&&comparable,key:JSON.stringify([sites.length,[...sites].sort(),result.assignments||result.outbound.map(row=>[row.demandId,row.period,row.fromNodeId]),result.sourceFlows||[]])};
    }).filter(row=>row.eligible);
    const referenceResult=joint&&scope==='FULL_CHAIN'?snapshot.planningReference:snapshot.baseline,referenceFeasible=Boolean(referenceResult)&&!['INFEASIBLE','FAILED','UNVERIFIED'].includes(referenceResult.status)&&!(referenceResult.capacityByPeriod||[]).some(row=>row.status==='EXCEEDED');
    const knownCost=candidates.filter(row=>row.cost!=null&&row.beforeCost!=null),keep=referenceFeasible&&candidates.length>0&&knownCost.length===candidates.length&&knownCost.every(row=>row.cost>=row.beforeCost-1e-9);
    const costMetric=objective==='COST'||keep,metricName=costMetric?'COMPARABLE_OPERATING_COST':scope==='OUTBOUND_ONLY'?'OUTBOUND_VOLUME_KM':scope==='UPSTREAM_ONLY'?'INBOUND_VOLUME_KM':'TWO_END_VOLUME_KM';
    const ranked=[...(costMetric?knownCost:candidates.filter(row=>row.metric!=null))].sort((a,b)=>(costMetric?a.cost-b.cost:a.metric-b.metric)||a.key.localeCompare(b.key));
    const best=ranked[0],value=best?(costMetric?best.cost:best.metric):null,tolerance=value==null?0:Math.max(1e-9,Math.abs(value)*1e-12),ties=best?ranked.filter(row=>Math.abs((costMetric?row.cost:row.metric)-value)<=tolerance):[];
    const kind=!best?(snapshot.rows.length&&!snapshot.rows.every(item=>(joint?item:item.result).status==='INFEASIBLE')?'DATA_INCOMPLETE':'NO_FEASIBLE_CANDIDATE'):keep?'KEEP_REFERENCE':costMetric&&best.ready&&best.cost<best.beforeCost-1e-9?'FINANCIAL_RECOMMENDATION':costMetric?'THEORETICAL_COST_SCREENING':'THEORETICAL_DISTANCE_SCREENING';
    return {schemaVersion:'stct-supply-chain-decision-v1',referenceFeasible,referenceStatus:!referenceResult?'MISSING':referenceFeasible?'NO_KNOWN_VIOLATION':'INFEASIBLE',focusScenarioId:best?.id||null,kind,rankingMetric:metricName,rankingScope:'VERIFIED_COMPARABLE_CANDIDATE_SET',reference:joint&&scope==='FULL_CHAIN'?'SAME_CONDITION_PLANNING_REFERENCE':'OBSERVED_BASELINE',scope,rankedScenarioIds:ranked.map(row=>row.id),tiedScenarioIds:ties.map(row=>row.id),tieTolerance:tolerance,capacityVerified:best?.ready||false};
  }
  function comparisonProjection(snapshot){
    const rows=snapshot.rows||[],byId=new Map();
    for(const row of rows){
      if(!row.scenarioId||byId.has(row.scenarioId))throw new Error('SUPPLY_RANKING_ID_CONFLICT');
      byId.set(row.scenarioId,row);
    }
    const decision=snapshot.decision,rankedIds=decision?.rankedScenarioIds;
    if(rankedIds!=null&&!Array.isArray(rankedIds))throw new Error('SUPPLY_RANKING_ID_CONFLICT');
    const metric=decision?.rankingMetric||null;
    const value=row=>{
      const m=(row.result||row).metrics||{};
      return metric==='COMPARABLE_OPERATING_COST'?(row.comparison?.costAfter??m.operatingCost??m.steadyStateCost??null):metric==='INBOUND_VOLUME_KM'?(m.inbound?.volumeKm??m.inbound?.numeratorVolumeKm??null):metric==='OUTBOUND_VOLUME_KM'?(m.outbound?.volumeKm??m.outbound?.numeratorVolumeKm??null):metric==='TWO_END_VOLUME_KM'?(m.totalVolumeKm??null):null;
    };
    const seen=new Set(),entries=[],ties=new Set(decision?.tiedScenarioIds||[]);
    for(const id of rankedIds||[]){
      if(seen.has(id)||!byId.has(id))throw new Error('SUPPLY_RANKING_ID_CONFLICT');
      const rankedRow=byId.get(id),rankedResult=rankedRow.result||rankedRow;
      if(['INFEASIBLE','FAILED','UNVERIFIED'].includes(rankedResult.status)||(rankedResult.capacityByPeriod||[]).some(item=>item.status==='EXCEEDED')||value(rankedRow)==null)throw new Error('SUPPLY_RANKING_ID_CONFLICT');
      seen.add(id);
      entries.push({row:rankedRow,group:'RANKED',rank:ties.has(id)?1:entries.length+1,tied:ties.has(id)&&ties.size>1,reason:null});
    }
    if(rankedIds!=null&&(decision.focusScenarioId&&!seen.has(decision.focusScenarioId)||[...ties].some(id=>!seen.has(id))))throw new Error('SUPPLY_RANKING_ID_CONFLICT');
    for(const row of rows){
      if(seen.has(row.scenarioId))continue;
      const result=row.result||row,status=result.status||row.status,capacity=result.capacityByPeriod||row.capacityByPeriod||[];
      const m=result.metrics||{},cost=row.comparison?.costAfter??m.operatingCost??m.steadyStateCost;
      const objective=decision?.rankingMetric,scope=decision?.scope;
      const distance=objective==='INBOUND_VOLUME_KM'?m.inbound?.volumeKm??m.inbound?.numeratorVolumeKm:objective==='OUTBOUND_VOLUME_KM'?m.outbound?.volumeKm??m.outbound?.numeratorVolumeKm:m.totalVolumeKm;
      const reason=status==='INFEASIBLE'?'INFEASIBLE':capacity.some(item=>item.status==='EXCEEDED')?'CAPACITY_EXCEEDED':!['OPTIMAL','FEASIBLE','EVALUATED'].includes(status)?'NOT_COMPLETE':rankedIds==null?'NO_RANKING':row.comparison?.sameScope===false?'SCOPE_MISMATCH':row.comparison?.outboundCommon?.sameTotalVolume===false?'DEMAND_MISMATCH':scope==='FULL_CHAIN'&&row.comparison?.inbound?.comparable===false?'INBOUND_NOT_COMPARABLE':objective==='COMPARABLE_OPERATING_COST'&&cost==null?'COST_INCOMPLETE':distance==null?'DISTANCE_INCOMPLETE':'NOT_RANKED';
      entries.push({row,group:'OTHER',rank:null,reason});
    }
    return {entries:entries.map(entry=>({...entry,metricValue:value(entry.row)})),rankingAvailable:rankedIds!=null,rankingMetric:metric,reference:decision?.reference||null,focusScenarioId:decision?.focusScenarioId||null};
  }
  function comparisonLabel(projection,entry,locale='zh'){
    const i=locale==='en'?1:locale==='ja'?2:0;
    if(entry.group==='RANKED')return entry.tied?[`并列第 ${entry.rank} 位`,`Tied rank ${entry.rank}`,`同順位 ${entry.rank} 位`][i]:[`第 ${entry.rank} 位`,`Rank ${entry.rank}`,`第 ${entry.rank} 位`][i];
    return ({INFEASIBLE:['不可行','Infeasible','実行不可'],CAPACITY_EXCEEDED:['逐期容量超限','Period capacity exceeded','期間別能力超過'],NOT_COMPLETE:['求解未完成或未核验','Solve incomplete or unverified','求解未完了または未検証'],NO_RANKING:['未提供排名，按原记录顺序','No ranking supplied; record order','順位未提供・記録順'],SCOPE_MISMATCH:['比较范围不同','Comparison scope differs','比較範囲が異なる'],DEMAND_MISMATCH:['需求口径不同','Demand scope differs','需要の範囲が異なる'],INBOUND_NOT_COMPARABLE:['入库段不可比','Inbound not comparable','入庫は比較不可'],COST_INCOMPLETE:['适用成本不完整','Applicable cost incomplete','対象費用が不完全'],DISTANCE_INCOMPLETE:['目标距离不完整','Objective distance incomplete','目的距離が不完全'],NOT_RANKED:['未进入本次可比排名','Outside this comparable ranking','今回の比較順位対象外']}[entry.reason]||[entry.reason,entry.reason,entry.reason])[i];
  }
  function rankingNote(projection,locale='zh'){
    const i=locale==='en'?1:locale==='ja'?2:0;
    if(!projection.rankingAvailable)return ['未提供排名，候选按原记录顺序展示。','No ranking supplied; candidates remain in record order.','順位が未提供のため候補は記録順です。'][i];
    const metric=projection.rankingMetric||'UNSPECIFIED',reference=projection.reference||'UNSPECIFIED';
    return [`正式排序：${metric}；参照：${reference}。`,`Official ranking: ${metric}; reference: ${reference}.`,`正式順位：${metric}；参照：${reference}。`][i];
  }
  function decisionText(snapshot,locale='zh'){
    const d=selection(snapshot),i=locale==='en'?1:locale==='ja'?2:0;
    const text={KEEP_REFERENCE:['已知可比候选均未降低费用，维持参照；以下展示候选集内费用最低方案的权衡。','No comparable candidate reduces cost; retain the reference. The comparison below shows the least-cost candidate.','比較可能な候補は費用を削減しないため参照を維持します。以下は候補内の最小費用案との比較です。'],FINANCIAL_RECOMMENDATION:['重点方案在可行候选集内降低了可比费用。','The focus reduces comparable cost within the feasible candidate set.','重点案は可行候補集合内で比較可能な費用を削減します。'],THEORETICAL_COST_SCREENING:['按已知可比费用进行候选集内理论筛选，能力与实施条件仍待核验。','Theoretical screening by comparable known costs; capacity and implementation conditions remain unverified.','既知の比較可能費用による理論選別です。能力と実施条件は未確認です。'],THEORETICAL_DISTANCE_SCREENING:['重点方案按声明的运输范围与物量公里筛选，不构成财务推荐。','The focus is selected by volume-km in the stated transport scope; it is not a financial recommendation.','明示した輸送範囲の物量キロによる重点案であり、財務推奨ではありません。'],DATA_INCOMPLETE:['当前数据不足以形成可比的重点方案。','Current data cannot establish a comparable focus.','比較可能な重点案を選ぶデータが不足しています。'],NO_FEASIBLE_CANDIDATE:['当前没有已验证的可行候选，请查看求解状态与资料缺口。','No verified feasible candidate is available; review solve status and missing data.','検証済みの可行候補がありません。求解状態と不足資料を確認してください。']}[d.kind][i];
    return text+(d.referenceStatus==='INFEASIBLE'?[' 参照存在已知硬约束问题，不能建议维持，应先修复约束。',' The reference violates known hard constraints; retaining it cannot be recommended.',' 参照には既知の制約違反があるため、維持は推奨できません。'][i]:'')+(d.tiedScenarioIds.length>1?[' 同一指标下有并列候选，不据此认定唯一经营最优。',' There are tied candidates; no unique business optimum is claimed.',' 同点候補があり、唯一の業務最適とは判断しません。'][i]:'');
  }
  function businessBrief(snapshot){
    const joint=snapshot.schemaVersion==='stct-supply-chain-v5-snapshot-v1';
    const decision=selection(snapshot),row=(joint?snapshot.rows:snapshot.explanation?.rows||[]).find(item=>item.scenarioId===decision.focusScenarioId);
    const comparison=joint?row?.comparison:null;
    const costBefore=joint?comparison?.costBefore:row?.cost?.complete&&row?.outbound?.comparable?snapshot.baseline?.metrics?.steadyStateCost:null;
    const costAfter=joint?comparison?.costAfter:row?.cost?.complete&&row?.outbound?.comparable?row.cost.steadyState:null;
    const outboundRate=joint?comparison?.outbound?.changeRate:row?.outbound?.changeRate;
    const selectedResult=!joint?snapshot.rows.find(item=>item.scenarioId===decision.focusScenarioId):null;
    const inboundRate=joint?comparison?.inbound?.changeRate:selectedResult?.comparison?.inboundDistanceChangeRate;
    const bothComparable=decision.scope==='TWO_END'&&selectedResult?.comparison?.inboundScopeComparable&&selectedResult?.comparison?.outboundScopeComparable;
    const totalBefore=joint?comparison?.totalVolumeKmBefore:bothComparable?snapshot.baseline.metrics.totalVolumeKm:null,totalAfter=joint?comparison?.totalVolumeKmAfter:bothComparable?selectedResult.result.metrics.totalVolumeKm:null;
    const capacity=joint?{unknown:(row?.capacityByPeriod||[]).filter(item=>item.status==='UNKNOWN').length,exceeded:(row?.capacityByPeriod||[]).filter(item=>item.status==='EXCEEDED').length}:{unknown:row?.capacity?.unknownPeriods||0,exceeded:row?.capacity?.exceededPeriods||0};
    const changedPeriods=joint?(row?.relationRows||[]).filter(item=>item.change!=='UNCHANGED'):[];
    const relationGroups=new Map();
    for(const item of changedPeriods){const key=JSON.stringify([item.supplierId,item.siteId,item.productGroupId??null,item.eligibilityId??null]);const group=relationGroups.get(key)||{before:0,after:0};group.before+=item.beforeVolume;group.after+=item.afterVolume;relationGroups.set(key,group);}
    const relationBreakdown={added:0,removed:0,volumeOnly:0},periodBreakdown={added:0,removed:0,volumeOnly:0};
    for(const group of relationGroups.values())relationBreakdown[group.before===0?'added':group.after===0?'removed':'volumeOnly']++;
    for(const item of changedPeriods)periodBreakdown[item.change==='NEW'?'added':item.change==='REMOVED'?'removed':'volumeOnly']++;
    return {schemaVersion:'stct-supply-chain-business-brief-v1',decision,decisionText:['zh','en','ja'].map(locale=>decisionText(snapshot,locale)),scope:joint?snapshot.analysisScope:decision.scope,reference:joint&&snapshot.analysisScope==='FULL_CHAIN'?'SAME_CONDITION_PLANNING_REFERENCE':'OBSERVED_BASELINE',objective:joint?snapshot.scenario?.objective:snapshot.comparisonConfig?.objective||'OUTBOUND_DISTANCE',candidateId:row?.scenarioId||null,siteNames:joint?(row?.selectedSites||[]).map(item=>item.name):(row?.selectedSites||[]).map(item=>item.name),sourceMode:joint?snapshot.scenario?.sourceMode||null:null,sourceChanges:relationGroups.size,uniqueChangedRelations:relationGroups.size,changedPeriodRecords:changedPeriods.length,relationBreakdown,periodBreakdown,customerChanges:joint?(row?.customerChanges||[]).length:row?.affected?.businessRecords||0,inboundRate,outboundRate,totalVolumeKmRate:totalBefore>0&&totalAfter!=null?(totalAfter-totalBefore)/totalBefore:null,costBefore:costBefore??null,costAfter:costAfter??null,capacity,solverStatus:joint?row?.solver?.status||null:row?.solverEvidence?.status||null,distanceBasis:snapshot.distanceBasis,unit:snapshot.unit,currency:snapshot.currency};
  }
  function describeBrief(brief,locale='zh'){
    const i=locale==='en'?1:locale==='ja'?2:0,words=(zh,en,ja)=>[zh,en,ja][i];
    const pct=value=>value==null||!Number.isFinite(value)?words('未知','unknown','不明'):`${value>0?'+':''}${(value*100).toFixed(2)}%`;
    const scope=brief.scope==='UPSTREAM_ONLY'?words('仅上游覆盖','upstream coverage only','上流カバーのみ'):brief.scope==='FULL_CHAIN'?words('供应商—仓库—送货地全链','supplier–site–delivery full chain','供給元—倉庫—配送先の全体網'):brief.scope==='TWO_END'?words('固定供货假设下的入库与配送','inbound and delivery with fixed supply assumptions','供給仮定を固定した入庫と配送'):words('仅仓库—送货地','site–delivery only','倉庫—配送先のみ');
    const reference=brief.reference==='SAME_CONDITION_PLANNING_REFERENCE'?words('同条件规划参照','same-condition planning reference','同条件の計画参照'):words('观察现状','observed baseline','観測現状');
    const relations=brief.scope==='TWO_END'?words('供货按既定假设评价，不代表供应关系自由优化','Supply is evaluated with fixed assumptions, not freely optimized','供給は固定仮定に基づく評価であり、自由最適化ではありません'):brief.scope==='OUTBOUND_ONLY'?words('供应关系不在本次优化范围','Supplier links are outside this run','供給関係は今回の最適化対象外'):words(`变化供应关系 ${brief.uniqueChangedRelations} 组（新增 ${brief.relationBreakdown.added}、取消 ${brief.relationBreakdown.removed}、仅物量变化 ${brief.relationBreakdown.volumeOnly}）；变化期间记录 ${brief.changedPeriodRecords} 条（新增 ${brief.periodBreakdown.added}、取消 ${brief.periodBreakdown.removed}、仅物量变化 ${brief.periodBreakdown.volumeOnly}）；跨期混合动作按同一关系计一次`,`Changed supplier-site relationships: ${brief.uniqueChangedRelations} (added ${brief.relationBreakdown.added}, removed ${brief.relationBreakdown.removed}, volume only ${brief.relationBreakdown.volumeOnly}); changed period records: ${brief.changedPeriodRecords} (added ${brief.periodBreakdown.added}, removed ${brief.periodBreakdown.removed}, volume only ${brief.periodBreakdown.volumeOnly}); mixed period actions count once per relationship`,`変更された供給関係 ${brief.uniqueChangedRelations} 組（追加 ${brief.relationBreakdown.added}、取消 ${brief.relationBreakdown.removed}、物量のみ ${brief.relationBreakdown.volumeOnly}）、変更期間記録 ${brief.changedPeriodRecords} 件（追加 ${brief.periodBreakdown.added}、取消 ${brief.periodBreakdown.removed}、物量のみ ${brief.periodBreakdown.volumeOnly}）。期間をまたぐ混合変更は同一関係として一度だけ計上`);
    const customers=brief.scope==='UPSTREAM_ONLY'?words('客户归属保持不变','customer ownership remains fixed','顧客の担当倉庫は固定'):words(`客户归属变化 ${brief.customerChanges} 条`,`customer ownership changes: ${brief.customerChanges}`,`顧客担当の変更: ${brief.customerChanges} 件`);
    const distances=brief.scope==='OUTBOUND_ONLY'?words(`配送加权距离变化 ${pct(brief.outboundRate)}；入库未纳入本次优化。`,`Weighted outbound distance ${pct(brief.outboundRate)}; inbound is outside this run.`,`配送加重距離 ${pct(brief.outboundRate)}。入庫は今回の対象外。`):brief.scope==='UPSTREAM_ONLY'?words(`已知入库加权距离变化 ${pct(brief.inboundRate)}；配送不在本次范围。`,`Known inbound weighted distance ${pct(brief.inboundRate)}; outbound is outside this run.`,`既知の入庫加重距離 ${pct(brief.inboundRate)}。配送は今回の範囲外。`):words(`入库加权距离 ${pct(brief.inboundRate)}，配送加权距离 ${pct(brief.outboundRate)}，两端物量公里 ${pct(brief.totalVolumeKmRate)}。`,`Weighted inbound distance ${pct(brief.inboundRate)}, outbound ${pct(brief.outboundRate)}, both-end volume-km ${pct(brief.totalVolumeKmRate)}.`,`入庫加重距離 ${pct(brief.inboundRate)}、配送 ${pct(brief.outboundRate)}、両端物量キロ ${pct(brief.totalVolumeKmRate)}。`);
    const cost=brief.costBefore!=null&&brief.costAfter!=null?words(`可比费用 ${brief.costBefore.toFixed(2)} → ${brief.costAfter.toFixed(2)} ${brief.currency}。`,`Comparable cost ${brief.costBefore.toFixed(2)} → ${brief.costAfter.toFixed(2)} ${brief.currency}.`,`比較可能な費用 ${brief.costBefore.toFixed(2)} → ${brief.costAfter.toFixed(2)} ${brief.currency}。`):words('适用成本未完整核验，不计算节省。','Applicable cost is incomplete; no savings claim.','対象費用が未確認のため削減額を算出しません。');
    const capacity=brief.capacity.exceeded?words(`已知容量超限 ${brief.capacity.exceeded} 个仓期。`,`Known capacity exceeded in ${brief.capacity.exceeded} site-periods.`,`既知の能力超過は ${brief.capacity.exceeded} 倉庫期間。`):brief.capacity.unknown?words(`有 ${brief.capacity.unknown} 个仓期容量未知。`,`Capacity is unknown in ${brief.capacity.unknown} site-periods.`,`能力不明は ${brief.capacity.unknown} 倉庫期間。`):words('已展示仓期无已知容量超限。','No known capacity exceedance in displayed site-periods.','表示した倉庫期間に既知の能力超過はありません。');
    return [words(`本次比较${scope}，参照为${reference}；候选仓：${brief.siteNames.join('、')||'—'}。`,`This run compares ${scope} against the ${reference}; candidate sites: ${brief.siteNames.join(', ')||'—'}.`,`今回は${scope}を${reference}と比較します。候補倉庫：${brief.siteNames.join('、')||'—'}。`)+(brief.decisionText?' '+brief.decisionText[i]:''),words(`${relations}；${customers}。`,`${relations}; ${customers}.`,`${relations}。${customers}。`),`${distances} ${cost}`,capacity,words('下一步核对道路、费率、来源与逐期能力后再做实施判断；物量公里不是车公里。','Check roads, rates, origins and period capacity before implementation; volume-km is not vehicle-km.','実施判断前に道路・料金・供給元・期間別能力を確認してください。物量キロは車両キロではありません。')];
  }
  return Object.freeze({build,selection,comparisonProjection,comparisonLabel,rankingNote,decisionText,businessBrief,describeBrief});
});
