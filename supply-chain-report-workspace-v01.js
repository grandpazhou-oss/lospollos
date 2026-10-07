(function(root,factory){
  const node=typeof module==='object'&&module.exports,ns=root.STCTPlatformV19||{};
  const api=factory(node?require('./supply-chain-report-v19.js'):ns.supplyChainReport,node?require('./supply-chain-v5-results-v19.js'):ns.supplyChainV5Results,node?require('./supply-chain-explanation-v19.js'):ns.supplyChainExplanation,node?require('./platform-import-session-v19.js').businessNumber:ns.businessNumber);
  if(node)module.exports=api;
  if(root.document)(root.STCTPlatformV19=root.STCTPlatformV19||{}).trustedReport=api;
})(globalThis,function(Report,Joint,Explanation,Display){
  'use strict';
  const PAGE_SIZE=200,finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={outbound:'配送距离',inbound:'入库距离',volumeKm:'物量公里',cost:'费用明细',capacity:'仓库 / 期间处理量',sources:'假设、校验与来源'};
  const number=v=>finite(v)==null?'未知 / 不可用':Display.number(v);
  function measure(m){return {value:finite(m?.weightedDistanceKm??m?.weightedKm),numerator:finite(m?.numeratorVolumeKm??m?.volumeKm),denominator:finite(m?.denominatorVolume??m?.knownVolume??m?.volume),coverage:finite(m?.coverageRatio??m?.coverage)};}
  function project(state,locale='zh'){
    const {study,snapshot:snap}=state||{};
    if(!study||!snap)throw new Error('SUPPLY_SNAPSHOT_REQUIRED');
    (snap.schemaVersion==='stct-supply-chain-v5-snapshot-v1'?Joint:Report).assertCurrent(study,snap);
    const projection=Explanation.comparisonProjection(snap),joint=snap.schemaVersion==='stct-supply-chain-v5-snapshot-v1';
    const scope=joint?snap.analysisScope:snap.comparisonConfig?.objectiveScope||'OUTBOUND_ONLY';
    const scopeLabel=({OUTBOUND_ONLY:'仅仓库 → 送货地',UPSTREAM_ONLY:'仅供应商 → 仓库',FULL_CHAIN:'供应商 → 仓库 → 送货地',TWO_END:'两端运输评价'})[scope]||scope;
    const nodes=new Map(study.nodes.map(n=>[n.nodeId,n.name||n.nodeId]));
    const row=(id,result,label,entry={})=>({id,label,result,rank:entry.rank??null,tied:entry.tied||false,group:entry.group||'REFERENCE',reason:entry.reason||null,
      sites:(result.selectedSiteIds||(result.selectedSites||[]).map(s=>s.siteId||s.nodeId)).map(id=>nodes.get(id)||id),
      outbound:measure(result.metrics?.outbound),inbound:measure(result.metrics?.inbound),volumeKm:finite(result.metrics?.totalVolumeKm),
      cost:{value:finite(result.metrics?.steadyStateCost??result.metrics?.operatingCost),firstPeriod:finite(result.metrics?.firstPeriodCost)},
      status:result.status||'来源信息不完整',capacity:result.capacityStatus||((result.capacityByPeriod||[]).some(c=>c.status==='EXCEEDED')?'EXCEEDED':(result.capacityByPeriod||[]).some(c=>c.status==='UNKNOWN')?'UNKNOWN':'来源信息不完整'),
      metricValue:finite(entry.metricValue),comparison:entry.row?.comparison||null});
    const references=[row('OBSERVED_BASELINE',snap.baseline,'真实观察现状')];
    if(scope==='FULL_CHAIN'&&snap.planningReference)references.push(row('PLANNING_REFERENCE',snap.planningReference,'同条件规划参照'));
    if(scope==='UPSTREAM_ONLY'&&snap.observedKnownInbound){
      const m=snap.observedKnownInbound;
      const sourceIds=new Set(snap.scenario?.supplierIds?.length?snap.scenario.supplierIds:study.nodes.filter(n=>['FACTORY','SUPPLIER'].includes(n.role)).map(n=>n.nodeId));
      references.push(row('OBSERVED_KNOWN_INBOUND',{inbound:snap.baseline.inbound.filter(leg=>sourceIds.has(leg.fromNodeId)),metrics:{inbound:m,costParts:{inboundTransport:m.cost},operatingCost:m.cost},status:'OBSERVED_KNOWN_SUBSET'},'已知来源的观察入库（排名参照）'));
    }
    const candidates=projection.entries.map(entry=>{const r=entry.row,result=r.result||r;return row(r.scenarioId,result,result.scenarioName||result.name||r.scenarioId,entry);});
    const focusId=snap.decision?.focusScenarioId||snap.focusId||null,focus=candidates.find(c=>c.id===focusId)||null;
    const brief=snap.decision?Explanation.businessBrief(snap):null;
    const summary=Object.fromEntries(['outbound','inbound'].map(key=>{const p=joint?focus?.comparison?.[key]:focus?.comparison?.[key+'Common'];return [key,{before:finite(p?.before??p?.beforeWeightedKm),after:finite(p?.after??p?.afterWeightedKm),changeRate:finite(brief?.[key+'Rate']),coverage:finite(p?.coverageRatio??p?.coverageBefore),commonVolume:finite(p?.commonVolume??p?.volume),sampleSetHash:p?.sampleSetHash??null}];}));
    const limits=['物量公里是物量 × 距离，不是车辆行驶里程。','求解与验证仅覆盖已声明模型；不据此声称全网络经营最优。'];
    if(!projection.rankingAvailable)limits.push('旧研究未保存正式排名，保留原记录顺序。');
    if(candidates.length<5)limits.push(`实际保存 ${candidates.length} 个候选，不补造方案。`);
    if(candidates.some(c=>c.cost.value==null))limits.push('适用费用不完整；未知费用不按零计，不宣称实际成本节省。');
    if(study.rates.some(r=>r.status==='ASSUMED')||study.costAssumptions?.mode==='INDEXED')limits.push('费用包含假设或指数；不代表实际经营费用。');
    if((snap.distanceBasis||snap.baseline.distanceBasis)!=='VERIFIED_ROAD')limits.push('地理筛选或估算道路不能证明实际道路距离、货车可行性或 SLA。');
    if(candidates.some(c=>c.capacity==='UNKNOWN'))limits.push('容量未知，未通过期间能力核验；处理量不等于库存仓容。');
    if(snap.scenario?.capacityPolicy==='UNBOUNDED_SCREENING')limits.push('供应商能力未提供，采用无上限理论筛选；不能据此确认实际供货能力。');
    const identity={studyId:study.studyId,studyName:study.name,revision:state.savedPointer?.revision??null,inputHash:study.inputHash,snapshotHash:snap.snapshotHash,
      generatedAt:snap.generatedAt||snap.createdAt||null,classification:study.classification||null,backend:snap.backendIdentity||null};
    return {identity,scope,scopeLabel,periods:[...study.periods],unit:study.unit,currency:study.currency,distanceBasis:snap.distanceBasis||snap.baseline.distanceBasis,
      projection,references,candidates,focusId,focus,brief,summary,analysisConditions:snap.scenario||null,conclusion:snap.decision?Explanation.decisionText(snap,locale):'未保存正式决策；仅展示已验证结果，不形成新推荐。',rankingNote:Explanation.rankingNote(projection,locale),limits,study,snapshot:snap,nodes};
  }
  function evidence(model,id,key,page=0){
    const candidate=[...model.references,...model.candidates].find(c=>c.id===id);
    if(!candidate)throw new Error('REPORT_SCENARIO_UNKNOWN');
    const r=candidate.result,scope={scenarioId:id,scenarioName:candidate.label,snapshotHash:model.identity.snapshotHash,inputHash:model.identity.inputHash,scope:model.scope,unit:model.unit,distanceBasis:model.distanceBasis};
    let rows=[];
    if(['outbound','inbound','volumeKm'].includes(key)){
      const kinds=key==='volumeKm'?['inbound','outbound','transfer']:[key];
      for(const kind of kinds)for(const [index,leg] of (r[kind]||[]).entries())rows.push({scenarioId:id,recordId:`${kind.toUpperCase()}:${leg.demandId||leg.flowId||leg.fromNodeId}:${leg.period}:${index}`,kind:leg.kind||kind,
        from:model.nodes.get(leg.fromNodeId)||leg.fromNodeId,to:model.nodes.get(leg.toNodeId)||leg.toNodeId,period:leg.period,quantity:leg.quantity,unit:leg.unit||model.unit,distanceKm:leg.distanceKm??null,volumeKm:leg.volumeKm??null,
        distanceSource:leg.distanceSource??null,distanceQuality:leg.distanceQuality??null,distanceTimestamp:leg.distanceTimestamp??null,source:leg.source??null,rateStatus:leg.rateStatus??null,cost:leg.cost??null});
    }else if(key==='cost'){
      rows=Object.entries(r.metrics?.costParts||{}).map(([kind,value])=>({scenarioId:id,recordId:`COST:${kind}`,kind,value:value??null,currency:model.currency,
        status:value==null?'UNKNOWN':value===0?'ZERO_SEE_RATE_STATUS':'SEE_RATE_STATUS',source:'VERIFIED_RESULT_COST_PARTS'}));
      rows.push(...model.study.rates.map((rate,i)=>({scenarioId:id,recordId:`RATE:${rate.rateId||i}`,kind:rate.kind,status:rate.status,amount:rate.amount??null,basis:rate.basis??null,scope:rate,source:'SAME_INPUT_HASH_RATE_SCOPE'})));
    }else if(key==='capacity')rows=(r.capacityByPeriod||[]).map((c,i)=>({scenarioId:id,recordId:`CAPACITY:${c.siteNodeId||c.siteId}:${c.period}:${i}`,...c,meaning:'THROUGHPUT_NOT_STORAGE_CAPACITY'}));
    else if(key==='sources')rows=[{scenarioId:id,recordId:'IDENTITY',...model.identity},{scenarioId:id,recordId:'SCOPE',periods:model.periods,scope:model.scope,unit:model.unit,currency:model.currency,distanceBasis:model.distanceBasis},
      {scenarioId:id,recordId:'SOLVER',evidence:r.solver||r.solverEvidence||null,status:r.status},
      {scenarioId:id,recordId:'METRICS',metrics:r.metrics||null,comparison:candidate.comparison},
      {scenarioId:id,recordId:'ANALYSIS_CONDITIONS',value:model.analysisConditions},
      ...Object.entries(model.snapshot.assumptions||model.study.assumptions||{}).map(([key,value])=>({scenarioId:id,recordId:`ASSUMPTION:${key}`,key,value})),
      ...(model.snapshot.sourceRefs||[]).map((value,i)=>({scenarioId:id,recordId:`SOURCE:${i}`,value})),
      ...(r.issues||[]).map((value,i)=>({scenarioId:id,recordId:`ISSUE:${i}`,value}))];
    const start=Math.max(0,Number.isInteger(page)?page:0)*PAGE_SIZE;
    return {scope,key,title:labels[key]||key,total:rows.length,page:Math.floor(start/PAGE_SIZE),rows:rows.slice(start,start+PAGE_SIZE),note:rows.length?'明细来自同一份已验证快照；来源缺项保留未知。':'明细不可用 / 尚未保存。不能倒推编造行级数据。'};
  }
  const text=v=>v==null?'未知 / 不可用':typeof v==='object'?JSON.stringify(v):String(v);
  function workbookData(detail,model=null){
    const columns=[...new Set(detail.rows.flatMap(Object.keys))],values=[columns,...detail.rows.map(r=>columns.map(k=>r[k]))],cellData={};
    values.forEach((row,i)=>{cellData[i]={};row.forEach((v,j)=>{cellData[i][j]=typeof v==='number'&&Number.isFinite(v)?{v,t:2}:{v:text(v),t:4};});});
    const data={id:'stct-evidence',name:`只读证据 · ${detail.scope.scenarioName}`,appVersion:'1.0.3',sheetOrder:['evidence'],sheets:{evidence:{id:'evidence',name:detail.title,rowCount:Math.max(30,values.length),columnCount:Math.max(10,columns.length),defaultColumnWidth:180,defaultRowHeight:26,cellData}}};
    if(model){
      const comparison={scope:detail.scope,key:'comparison',title:'方案对比',rows:[...model.references,...model.candidates].slice(0,PAGE_SIZE).map(c=>({scenarioId:c.id,group:c.group,rank:c.rank,tied:c.tied,sites:c.sites,rankingMetric:model.projection.rankingMetric,objectiveValue:c.metricValue,outboundKm:c.outbound.value,outboundCoverage:c.outbound.coverage,inboundKm:c.inbound.value,inboundCoverage:c.inbound.coverage,volumeKm:c.volumeKm,unit:model.unit,currency:model.currency,steadyCost:c.cost.value,firstPeriodCost:c.cost.firstPeriod,status:c.status}))};
      data.sheets.comparison=workbookData(comparison).sheets.evidence;data.sheets.comparison.id='comparison';data.sheetOrder.push('comparison');
    }
    return data;
  }
  let active=null,sdkPromise=null;
  function loadSdk(){
    if(globalThis.STCTUniverEvidence)return Promise.resolve(globalThis.STCTUniverEvidence);
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='./vendor/univer/report.js';script.dataset.reportSdk='';
      const timer=setTimeout(()=>{script.remove();reject(new Error('UNIVER_LOAD_TIMEOUT'));},15000);
      script.onload=()=>{clearTimeout(timer);globalThis.STCTUniverEvidence?resolve(globalThis.STCTUniverEvidence):reject(new Error('UNIVER_API_UNAVAILABLE'));};
      script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('UNIVER_LOAD_FAILED'));};document.head.appendChild(script);
    }).catch(error=>{sdkPromise=null;throw error;});return sdkPromise;
  }
  function close(){if(active)active.dispose();}
  function open(state,locale='zh',actions={}){
    const model=project(state,locale),opener=document.activeElement;close();
    const root=document.createElement('div');root.className='scro-overlay trusted-report';root.role='dialog';root.setAttribute('aria-modal','true');root.setAttribute('aria-label','可信供应链报告工作区');root.tabIndex=-1;
    const metric=(id,key,v)=>`<button type="button" data-report-evidence="${esc(key)}" data-report-scenario="${esc(id)}">${esc(number(v))}</button>`;
    const ref=model.references.find(c=>c.id===(model.scope==='FULL_CHAIN'?'PLANNING_REFERENCE':model.scope==='UPSTREAM_ONLY'?'OBSERVED_KNOWN_INBOUND':'OBSERVED_BASELINE'));
    const summaryMetrics=model.focus?`<div class="tr-metrics">${(model.scope==='UPSTREAM_ONLY'?['inbound']:model.scope==='FULL_CHAIN'||model.scope==='TWO_END'?['outbound','inbound']:['outbound']).map(key=>`<article>${labels[key]} · ${esc(ref?.label||'来源信息不完整')}<strong>${number(model.summary[key].before)} → ${metric(model.focus.id,key,model.summary[key].after)} km</strong><span>变化 ${model.summary[key].changeRate==null?'不可比 / 未知':Display.percent(model.summary[key].changeRate)} · 共同可比物量覆盖 ${model.summary[key].coverage==null?'未知':Display.percent(model.summary[key].coverage)}</span></article>`).join('')}<article>同口径稳态费用<strong>${number(model.brief?.costBefore)} → ${metric(model.focus.id,'cost',model.brief?.costAfter)} ${esc(model.currency)}</strong><span>未知费用不补零；实际与假设费用请查明细</span></article></div>`:'';
    const candidateRow=c=>`<tr data-report-candidate="${esc(c.id)}" data-report-group="${esc(c.group)}"><th scope="row">${esc(c.label)}${c.group==='REFERENCE'?'':`<small>${esc(Explanation.comparisonLabel(model.projection,c,locale))}</small>`}<br>${esc(c.id)}<br>${esc(c.sites.join('、'))}</th><td>${metric(c.id,'sources',c.metricValue)}</td><td>${metric(c.id,'outbound',c.outbound.value)} km<small>物量覆盖 ${c.outbound.coverage==null?'未知':Display.percent(c.outbound.coverage)}</small></td><td>${metric(c.id,'inbound',c.inbound.value)} km<small>物量覆盖 ${c.inbound.coverage==null?'未知':Display.percent(c.inbound.coverage)}</small></td><td>${metric(c.id,'volumeKm',c.volumeKm)} ${esc(model.unit)}·km</td><td>${metric(c.id,'cost',c.cost.value)} ${esc(model.currency)}<small>首期 ${number(c.cost.firstPeriod)}</small></td><td><button type="button" data-report-evidence="capacity" data-report-scenario="${esc(c.id)}">${esc(c.capacity)}</button><small>${esc(c.status)}</small></td></tr>`;
    root.innerHTML=`<div class="scro-bar"><strong>可信供应链报告 · ${esc(model.identity.studyName)}</strong><button type="button" data-report-close>关闭</button></div><main class="tr-body"><section><p>${esc(model.scopeLabel)} · ${esc(model.periods.join(' / '))} · ${esc(model.unit)} · ${esc(model.distanceBasis)}</p><h1>${esc(model.conclusion)}</h1><p data-report-focus>重点候选：${esc(model.focus?.id||'无可比候选')} ${esc(model.focus?.sites.join('、')||'')}</p><p>${esc(model.rankingNote)}</p>${summaryMetrics}${model.analysisConditions?.sourceMode?`<p>来源关联：${esc(({FREE:'自由优化',PARTIAL:'部分固定',FIXED:'固定关联'})[model.analysisConditions.sourceMode]||model.analysisConditions.sourceMode)} · 供应商各期总量：${esc(({ADJUSTABLE:'可调整',FIXED_OBSERVED:'固定观察总量'})[model.analysisConditions.supplierTotalMode]||'来源信息不完整')}。供货规则与能力条件可在“假设、校验与来源”查看。</p>`:''}<ul>${model.limits.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><details><summary>研究与结果身份</summary><dl>${Object.entries(model.identity).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(text(v))}</dd>`).join('')}</dl><p>生成时间缺失时显示未知；不使用打开页面的时间代替结果时间。</p></details><div class="tr-exports">${['html','csv','json','md'].map(f=>`<button type="button" data-report-export="${f}">导出 ${f.toUpperCase()}</button>`).join('')}</div><p role="status" data-report-status></p></section><section><h2>现状与候选比较 · ${model.candidates.length} 个真实结果</h2><p>现状和规划参照单列；候选沿用保存的排名和分组。摘要变化采用共同可比样本；下表展示各自全量已知距离，点击可查看全部明细及范围。</p><div class="tr-scroll"><table><thead><tr><th>方案 / 仓网</th><th>排序目标值</th><th>配送加权距离</th><th>入库加权距离</th><th>合计物量公里</th><th>适用稳态 / 首期费用</th><th>容量 / 求解状态</th></tr></thead><tbody>${model.references.map(candidateRow).join('')}${model.candidates.map(candidateRow).join('')}</tbody></table></div></section><section data-report-detail hidden><h2>证据审阅</h2><label>方案 <select data-report-select>${[...model.references,...model.candidates].map(c=>`<option value="${esc(c.id)}">${esc(c.label)} · ${esc(c.sites.join('、'))}</option>`).join('')}</select></label> <label>指标 <select data-report-key>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><p data-report-detail-note></p><div class="tr-paging"><button type="button" data-report-prev>上一页</button><span data-report-page></span><button type="button" data-report-next>下一页</button><button type="button" data-report-workbook>在 Univer 只读工作簿中审阅</button><button type="button" data-report-workbook-close hidden>关闭工作簿</button><button type="button" data-report-copy hidden>复制选区</button></div><p role="status" data-report-sdk-status></p><div class="tr-univer" data-report-univer hidden></div><details open><summary>可访问的明细表（与工作簿同源）</summary><div class="tr-scroll" data-report-detail-table></div></details></section></main>`;
    document.body.appendChild(root);root.focus();
    let alive=true,token=0,book=null,detail=null;
    const q=s=>root.querySelector(s),current=()=>alive&&(!actions.isCurrent||actions.isCurrent());
    function disposeBook(){token++;if(book){book.dispose();book=null;}q('[data-report-univer]').hidden=true;q('[data-report-workbook-close]').hidden=true;q('[data-report-copy]').hidden=true;}
    function show(id,key,page=0){
      if(!current()){q('[data-report-status]').textContent='结果已过期，请关闭报告并重新分析。';disposeBook();return;}
      disposeBook();detail=evidence(model,id,key,page);q('[data-report-detail]').hidden=false;q('[data-report-select]').value=id;q('[data-report-key]').value=key;
      q('[data-report-detail-note]').textContent=`${detail.title} · ${id} · 快照 ${detail.scope.snapshotHash} · ${detail.note}`;
      q('[data-report-page]').textContent=`${detail.total} 条 · 每页最多 ${PAGE_SIZE} 条 · 第 ${page+1} 页`;
      q('[data-report-prev]').disabled=page===0;q('[data-report-next]').disabled=(page+1)*PAGE_SIZE>=detail.total;q('[data-report-workbook]').disabled=!detail.rows.length;
      q('[data-report-sdk-status]').textContent='工作簿尚未加载。明细表始终可用。';
      const cols=[...new Set(detail.rows.flatMap(Object.keys))];
      q('[data-report-detail-table]').innerHTML=`<table><thead><tr>${cols.map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${detail.rows.map(r=>`<tr data-report-record="${esc(r.recordId)}">${cols.map(k=>`<td>${esc(text(r[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    async function workbook(){
      disposeBook();const mine=token,data=workbookData(detail,model),container=q('[data-report-univer]');q('[data-report-sdk-status]').textContent='正在加载本地只读工作簿…';
      try{const sdk=await loadSdk();if(mine!==token||!current())return;container.hidden=false;const viewer=await sdk.mount(container,data);if(mine!==token||!current()){viewer.dispose();return;}book=viewer;q('[data-report-workbook-close]').hidden=false;q('[data-report-copy]').hidden=false;q('[data-report-sdk-status]').textContent='Univer 1.0.3 · 实际只读 · 当前方案 / 指标 / 页；可选择与复制。';}
      catch(error){if(mine===token&&alive){disposeBook();q('[data-report-sdk-status]').textContent=`工作簿不可用（${error.message}）。请使用下方同源明细表或既有导出。`;}}
    }
    async function copySelection(){try{if(!current()||!book)return;const value=book.selection().map(row=>row.map(Report.csvCell).join('\t')).join('\n');await navigator.clipboard.writeText(value);q('[data-report-sdk-status]').textContent='已复制选区（公式样式文本已按既有 CSV 安全规则处理）。';}catch(error){q('[data-report-sdk-status]').textContent='无法复制选区，请使用同源明细表或 CSV 导出。';}}
    const click=async event=>{
      const b=event.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-report-close')){close();return;}
      if(!current()){disposeBook();q('[data-report-status]').textContent='结果已过期，不能作为当前结论导出。';return;}
      if(b.dataset.reportEvidence)show(b.dataset.reportScenario,b.dataset.reportEvidence);
      if(b.hasAttribute('data-report-prev'))show(detail.scope.scenarioId,detail.key,detail.page-1);
      if(b.hasAttribute('data-report-next'))show(detail.scope.scenarioId,detail.key,detail.page+1);
      if(b.hasAttribute('data-report-workbook'))await workbook();
      if(b.hasAttribute('data-report-workbook-close'))disposeBook();
      if(b.hasAttribute('data-report-copy'))await copySelection();
      if(b.dataset.reportExport){try{if(!actions.export)throw new Error('REPORT_EXPORT_UNAVAILABLE');await actions.export(b.dataset.reportExport);}catch(error){q('[data-report-status]').textContent=`导出未完成：${error.code||error.message}`;}}
    };
    const change=event=>{if(event.target.matches('[data-report-select],[data-report-key]'))show(q('[data-report-select]').value,q('[data-report-key]').value);};
    const keydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'&&book&&q('[data-report-univer]').contains(document.activeElement)){event.preventDefault();copySelection();return;}if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='Tab'){const items=[...root.querySelectorAll('button,select,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===root)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    const route=()=>close();root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('keydown',keydown);globalThis.addEventListener('hashchange',route);
    const identityWatch=setInterval(()=>{if(!current())close();},300);
    // ponytail: one report and one paged workbook; no second persistence or report calculation engine.
    active={dispose(){if(!alive)return;alive=false;disposeBook();clearInterval(identityWatch);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('keydown',keydown);globalThis.removeEventListener('hashchange',route);root.remove();active=null;if(opener?.isConnected)opener.focus();}};
    return model;
  }
  return Object.freeze({project,evidence,workbookData,open,close,PAGE_SIZE});
});
