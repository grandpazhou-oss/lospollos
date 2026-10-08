(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  (root.STCTPlatformV19=root.STCTPlatformV19||{}).mapShowcase=api;
})(globalThis,function(root){
  'use strict';
  const SVG='http://www.w3.org/2000/svg',PULSE_LIMIT=120,CHANGE_LIMIT=1200;
  const COPY={
    zh:{pulse:'关系方向演示',change:'方案变化演示',pause:'暂停',resume:'继续',reset:'重新演示',close:'退出演示',phases:['参照方案','变化交接','新规划方案'],running:'正在演示',paused:'已暂停',complete:'演示完成',static:'减少动态效果：使用静态方向与步骤',hidden:'页面离开前台，已暂停；点击继续恢复',limit:'已达到 60 秒，已暂停',unavailable:'当前地图不可用，演示暂停。地图恢复后可点击继续。',noMap:'此演示需要可用的地理地图；示意视图不播放动画。',noCompare:'当前缺少可比较的参照与新方案。',empty:'当前范围没有可绘制的分配关系。',count:'展示关系',of:' / ',note:'仅演示已计算的业务分配方向，不是车辆 GPS、实际运输轨迹或道路路线；动画速度不代表运输时效。',changeNote:'过渡只改变显示，不产生中间方案，不插值业务物量；数值与报告仍以原结果为准。',reduced:'静态演示',scope:'当前方案、期间及地图筛选',partial:'为保持流畅，仅演示部分关系，结果数据保持完整。'},
    en:{pulse:'Assignment direction',change:'Scenario transition',pause:'Pause',resume:'Resume',reset:'Restart',close:'Exit presentation',phases:['Reference','Changing assignments','Candidate'],running:'Playing',paused:'Paused',complete:'Complete',static:'Reduced motion: static directions and steps',hidden:'Paused while the page is hidden; resume explicitly',limit:'Paused after 60 seconds',unavailable:'Map unavailable; resume when it is ready.',noMap:'A geographic map is required. Schematic views do not animate.',noCompare:'Comparable reference and candidate results are required.',empty:'No drawable assignments in the current scope.',count:'Relations shown',of:' / ',note:'Calculated business assignments only: not GPS, vehicle tracks or road routes. Animation speed does not represent travel time.',changeNote:'Transitions change display only: no intermediate plan or interpolated business quantities. Results and reports remain authoritative.',reduced:'Static display',scope:'Current plan, period and map filters',partial:'Only part of the relations is animated for responsiveness; result data stays complete.'},
    ja:{pulse:'割当方向の表示',change:'案の変化を表示',pause:'一時停止',resume:'再開',reset:'最初から',close:'表示を終了',phases:['参照案','割当の切替','新計画案'],running:'再生中',paused:'一時停止',complete:'再生完了',static:'動きを抑制：静止方向と段階を表示',hidden:'非表示になったため停止。再開ボタンで戻れます',limit:'60秒経過のため停止',unavailable:'地図を利用できません。復帰後に再開できます。',noMap:'地理地図が必要です。模式図では再生しません。',noCompare:'比較できる参照案と候補が必要です。',empty:'現在の条件に描画可能な割当がありません。',count:'表示する関係',of:' / ',note:'計算済みの業務割当方向のみ。GPS・実際の走行軌跡・道路経路ではありません。速度は輸送時間を示しません。',changeNote:'表示だけを切り替えます。途中の計画や業務物量の補間は生成せず、結果と報告を基準とします。',reduced:'静止表示',scope:'現在の案・期間・地図条件',partial:'応答性のため一部の関係を表示。結果データはすべて保持。'}
  };
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const coordinate=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
  const color=value=>typeof value==='string'&&/^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.,%+\-\s]+\))$/i.test(value)?value:'#64748b';
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  function prepareFeatures(features){
    const links=[],points=new Map(),seen=new Set();
    for(const feature of features||[]){
      const p=feature.properties||{},geometry=feature.geometry;
      if(p.context===true)continue;
      if(geometry?.type==='Point'&&coordinate(geometry.coordinates)&&typeof p.entityId==='string')points.set(p.entityId,{id:p.entityId,coordinate:geometry.coordinates.slice(0,2),kind:p.kind,label:p.label||p.entityId,color:color(p.color),selected:p.selected===true,referenceSelected:p.referenceSelected===true,candidateSelected:p.candidateSelected===true});
      if(geometry?.type!=='LineString'||!['reference','candidate'].includes(p.comparison)||typeof p.relationId!=='string'||!Number.isFinite(p.quantity)||p.quantity<=0||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||!geometry.coordinates.every(coordinate))continue;
      const id=JSON.stringify([p.relationId,p.comparison]);if(seen.has(id))continue;seen.add(id);
      links.push({id,relationId:p.relationId,side:p.comparison,fromNodeId:p.fromNodeId,toNodeId:p.toNodeId,warehouseId:p.warehouseId,color:color(p.color),quantity:p.quantity,change:p.change||'UNCHANGED',coordinates:geometry.coordinates.map(point=>point.slice(0,2))});
    }
    links.sort((a,b)=>compare(a.id,b.id));
    const candidate=links.filter(link=>link.side==='candidate'),reference=links.filter(link=>link.side==='reference');
    const pulseSide=candidate.length?'candidate':'reference',pool=(candidate.length?candidate:reference).slice().sort((a,b)=>b.quantity-a.quantity||compare(a.id,b.id));
    const groups=new Map(),change=[];for(const link of links){const group=groups.get(link.relationId)||[];group.push(link);groups.set(link.relationId,group);}for(const group of groups.values()){if(change.length+group.length>CHANGE_LIMIT)break;change.push(...group);}
    return {links,points:[...points.values()].sort((a,b)=>compare(a.id,b.id)),candidate,reference,pulseSide,pulse:pool.slice(0,PULSE_LIMIT),change,pulseTotal:pool.length};
  }
  function pointAt(path,distance){
    let remaining=Math.max(0,distance);
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(remaining<=length&&length>0){const t=remaining/length;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}remaining-=length;
    }
    return path[path.length-1]?.slice()||[0,0];
  }
  function pulseFrame(path,elapsedMs,id=''){
    const length=path.slice(1).reduce((sum,point,index)=>sum+Math.hypot(point[0]-path[index][0],point[1]-path[index][1]),0);
    let hash=0;for(const char of id)hash=(hash*31+char.charCodeAt(0))>>>0;
    const fraction=((Math.max(0,elapsedMs)/6000+hash%997/997)%1),distance=length*fraction;
    const head=pointAt(path,distance),tail=pointAt(path,Math.max(0,distance-Math.min(24,length*.12)));
    return {head,tail,angle:Math.atan2(head[1]-tail[1],head[0]-tail[0])*180/Math.PI,length};
  }
  function changeFrame(elapsedMs){
    const elapsed=Math.max(0,Math.min(9000,Number(elapsedMs)||0));
    const phase=elapsed<3000?0:elapsed<6000?1:2,t=Math.max(0,Math.min(1,(elapsed-3000)/3000));
    return {phase,referenceOpacity:1-t,candidateOpacity:t,spotlight:phase===1,done:elapsed>=9000};
  }
  function inBounds(path,width,height){return path.length>1&&path.every(p=>p.every(Number.isFinite))&&Math.max(...path.map(p=>p[0]))>=0&&Math.min(...path.map(p=>p[0]))<=width&&Math.max(...path.map(p=>p[1]))>=0&&Math.min(...path.map(p=>p[1]))<=height;}
  function create(getContext){
    let current=null,panel=null,overlay=null,doc=null,active=false,mode='pulse',running=false,elapsed=0,lastTime=null,raf=null,lastDraw=-Infinity,reason='',identity='',data=null,projected=[],map=null,phaseIndex=0,pulseNodes=null,changeNodes=null,pointNodes=null,facilityNodes=null;
    const hidden=new Map(),handlers=[];
    const context=()=>{try{return getContext(mode)||null;}catch(_){return null;}};
    const copy=()=>COPY[current?.locale]||COPY.zh;
    const frameRequest=callback=>(root.requestAnimationFrame||root.setTimeout)(callback);
    const cancelFrame=id=>(root.cancelAnimationFrame||root.clearTimeout)(id);
    const available=()=>Boolean(current?.map&&current.ready&&!current.noWebGL&&current.showcaseReady!==false&&current.host?.isConnected!==false&&current.map.getCanvas?.()?.isConnected!==false);
    function status(){const total=mode==='pulse'?data?.pulseTotal||0:data?.links.length||0;return {active,open:active,mode:active?mode:null,running,playing:running,elapsedMs:elapsed,phase:['reference','changes','candidate'][phaseIndex],phaseIndex,reason,available:active&&available(),reducedMotion:Boolean(current?.reducedMotion),animatedCount:mode==='pulse'?data?.pulse.length||0:data?.change.length||0,totalCount:total,totalLinks:total,renderedLinks:projected.length,limited:total>(mode==='pulse'?PULSE_LIMIT:CHANGE_LIMIT),rafPending:raf!==null,pendingFrame:raf!==null,hiddenLayers:[...hidden.keys()]};}
    function updatePanel(){
      if(!panel)return;const c=copy(),s=status();
      panel.querySelector('.p7-showcase-status').textContent=!available()?current?.unavailableReason||c.noMap:reason==='NO_COMPARISON'?c.noCompare:!s.totalCount?c.empty:current.reducedMotion?c.static:reason==='HIDDEN'?c.hidden:reason==='LIMIT'?c.limit:reason==='COMPLETE'?c.complete:reason==='UNAVAILABLE'?c.unavailable:running?c.running:c.paused;
      panel.querySelector('.p7-showcase-summary').textContent=[mode==='change'?[current.referenceName,current.scenarioName].filter(Boolean).join(' → '):data?.pulseSide==='reference'?c.phases[0]+' · '+(current.referenceName||''):current.scenarioName,current.periodLabel,current.selectedLabel,c.count+' '+s.animatedCount+c.of+s.totalCount,s.limited?c.partial:''].filter(Boolean).join(' · ');
      const blocked=mode==='change'&&!current.canCompare;
      const pause=panel.querySelector('[data-showcase-action="pause"]');pause.textContent=current.reducedMotion?c.reduced:running?c.pause:c.resume;pause.disabled=!available()||current.reducedMotion||!s.totalCount||blocked;pause.setAttribute('aria-pressed',String(!running));
      panel.querySelector('[data-showcase-action="reset"]').disabled=!available()||!s.totalCount||blocked;
      for(const button of panel.querySelectorAll('[data-showcase-action="phase"]')){button.setAttribute('aria-pressed',String(Number(button.dataset.phase)===phaseIndex));button.disabled=!available()||!s.totalCount||blocked;}
    }
    function stop(nextReason='PAUSED'){running=false;lastTime=null;if(raf!==null){cancelFrame(raf);raf=null;}reason=nextReason;updatePanel();}
    function hideLayers(){
      if(mode!=='change'||!available()||!current.canCompare)return;
      for(const layer of map.getStyle()?.layers||[]){
        if(!/^p7-supply(?:-relations(?:-reference|-candidate)?|-points|-facilities|-coverage-halo|-clustered(?:-.*)?)$/.test(layer.id))continue;
        if(!hidden.has(layer.id))hidden.set(layer.id,map.getLayoutProperty(layer.id,'visibility'));
        if(map.getLayoutProperty(layer.id,'visibility')!=='none')map.setLayoutProperty(layer.id,'visibility','none');
      }
    }
    function restoreLayers(){
      for(const [id,visibility] of hidden){try{if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',visibility===undefined?null:visibility);}catch(_){}}
      hidden.clear();
    }
    function project(){
      projected=[];pulseNodes=null;changeNodes=null;pointNodes=null;facilityNodes=null;if(!overlay||!available())return;
      const pane=overlay.parentElement,canvas=map.getCanvas?.()||pane,box=canvas.getBoundingClientRect(),parent=pane.getBoundingClientRect();
      const width=box.width||canvas.clientWidth,height=box.height||canvas.clientHeight;
      if(!(width>0&&height>0)){stop('UNAVAILABLE');return;}
      overlay.style.left=(box.left-parent.left)+'px';overlay.style.top=(box.top-parent.top)+'px';overlay.style.width=width+'px';overlay.style.height=height+'px';overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);
      for(const link of mode==='pulse'?data.pulse:data.change){const path=link.coordinates.map(point=>{const p=map.project(point);return [p.x,p.y];});if(inBounds(path,width,height))projected.push({...link,path});}
      if(mode==='change')for(const point of data.points.filter(row=>row.kind==='facility'&&(row.referenceSelected||row.candidateSelected))){const p=map.project(point.coordinate);if(p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height)point.projected=[p.x,p.y];else point.projected=null;}
    }
    function draw(){
      if(!overlay||!available())return;
      const stage=changeFrame(elapsed);phaseIndex=stage.phase;
      overlay.dataset.frameMs=String(Math.round(elapsed));overlay.dataset.mode=mode;
      if(mode==='pulse'){
        if(!pulseNodes){overlay.innerHTML=projected.map(link=>{const c=escape(link.color),id=escape(link.id);return `<path data-showcase-trail="${id}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".78"/><circle data-showcase-pulse="${id}" r="3.5" fill="${c}" stroke="${current.dark?'#0b1220':'#ffffff'}" stroke-width="1.2"/>${current.reducedMotion?`<path data-showcase-arrow d="M-5,-4 L2,0 L-5,4" fill="none" stroke="${c}" stroke-width="2"/>`:''}`;}).join('');const circles=overlay.querySelectorAll('[data-showcase-pulse]'),trails=overlay.querySelectorAll('[data-showcase-trail]'),arrows=overlay.querySelectorAll('[data-showcase-arrow]');pulseNodes=projected.map((link,i)=>({link,circle:circles[i],trail:trails[i],arrow:arrows[i]}));}
        for(const {link,circle,trail,arrow} of pulseNodes){const f=pulseFrame(link.path,current.reducedMotion?3900:elapsed,link.id),p=f.head,t=f.tail;circle.setAttribute('cx',p[0]);circle.setAttribute('cy',p[1]);trail.setAttribute('d',`M${t[0]},${t[1]} L${p[0]},${p[1]}`);arrow?.setAttribute('transform',`translate(${p[0]} ${p[1]}) rotate(${f.angle})`);}
      }else{
        if(!changeNodes){const endpoints=new Map(),visiblePoints=new Set(data.points.filter(point=>point.kind!=='facility').map(point=>point.id));
          for(const link of projected)for(const [id,p] of [[link.fromNodeId,link.path[0]],[link.toNodeId,link.path[link.path.length-1]]]){if(!visiblePoints.has(id))continue;const found=endpoints.get(id)||{id,p,reference:new Set(),candidate:new Set(),changed:false};found[link.side].add(link.color);found.changed=found.changed||link.change!=='UNCHANGED';endpoints.set(id,found);}
          const sites=data.points.filter(point=>point.kind==='facility'&&(point.referenceSelected||point.candidateSelected)&&point.projected).slice(0,100);
          overlay.innerHTML=projected.map(link=>`<path data-showcase-side="${link.side}" data-relation-id="${escape(link.relationId)}" d="${link.path.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ')}" fill="none" stroke="${escape(link.color)}" stroke-width="${link.change==='UNCHANGED'?1.2:2.5}" stroke-dasharray="${link.side==='reference'?'3 4':'none'}"/>`).join('')+[...endpoints.values()].map(point=>`<circle data-showcase-endpoint="${escape(point.id)}" cx="${point.p[0]}" cy="${point.p[1]}"/>`).join('')+sites.map(point=>{const [x,y]=point.projected,label=escape(point.label.slice(0,24)),width=Math.min(164,Math.max(42,point.label.slice(0,24).length*7+10));return `<g data-showcase-warehouse="${escape(point.id)}" data-reference-selected="${point.referenceSelected}" data-candidate-selected="${point.candidateSelected}" data-site-color="${point.color}"><rect x="${x-6}" y="${y-6}" width="12" height="12" fill="${point.selected?point.color:'#ffffff'}" stroke="${point.color}" stroke-width="2"/><rect data-showcase-warehouse-label x="${x+10}" y="${y-9}" width="${width}" height="18" rx="3" fill="${current.dark?'#111827':'#ffffff'}" stroke="${point.color}" stroke-width="1"/><text x="${x+15}" y="${y+3}" fill="${current.dark?'#ffffff':'#172033'}" font-size="11" font-weight="600">${label}</text></g>`;}).join('');
          const lines=overlay.querySelectorAll('[data-showcase-side]'),circles=overlay.querySelectorAll('[data-showcase-endpoint]'),facilityGroups=overlay.querySelectorAll('[data-showcase-warehouse]');changeNodes=projected.map((link,i)=>({link,node:lines[i]}));pointNodes=[...endpoints.values()].map((point,i)=>({...point,node:circles[i]}));facilityNodes=sites.map((point,i)=>({point,node:facilityGroups[i]}));
        }
        for(const {link,node} of changeNodes)node.setAttribute('opacity',(link.side==='reference'?stage.referenceOpacity:stage.candidateOpacity)*(link.change==='UNCHANGED'?.25:.88));
        for(const point of pointNodes){const colors=new Set([...(stage.referenceOpacity>0?point.reference:[]),...(stage.candidateOpacity>0?point.candidate:[])]),c=colors.size===1?[...colors][0]:'#64748b',spot=stage.spotlight&&point.changed,opacity=Math.max(point.reference.size?stage.referenceOpacity:0,point.candidate.size?stage.candidateOpacity:0);point.node.setAttribute('r',spot?10:4);point.node.setAttribute('fill',c);point.node.setAttribute('fill-opacity',spot?.2:opacity);point.node.setAttribute('stroke',c);point.node.setAttribute('stroke-width',spot?2:1);point.node.setAttribute('opacity',opacity);}
        for(const {point,node} of facilityNodes||[]){const both=point.referenceSelected&&point.candidateSelected,selected=both||stage.referenceOpacity>=stage.candidateOpacity&&point.referenceSelected||stage.candidateOpacity>stage.referenceOpacity&&point.candidateSelected,opacity=both?1:Math.max(point.referenceSelected?stage.referenceOpacity:0,point.candidateSelected?stage.candidateOpacity:0),rect=node.querySelector('rect');rect?.setAttribute('fill',selected?point.color:'#ffffff');node.setAttribute('opacity',opacity);}
      }
    }
    function frame(time){
      raf=null;if(!active||!running)return;
      if(doc.visibilityState==='hidden'){stop('HIDDEN');return;}
      if(!available()){stop('UNAVAILABLE');return;}
      if(current.reducedMotion){stop('REDUCED');draw();return;}
      const stamp=Number.isFinite(time)?time:Date.now();if(lastTime!==null)elapsed+=Math.max(0,stamp-lastTime);lastTime=stamp;
      const limit=mode==='change'?9000:60000;elapsed=Math.min(elapsed,limit);
      if(stamp-lastDraw>=32||elapsed===limit){const before=phaseIndex;draw();lastDraw=stamp;if(before!==phaseIndex)updatePanel();}
      if(elapsed>=limit){stop(mode==='change'?'COMPLETE':'LIMIT');return;}
      raf=frameRequest(frame);
    }
    function start(){
      if(!active||!available()||current.reducedMotion||!status().totalCount||mode==='change'&&!current.canCompare)return;
      if(doc.visibilityState==='hidden'){stop('HIDDEN');return;}
      if(elapsed>=(mode==='change'?9000:60000))elapsed=0;
      reason='';running=true;lastTime=null;lastDraw=-Infinity;updatePanel();if(raf===null)raf=frameRequest(frame);
    }
    function onClick(event){
      const button=event.target.closest('[data-showcase-action]');if(!button||!panel.contains(button))return;
      const action=button.dataset.showcaseAction;
      if(action==='close'){const trigger=current.host.querySelector('[data-p7-toolgroup="analysis"] > summary');close();trigger?.focus({preventScroll:true});return;}
      if(action==='pause'){if(running)stop();else{refresh();start();}return;}
      if(action==='reset'){stop();elapsed=0;phaseIndex=0;project();draw();updatePanel();if(!current.reducedMotion)start();return;}
      if(action==='phase'){stop();phaseIndex=Math.max(0,Math.min(2,Number(button.dataset.phase)||0));elapsed=[0,4500,9000][phaseIndex];draw();updatePanel();}
    }
    function refresh(){
      if(!active)return;const next=context();if(!next||JSON.stringify(next.identity)!==identity||next.host!==current.host||next.map!==map){close();return;}current=next;
      if(!available()){stop('UNAVAILABLE');if(overlay)overlay.innerHTML='';return;}
      if(mode==='change'&&!current.canCompare){stop('NO_COMPARISON');if(overlay)overlay.innerHTML='';return;}
      if(current.reducedMotion&&running)stop('REDUCED');
      try{hideLayers();project();draw();updatePanel();}catch(_){stop('UNAVAILABLE');if(overlay)overlay.innerHTML='';restoreLayers();}
    }
    function close(){
      if(!active)return;stop();active=false;
      for(const [target,event,handler] of handlers.splice(0)){try{target===doc?target.removeEventListener(event,handler):target.off(event,handler);}catch(_){}}
      restoreLayers();current?.host.classList.remove('p7-showcase-transition-active');panel?.removeEventListener('click',onClick);panel?.remove();overlay?.remove();panel=null;overlay=null;projected=[];pulseNodes=null;changeNodes=null;pointNodes=null;facilityNodes=null;data=null;current=null;map=null;reason='';elapsed=0;
    }
    function open(nextMode='pulse'){
      if(!['pulse','change'].includes(nextMode))return false;
      close();mode=nextMode;current=context();if(!current?.host)return false;
      doc=current.host.ownerDocument||root.document;if(!doc)return false;
      map=current.map;identity=JSON.stringify(current.identity);data=prepareFeatures(current.features);active=true;phaseIndex=0;elapsed=0;reason='';
      const c=copy();if(mode==='change')current.host.classList.add('p7-showcase-transition-active');panel=doc.createElement('section');panel.className='p7-showcase';panel.setAttribute('aria-label',c[mode]);
      panel.innerHTML=`<div class="p7-showcase-heading"><h3 class="p7-showcase-title">${escape(c[mode])}</h3></div><p class="p7-showcase-summary"></p><p class="p7-showcase-status" role="status" aria-live="polite"></p>${mode==='change'?`<nav class="p7-showcase-steps" aria-label="${escape(c.change)}">${c.phases.map((label,index)=>`<button type="button" data-showcase-action="phase" data-phase="${index}" aria-pressed="${index===0}">${index+1}. ${escape(label)}</button>`).join('')}</nav>`:''}<div class="p7-showcase-actions"><button type="button" data-showcase-action="pause"></button><button type="button" data-showcase-action="reset">${escape(c.reset)}</button><button type="button" data-showcase-action="close">${escape(c.close)}</button></div><p class="p7-showcase-note">${escape(c.note)} ${mode==='change'?escape(c.changeNote):''}</p>`;
      const topbar=current.host.querySelector('.p7-map-topbar');if(topbar)topbar.after(panel);else current.host.prepend(panel);panel.addEventListener('click',onClick);
      const pane=current.host.querySelector('.p7-map-pane.is-reference')||current.host.querySelector('.p7-map-pane');
      if(pane){overlay=doc.createElementNS(SVG,'svg');overlay.classList.add('p7-showcase-overlay');overlay.setAttribute('aria-hidden','true');overlay.style.pointerEvents='none';pane.append(overlay);}
      if(mode==='change'&&!current.canCompare)reason='NO_COMPARISON';
      const visibility=()=>{if(doc.visibilityState==='hidden')stop('HIDDEN');};doc.addEventListener('visibilitychange',visibility);handlers.push([doc,'visibilitychange',visibility]);
      if(map?.on){const move=()=>refresh(),loaded=()=>close(),style=()=>{if(active&&hidden.size&&[...hidden.keys()].some(id=>!map.getLayer(id)))close();};for(const [event,handler] of [['move',move],['resize',move],['style.load',loaded],['styledata',style]]){map.on(event,handler);handlers.push([map,event,handler]);}}
      if(available()&&reason!=='NO_COMPARISON'){try{hideLayers();project();draw();}catch(_){reason='UNAVAILABLE';restoreLayers();}}
      updatePanel();if(reason!=='UNAVAILABLE')start();panel.querySelector('[data-showcase-action="close"]')?.focus({preventScroll:true});return true;
    }
    return Object.freeze({open,close,refresh,status});
  }
  return Object.freeze({create,prepareFeatures,pulseFrame,changeFrame,inBounds,PULSE_LIMIT,CHANGE_LIMIT});
});

// Optional display tools. All quantities come from the existing immutable map projection.
(function(root){
  'use strict';
  const ns=root.STCTPlatformV19,S=ns.mapShowcase,SVG='http://www.w3.org/2000/svg',ID='p7-showcase-advanced';
  const TEXT={
    zh:{arcs:'3D 仓网弧线',columns:'需求立体柱图',network:'缩放货流网络',lens:'方案对比透镜',playback:'月度经营回放',close:'退出演示',play:'播放月份',pause:'暂停回放',previous:'上月',next:'下月',reference:'参照',candidate:'新方案',volume:'物量',peak:'峰值 · 全期间仓网（未叠加地图筛选）',distance:'距离',cost:'费用',unknown:'未提供',all:'全部期间',detail:'关系明细',scale:'统一线宽刻度',height:'六边形随缩放聚合；柱高按地图缩放作视觉放大，物量比例刻度跨期间一致，不是库存或仓容量；跨期间使用相同刻度。',boundary:'显示效果不参与求解；联系不是道路路线，光点不是车辆 GPS。',noMap:'需要可用的地理地图；请先退出双图或卷帘。',noCompare:'需要有效参照和候选结果。',noDemand:'当前运输段或筛选下没有可定位的配送需求。',noPeriod:'当前页面没有可回放的期间。',scope:'当前期间和筛选内',limited:'仅显示前 120 条主要关系，完整明细仍保留。',arcNote:'弧线高度仅用于展示；线宽表示物量，悬停查看结果账本。',networkNote:'按起点、仓库及运输段聚合。放大展开，点击联系查看成员；聚合中心是显示位置。',lensNote:'圆内参照，圆外新方案。拖动圆框或用方向键移动，Shift 加速。只比较业务联系，不表示地理服务边界。',changed:'窗口内变化收货对象',legs:['入库','配送','中转'],partial:'坐标缺失或隐藏的关系不在地图统计内；完整报告保持不变。',complete:'回放完成',stopped:'已暂停',failed:'地图效果未能加载，已恢复普通地图。'},
    en:{arcs:'3D network arcs',columns:'Demand columns',network:'Zoom flow network',lens:'Scenario comparison lens',playback:'Monthly playback',close:'Exit presentation',play:'Play months',pause:'Pause playback',previous:'Previous month',next:'Next month',reference:'Reference',candidate:'Candidate',volume:'Volume',peak:'Peak · all periods/network (before map filters)',distance:'Distance',cost:'Cost',unknown:'Unknown',all:'All periods',detail:'Relation details',scale:'Shared width scale',height:'Hexes aggregate by zoom. Height is magnified for the camera; the quantity ratio scale is constant across periods, not inventory or capacity.',boundary:'Display only, never used by the solver. Links are not road routes or GPS.',noMap:'A geographic map is required. Exit split/swipe comparison first.',noCompare:'A valid reference and candidate are required.',noDemand:'No locatable outbound demand under this leg/filter.',noPeriod:'No playable periods on this page.',scope:'Current period and filters',limited:'Only the top 120 relations are displayed; all details are retained.',arcNote:'Arc height is illustrative. Width represents volume; hover for ledger metrics.',networkNote:'Grouped by source, warehouse and leg. Zoom to expand; click for members. Centers are display locations.',lensNote:'Reference inside, candidate outside. Drag the circle or use arrow keys; Shift moves faster. Business relations, not geographic service boundaries.',changed:'Changed receiving objects in lens',legs:['Inbound','Outbound','Transfer'],partial:'Unmapped/hidden relations are excluded from map totals; the full report is unchanged.',complete:'Playback complete',stopped:'Paused',failed:'Effect unavailable; the ordinary map has been restored.'},
    ja:{arcs:'3D ネットワーク弧線',columns:'需要の立体柱',network:'ズーム貨物流ネットワーク',lens:'計画比較レンズ',playback:'月次再生',close:'表示を終了',play:'月を再生',pause:'再生を停止',previous:'前月',next:'翌月',reference:'参照',candidate:'候補',volume:'物量',peak:'ピーク · 全期間の倉庫網（地図フィルター適用前）',distance:'距離',cost:'費用',unknown:'未提供',all:'全期間',detail:'関係の詳細',scale:'共通の線幅尺度',height:'ズームで集約し高さを視覚拡大。物量の比率尺度は期間間で同一。在庫・容量ではありません。',boundary:'表示のみで求解に使用しません。道路経路や GPS ではありません。',noMap:'地理地図が必要です。分割・スワイプ比較を閉じてください。',noCompare:'有効な参照と候補が必要です。',noDemand:'現在の区間・条件に位置を表示できる配送需要がありません。',noPeriod:'再生できる期間がありません。',scope:'現在の期間と条件',limited:'主要120関係を表示。完全な明細は保持。',arcNote:'弧の高さは表示用。線幅は物量。ホバーで台帳指標を表示。',networkNote:'起点・倉庫・区間ごとに集約。拡大で展開、クリックで内訳。中心は表示位置です。',lensNote:'円内は参照、円外は候補。ドラッグまたは方向キーで移動、Shiftで加速。業務関係を比較し、地理的境界ではありません。',changed:'円内の変更対象',legs:['入庫','配送','中継'],partial:'座標なし・非表示関係は地図集計の対象外。完全な報告は変更されません。',complete:'再生完了',stopped:'停止中',failed:'表示を読込できず、通常地図に復帰しました。'}
  };
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const leg=l=>decodeURIComponent(l.relationId).split('\0')[0];
  const sideLinks=d=>d.candidate.length?d.candidate:d.reference;
  function mercator(p){const lat=Math.max(-85.051129,Math.min(85.051129,p[1]))*Math.PI/180;return [(p[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2];}
  function geographic(p){return [p[0]*360-180,Math.atan(Math.sinh(Math.PI*(1-2*p[1])))*180/Math.PI];}
  function aggregateFlows(links,zoom){
    const cells=new Map(),size=96/(512*2**Math.floor(Math.max(0,Math.min(22,zoom)))),expanded=zoom>=9;
    for(const l of links){const xy=mercator(l.coordinates.at(-1)),key=JSON.stringify([l.fromNodeId,l.warehouseId,leg(l),expanded?l.relationId:[Math.floor(xy[0]/size),Math.floor(xy[1]/size)]]),g=cells.get(key)||{id:key,from:l.coordinates[0].slice(),color:l.color,quantity:0,members:[],x:0,y:0};g.quantity+=l.quantity;g.x+=xy[0]*l.quantity;g.y+=xy[1]*l.quantity;g.members.push(l.relationId);cells.set(key,g);}
    return [...cells.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(g=>({...g,to:geographic([g.x/g.quantity,g.y/g.quantity]),members:g.members.sort()}));
  }
  function demandHexagons(links,scale,radius=.0015){
    // ponytail: fixed geographic hexes, not GPU aggregation; revisit only for >20k mapped receivers.
    const cells=new Map(),root3=Math.sqrt(3);
    for(const l of links.filter(l=>leg(l)==='outbound')){const [x,y]=mercator(l.coordinates.at(-1)),fq=(root3*x/3-y/3)/radius,fr=2*y/(3*radius);let q=Math.round(fq),r=Math.round(fr),s=Math.round(-fq-fr);const dq=Math.abs(q-fq),dr=Math.abs(r-fr),ds=Math.abs(s+fq+fr);if(dq>dr&&dq>ds)q=-r-s;else if(dr>ds)r=-q-s;const key=q+':'+r,g=cells.get(key)||{q,r,quantity:0,members:[]};g.quantity+=l.quantity;g.members.push(l.relationId);cells.set(key,g);}
    const maximum=Math.max(1,Number(scale)||1);
    return [...cells.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,g])=>{const x=radius*root3*(g.q+g.r/2),y=radius*1.5*g.r,ring=Array.from({length:6},(_,i)=>geographic([x+radius*Math.cos((60*i-30)*Math.PI/180),y+radius*Math.sin((60*i-30)*Math.PI/180)]));ring.push(ring[0].slice());return {type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{cellId:key,quantity:g.quantity,height:5000000*g.quantity/maximum,members:JSON.stringify(g.members.sort())}};});
  }
  function lensTotals(links,points,center,radius){
    const inside=new Set(points.filter(p=>Math.hypot(p.x-center[0],p.y-center[1])<=radius).map(p=>p.id)),totals={inbound:{reference:0,candidate:0},outbound:{reference:0,candidate:0},transfer:{reference:0,candidate:0}},changed=new Set();
    for(const l of links)if(inside.has(l.toNodeId)&&totals[leg(l)]){totals[leg(l)][l.side]+=l.quantity;if(l.change!=='UNCHANGED')changed.add(JSON.stringify([leg(l),l.toNodeId]));}
    return {totals,changed:changed.size};
  }
  function arcPath(l){const a=mercator(l.coordinates[0]),b=mercator(l.coordinates.at(-1)),height=Math.min(.01,Math.hypot(b[0]-a[0],b[1]-a[1])*.22);return Array.from({length:33},(_,i)=>{const t=i/32;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,Math.sin(Math.PI*t)*height];});}
  function screenPoint(p,m,w,h){const v=[p[0],p[1],p[2],1],clip=Array.from({length:4},(_,i)=>v.reduce((sum,n,j)=>sum+m[j*4+i]*n,0));return clip[3]>0?[(clip[0]/clip[3]+1)*w/2,(1-clip[1]/clip[3])*h/2]:null;}
  function arcLayer(links,maximum,onFailure){
    const rows=links.slice().sort((a,b)=>b.quantity-a.quantity||a.id.localeCompare(b.id)).slice(0,120).map(l=>({...l,path:arcPath(l)})),state={frames:0,triangles:0,matrix:null};
    let program,buffer,vao,shaders=[];
    return {id:ID,type:'custom',renderingMode:'3d',rows,state,
      onAdd(map,gl){
        const compile=(type,text)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
        try{
          program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nin vec3 a_pos;in vec3 a_next;in float a_side;in float a_width;in vec3 a_color;uniform mat4 u_matrix;uniform vec2 u_size;out vec3 v_color;void main(){vec4 p=u_matrix*vec4(a_pos,1.);vec4 n=u_matrix*vec4(a_next,1.);vec2 d=(n.xy/n.w-p.xy/p.w)*u_size;vec2 normal=vec2(-d.y,d.x)/max(length(d),.001);p.xy+=normal*a_side*a_width/u_size*p.w;gl_Position=p;v_color=a_color;}'));
          gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;in vec3 v_color;out vec4 fragColor;void main(){fragColor=vec4(v_color,.9);}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
          const vertices=[];for(const l of rows){const hex=/^#[\da-f]{6}$/i.test(l.color)?l.color:'#64748b',rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),width=1.5+5.5*Math.sqrt(l.quantity/Math.max(l.quantity,maximum||1));for(let i=0;i<l.path.length-1;i++){const a=l.path[i],b=l.path[i+1];for(const [p,n,side]of[[a,b,-1],[a,b,1],[b,a,-1],[a,b,-1],[b,a,-1],[b,a,1]])vertices.push(...p,...n,side,width,...rgb);}}
          buffer=gl.createBuffer();vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);for(const [name,count,offset]of[['a_pos',3,0],['a_next',3,3],['a_side',1,6],['a_width',1,7],['a_color',3,8]]){const at=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,count,gl.FLOAT,false,44,offset*4);}state.triangles=vertices.length/33;gl.bindVertexArray(null);
        }catch(e){state.error=String(e.message);onFailure(e);}
      },
      render(gl,args){if(state.error||!program)return;const matrix=args.defaultProjectionData?.mainMatrix||args;if(!matrix||matrix.length!==16)return;state.matrix=Array.from(matrix);state.frames++;gl.useProgram(program);gl.uniformMatrix4fv(gl.getUniformLocation(program,'u_matrix'),false,matrix);gl.uniform2f(gl.getUniformLocation(program,'u_size'),gl.canvas.clientWidth,gl.canvas.clientHeight);gl.bindVertexArray(vao);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,state.triangles*3);gl.bindVertexArray(null);},
      onRemove(map,gl){if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);state.disposed=true;}
    };
  }
  function create(getContext){
    let ctx=null,mode='',panel=null,overlay=null,lens=null,data=null,layer=null,camera=null,timer=null,playing=false,index=-1,identity='',reason='',groups=[],hexes=[],selectedMembers=[],center=[.5,.5],radius=100,drag=null,closed=true,driving=false;
    const hidden=new Map(),listeners=[];
    const c=()=>TEXT[ctx?.locale]||TEXT.zh;
    const fmt=n=>ns.businessNumber?.number(n,ctx?.locale,1)??Number(n).toFixed(1);
    const identityOf=x=>JSON.stringify([x?.model?.provenance?.studyId,x?.model?.provenance?.studyHash,x?.model?.provenance?.snapshotHash,x?.model?.provenance?.selectedScenarioId,x?.model?.provenance?.referenceScenarioId,x?.model?.provenance?.leg,x?.model?.provenance?.mode,x?.model?.provenance?.changeFilter,x?.selectedLabel]);
    const usable=()=>ctx?.ready&&!ctx.noWebGL&&ctx.showcaseReady&&ctx.host?.isConnected&&ctx.map?.getCanvas()?.isConnected;
    const on=(target,event,fn)=>{target.addEventListener?target.addEventListener(event,fn):target.on(event,fn);listeners.push([target,event,fn]);};
    function status(){return {active:!closed,mode:closed?null:mode,playing,timerPending:timer!==null,driving,reason,groups:groups.length,hexes:hexes.length,renderedRelations:mode==='arcs'?layer?.rows.length||0:data?.links.length||0,totalRelations:data?.links.length||0,arcFrames:layer?.state.frames||0,arcTriangles:layer?.state.triangles||0,period:ctx?.model?.provenance?.period,periodIndex:index,center:[...center],radius,hiddenLayers:[...hidden.keys()]};}
    function stop(message=''){if(timer!==null)root.clearTimeout(timer);timer=null;playing=false;reason=message;update();}
    function update(){
      if(!panel)return;const p=ctx.model?.provenance||{},copy=c(),links=sideLinks(data),unit=ctx.model?.relationContext?.unit||'';
      panel.querySelector('[data-advanced-status]').textContent=reason||[ctx.scenarioName,ctx.periodLabel,copy.scope,`${links.length} ${copy.detail}`].filter(Boolean).join(' · ');
      const b=panel.querySelector('[data-advanced-play]');if(b){b.textContent=playing?copy.pause:copy.play;b.disabled=!usable()||ctx.reducedMotion||!ctx.setPeriod;b.setAttribute('aria-pressed',String(playing));}
      for(const button of panel.querySelectorAll('[data-advanced-step]'))button.disabled=!usable()||!ctx.setPeriod||Number(button.dataset.advancedStep)<0&&index<=0||Number(button.dataset.advancedStep)>0&&index>=ctx.model.relationContext.periods.length-1;
      if(mode==='playback'){const rows=ctx.model.relations||[],sites=ctx.model.entities.filter(e=>e.kind==='facility'),total=(kind,side)=>rows.filter(r=>r.kind===kind).reduce((n,r)=>n+r[side],0);panel.querySelector('[data-advanced-metrics]').innerHTML=`<div class="p7-advanced-totals">${['inbound','outbound','transfer'].filter(k=>rows.some(r=>r.kind===k)).map((k,i)=>`<span>${esc(copy.legs[['inbound','outbound','transfer'].indexOf(k)])} · ${fmt(total(k,'before'))} → <strong>${fmt(total(k,'after'))}</strong> ${esc(unit)}</span>`).join('')}</div><details><summary>${esc(copy.detail)} · ${sites.length}</summary><div class="p7-advanced-loads">${sites.filter(e=>rows.some(r=>r.fromNodeId===e.id||r.toNodeId===e.id)).map(e=>`<div><strong>${esc(e.label)}</strong>${['inbound','outbound','transfer'].filter(k=>rows.some(r=>r.kind===k&&(r.fromNodeId===e.id||r.toNodeId===e.id))).map(k=>{const group=rows.filter(r=>r.kind===k&&(r.fromNodeId===e.id||r.toNodeId===e.id));return `<span>${esc(copy.legs[['inbound','outbound','transfer'].indexOf(k)])} ${fmt(group.reduce((n,r)=>n+r.before,0))} → ${fmt(group.reduce((n,r)=>n+r.after,0))} ${esc(unit)}</span>`;}).join('')}</div>`).join('')}</div></details><details><summary>${esc(copy.peak)}</summary><div class="p7-advanced-loads">${sites.map(e=>{const rows=(ctx.model.periodLoads||[]).filter(r=>r.warehouseId===e.id),peak=(kind,side)=>{const group=rows.filter(r=>r.kind===kind&&r.side===side);if(!group.length)return copy.unknown;const top=group.reduce((a,b)=>a.quantity>b.quantity?a:b);return fmt(top.quantity)+' '+unit+' · '+top.period;};return rows.length?`<div><strong>${esc(e.label)}</strong>${['inbound','outbound','transfer'].filter(k=>rows.some(r=>r.kind===k)).map(k=>`<span>${esc(copy.legs[['inbound','outbound','transfer'].indexOf(k)])} ${esc(peak(k,'reference'))} → ${esc(peak(k,'candidate'))}</span>`).join('')}</div>`:'';}).join('')}</div></details>`;}
    }
    function hideBase(){
      for(const l of ctx.map.getStyle().layers||[])if(/^p7-supply-(relations|clustered|coverage-halo)/.test(l.id)||mode==='lens'&&['p7-supply-facilities','p7-supply-points'].includes(l.id)){
        if(!hidden.has(l.id))hidden.set(l.id,ctx.map.getLayoutProperty(l.id,'visibility'));
        ctx.map.setLayoutProperty(l.id,'visibility','none');
      }
      ctx.host.classList.add('p7-advanced-active');
    }
    function metric(link){const row=ctx.model.relations?.find(r=>r.relationId===link.relationId),m=row?.[link.side==='reference'?'beforeMetrics':'afterMetrics'],name=id=>ctx.model.entities.find(e=>e.id===id)?.label||id;return `${name(link.fromNodeId)} → ${name(link.toNodeId)} · ${fmt(link.quantity)} ${ctx.model.relationContext.unit} · ${c().distance}: ${m?.weightedKm==null?c().unknown:fmt(m.weightedKm)+' km'+(m.distanceCoverage<1?' ('+fmt(m.distanceCoverage*100)+'%)':'')} · ${c().cost}: ${m?.cost==null?c().unknown:fmt(m.cost)+' '+ctx.model.relationContext.currency}`;}
    // Keep a constant screen-space quantity scale while the camera zoom changes.
    function columnScale(){const m=ctx.map;return 500*40075016.686*Math.cos(m.getCenter().lat*Math.PI/180)/(512*2**m.getZoom())/5000000;}
    function updateColumns(){if(!ctx?.map.getSource(ID))return;hexes=demandHexagons(sideLinks(data),ctx.model.flowScale.outboundTotalMaximum,16/(512*2**Math.floor(ctx.map.getZoom())));ctx.map.getSource(ID).setData({type:'FeatureCollection',features:hexes});}
    function arcHover(event){if(!layer?.state.matrix)return;const canvas=ctx.map.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;let chosen=null,best=10;for(const row of layer.rows){const path=row.path.map(p=>screenPoint(p,layer.state.matrix,w,h));for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];if(!a||!b)continue;const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((event.point.x-a[0])*dx+(event.point.y-a[1])*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(event.point.x-a[0]-t*dx,event.point.y-a[1]-t*dy);if(d<best){best=d;chosen=row;}}}panel.querySelector('[data-advanced-detail]').textContent=chosen?metric(chosen):c().arcNote;}
    function draw(){
      if(closed||!usable()||!overlay)return;const canvas=ctx.map.getCanvas(),w=canvas.clientWidth,h=canvas.clientHeight;overlay.setAttribute('viewBox',`0 0 ${w} ${h}`);overlay.setAttribute('width',w);overlay.setAttribute('height',h);
      const path=l=>l.coordinates.map(p=>ctx.map.project(p)).map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ');
      if(mode==='network'){
        groups=aggregateFlows(sideLinks(data),ctx.map.getZoom());const max=ctx.model.flowScale?.maximum||1;
        overlay.innerHTML=groups.map((g,i)=>{const a=ctx.map.project(g.from),b=ctx.map.project(g.to);return `<path d="M${a.x},${a.y} L${b.x},${b.y}" fill="none" stroke="${esc(g.color)}" stroke-width="${1.5+Math.min(12,6*Math.sqrt(g.quantity/max))}" stroke-opacity=".82" data-advanced-group="${i}" role="button" tabindex="0" aria-label="${esc(c().detail+' '+g.members.length+' · '+fmt(g.quantity)+' '+ctx.model.relationContext.unit)}"><title>${g.members.length} · ${fmt(g.quantity)} ${esc(ctx.model.relationContext.unit)}</title></path><circle cx="${b.x}" cy="${b.y}" r="${Math.min(16,4+Math.sqrt(g.members.length))}" fill="${esc(g.color)}"/><text x="${b.x+10}" y="${b.y-7}" fill="${ctx.dark?'#f1f5f9':'#172033'}" font-size="11">${g.members.length>1?g.members.length:''}</text>`;}).join('');
        panel.querySelector('[data-advanced-detail]').textContent=selectedMembers.length?selectedMembers.slice(0,8).map(metric).join('\n')+(selectedMembers.length>8?`\n… ${selectedMembers.length} ${c().detail}`:''):`${groups.length} ${c().detail} / ${sideLinks(data).length} · ${c().networkNote}`;
      }
      if(mode==='lens'){
        radius=Math.min(120,w*.3,h*.32);const x=Math.max(radius,Math.min(w-radius,w*center[0])),y=Math.max(radius,Math.min(h-radius,h*center[1]));center=[x/w,y/h];const defs=`<defs><clipPath id="p7-advanced-inside"><circle cx="${x}" cy="${y}" r="${radius}"/></clipPath><mask id="p7-advanced-outside"><rect width="${w}" height="${h}" fill="white"/><circle cx="${x}" cy="${y}" r="${radius}" fill="black"/></mask></defs>`;
        const lines=side=>data.links.filter(l=>l.side===side).map(l=>`<path d="${path(l)}" fill="none" stroke="${esc(l.color)}" stroke-width="${1.5+5.5*Math.sqrt(l.quantity/Math.max(l.quantity,ctx.model.flowScale?.maximum||1))}" opacity=".9"/>`).join('');
        const endpoints=side=>{const colors=new Map();for(const l of data.links.filter(l=>l.side===side))for(const id of [l.fromNodeId,l.toNodeId]){const set=colors.get(id)||new Set();set.add(l.color);colors.set(id,set);}return data.points.filter(p=>p.kind!=='facility'&&colors.has(p.id)).map(p=>{const q=ctx.map.project(p.coordinate),set=colors.get(p.id),color=set.size===1?[...set][0]:'#64748b';return `<circle cx="${q.x}" cy="${q.y}" r="4" fill="${esc(color)}" stroke="${ctx.dark?'#111827':'#fff'}" stroke-width="1"/>`;}).join('');};
        const sites=side=>data.points.filter(p=>p.kind==='facility'&&p[side+'Selected']).map(p=>{const q=ctx.map.project(p.coordinate);return `<rect x="${q.x-5}" y="${q.y-5}" width="10" height="10" fill="${esc(p.color)}"/><text x="${q.x+9}" y="${q.y-7}" font-size="12" fill="${ctx.dark?'#fff':'#172033'}">${esc(p.label)}</text>`;}).join('');
        overlay.innerHTML=defs+`<g mask="url(#p7-advanced-outside)" data-advanced-side="candidate">${lines('candidate')}${endpoints('candidate')}${sites('candidate')}</g><g clip-path="url(#p7-advanced-inside)" data-advanced-side="reference">${lines('reference')}${endpoints('reference')}${sites('reference')}</g>`;
        lens.style.width=lens.style.height=radius*2+'px';lens.style.left=x-radius+'px';lens.style.top=y-radius+'px';
        const summary=lensTotals(data.links,data.points.map(p=>{const q=ctx.map.project(p.coordinate);return {id:p.id,x:q.x,y:q.y};}),[x,y],radius);panel.querySelector('[data-advanced-detail]').textContent=`${c().changed}: ${summary.changed} · `+Object.entries(summary.totals).filter(([,v])=>v.reference||v.candidate).map(([k,v])=>`${c().legs[['inbound','outbound','transfer'].indexOf(k)]} ${fmt(v.reference)} → ${fmt(v.candidate)} ${ctx.model.relationContext.unit}`).join(' · ');
      }
    }
    function setMonth(next){
      const periods=ctx.model.relationContext.periods;if(!Number.isInteger(next)||next<0||next>=periods.length||!ctx.setPeriod)return false;
      const prev=ctx.model.provenance.period;index=next;driving=true;try{ctx.setPeriod(next+1);const fresh=getContext();if(identityOf(fresh)!==identity){close();return false;}ctx=fresh;data=S.prepareFeatures(ctx.features);update();return ctx.model.provenance.period===periods[next]||prev===periods[next];}finally{driving=false;}
    }
    function schedule(){if(!playing||closed)return;timer=root.setTimeout(()=>{timer=null;if(ctx.host.ownerDocument.visibilityState==='hidden'){stop(c().stopped);return;}if(index>=ctx.model.relationContext.periods.length-1){stop(c().complete);return;}if(!setMonth(index+1)){stop(c().failed);return;}schedule();},2500);}
    function playback(){if(playing){stop(c().stopped);return;}if(ctx.reducedMotion||!usable()||!ctx.setPeriod)return;playing=true;reason='';if(index<0||index>=ctx.model.relationContext.periods.length-1)if(!setMonth(0)){stop(c().failed);return;}update();schedule();}
    function chooseGroup(i){const g=groups[i];if(!g)return;const members=sideLinks(data).filter(l=>g.members.includes(l.relationId));selectedMembers=members;panel.querySelector('[data-advanced-detail]').textContent=members.slice(0,8).map(metric).join('\n')+(members.length>8?`\n… ${members.length} ${c().detail}`:'');const coordinates=members.flatMap(l=>l.coordinates);if(coordinates.length){const lng=coordinates.map(p=>p[0]),lat=coordinates.map(p=>p[1]);ctx.map.fitBounds([[Math.min(...lng),Math.min(...lat)],[Math.max(...lng),Math.max(...lat)]],{padding:50,maxZoom:12,duration:ctx.reducedMotion?0:400});}}
    function close(){
      if(closed)return;stop();closed=true;
      for(const [target,event,fn]of listeners.splice(0))target.removeEventListener?target.removeEventListener(event,fn):target.off(event,fn);
      const map=ctx?.map;if(map){if(map.getLayer(ID))map.removeLayer(ID);if(map.getSource(ID))map.removeSource(ID);for(const [id,v]of hidden)if(map.getLayer(id))map.setLayoutProperty(id,'visibility',v??'visible');if(camera)map.jumpTo(camera);}hidden.clear();ctx?.host.classList.remove('p7-advanced-active');panel?.remove();overlay?.remove();lens?.remove();panel=overlay=lens=null;layer=null;camera=null;ctx=null;data=null;groups=[];hexes=[];selectedMembers=[];mode='';identity='';reason='';drag=null;
    }
    function refresh(){if(closed)return;const next=getContext();if(identityOf(next)!==identity||next.host!==ctx.host||next.map!==ctx.map){close();return;}if(!driving&&next.model.provenance.period!==ctx.model.provenance.period){close();return;}ctx=next;if(!usable()){stop(c().noMap);return;}draw();update();}
    function open(nextMode){
      if(!['arcs','columns','network','lens','playback'].includes(nextMode))return false;close();ctx=getContext();if(!ctx?.host||!ctx.model)return false;mode=nextMode;identity=identityOf(ctx);data=S.prepareFeatures(ctx.features);closed=false;index=ctx.model.relationContext.periods.indexOf(ctx.model.provenance.period);center=[.5,.5];const doc=ctx.host.ownerDocument,copy=c();
      panel=doc.createElement('section');panel.className='p7-advanced';panel.setAttribute('aria-label',copy[mode]);panel.innerHTML=`<header><h3>${esc(copy[mode])}</h3><button type="button" data-advanced-close>${esc(copy.close)}</button></header><p data-advanced-status role="status" aria-live="polite"></p>${mode==='playback'?`<nav class="p7-advanced-player"><button type="button" data-advanced-step="-1">${esc(copy.previous)}</button><button type="button" data-advanced-play aria-pressed="false"></button><button type="button" data-advanced-step="1">${esc(copy.next)}</button></nav><div data-advanced-metrics></div>`:''}<p data-advanced-detail class="p7-advanced-detail"></p><p class="p7-advanced-note">${esc(copy[mode==='arcs'?'arcNote':mode==='columns'?'height':mode==='lens'?'lensNote':mode==='network'?'networkNote':'boundary'])} ${esc(copy.partial)} ${esc(copy.boundary)}</p>`;ctx.host.querySelector('.p7-map-topbar').after(panel);
      on(panel,'click',e=>{if(e.target.closest('[data-advanced-close]')){const host=ctx.host;close();host.querySelector('[data-p7-toolgroup="analysis"] > summary')?.focus({preventScroll:true});}else if(e.target.closest('[data-advanced-play]'))playback();else if(e.target.closest('[data-advanced-step]')){stop();setMonth(Math.max(0,index)+Number(e.target.closest('[data-advanced-step]').dataset.advancedStep));}});
      if(!usable())reason=copy.noMap;else if(mode==='lens'&&!ctx.canCompare)reason=copy.noCompare;else if(mode==='playback'&&(!ctx.model.relationContext.periods.length||!ctx.setPeriod))reason=copy.noPeriod;
      if(!reason){
        try{
          const map=ctx.map,pane=ctx.host.querySelector('.p7-map-pane.is-reference');
          if(mode==='arcs'||mode==='columns'){camera={center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};map.jumpTo({pitch:50});}
          if(mode==='arcs'){hideBase();layer=arcLayer(sideLinks(data),ctx.model.flowScale?.maximum,e=>{reason=copy.failed;update();queueMicrotask(()=>{if(ctx?.map?.getLayer(ID))ctx.map.removeLayer(ID);for(const [id,v]of hidden)if(ctx?.map?.getLayer(id))ctx.map.setLayoutProperty(id,'visibility',v??'visible');ctx?.host.classList.remove('p7-advanced-active');});});map.addLayer(layer);panel.querySelector('[data-advanced-detail]').textContent=copy.arcNote+(sideLinks(data).length>120?' '+copy.limited:'');on(map,'mousemove',arcHover);}
          if(mode==='columns'){hexes=demandHexagons(sideLinks(data),ctx.model.flowScale?.outboundTotalMaximum,16/(512*2**Math.floor(map.getZoom())));if(!hexes.length){reason=copy.noDemand;}else{hideBase();map.addSource(ID,{type:'geojson',data:{type:'FeatureCollection',features:hexes}});map.addLayer({id:ID,type:'fill-extrusion',source:ID,paint:{'fill-extrusion-color':['interpolate',['linear'],['get','quantity'],0,'#38bdf8',Math.max(1,(ctx.model.flowScale.outboundTotalMaximum||1)*.125),'#2563eb'],'fill-extrusion-height':['*',['get','height'],columnScale()],'fill-extrusion-opacity':.85}});panel.querySelector('[data-advanced-detail]').textContent=`${fmt(hexes.reduce((n,f)=>n+f.properties.quantity,0))} ${ctx.model.relationContext.unit} · ${hexes.length} · ${copy.height}`;on(map,'move',()=>{if(map.getLayer(ID))map.setPaintProperty(ID,'fill-extrusion-height',['*',['get','height'],columnScale()]);});on(map,'zoomend',updateColumns);on(map,'mousemove',e=>{const f=map.queryRenderedFeatures(e.point,{layers:[ID]})[0];if(f)panel.querySelector('[data-advanced-detail]').textContent=`${copy.volume}: ${fmt(f.properties.quantity)} ${ctx.model.relationContext.unit} · ${JSON.parse(f.properties.members).length} ${copy.detail}`;});}}
          if(mode==='network'||mode==='lens'){
            hideBase();overlay=doc.createElementNS(SVG,'svg');overlay.classList.add('p7-advanced-overlay');overlay.setAttribute('aria-label',copy[mode]);pane.append(overlay);
            if(mode==='network'){on(overlay,'click',e=>{const el=e.target.closest('[data-advanced-group]');if(el)chooseGroup(Number(el.dataset.advancedGroup));});on(overlay,'keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[data-advanced-group]')){e.preventDefault();chooseGroup(Number(e.target.dataset.advancedGroup));}});}
            if(mode==='lens'){
              lens=doc.createElement('button');lens.type='button';lens.className='p7-advanced-lens';lens.setAttribute('aria-label',copy.lensNote);lens.textContent=copy.reference;pane.append(lens);
              on(lens,'pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,center:[...center]};lens.setPointerCapture(e.pointerId);e.preventDefault();});on(lens,'pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const box=pane.getBoundingClientRect();center=[drag.center[0]+(e.clientX-drag.x)/box.width,drag.center[1]+(e.clientY-drag.y)/box.height];draw();});on(lens,'pointerup',e=>{if(drag&&e.pointerId===drag.id)drag=null;});on(lens,'pointercancel',()=>{drag=null;});on(lens,'keydown',e=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(d){e.preventDefault();e.stopPropagation();const box=pane.getBoundingClientRect(),step=e.shiftKey?40:10;center=[center[0]+d[0]*step/box.width,center[1]+d[1]*step/box.height];draw();}});lens.focus({preventScroll:true});
            }
            on(map,'move',draw);on(map,'resize',draw);draw();
          }
          on(map,'style.load',close);on(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden')stop(copy.stopped);});
        }catch(e){const host=ctx.host;close();const notice=host.querySelector('.p7-map-mode');if(notice)notice.textContent=copy.failed;return false;}
      }
      update();panel.querySelector('[data-advanced-close]')?.focus({preventScroll:true});return true;
    }
    return Object.freeze({open,close,refresh,status,isDriving:()=>driving});
  }
  const api=Object.freeze({create,aggregateFlows,demandHexagons,lensTotals,arcPath,screenPoint,TEXT});ns.mapAdvanced=api;if(typeof module==='object'&&module.exports)module.exports={...module.exports,advanced:api};
})(globalThis);
