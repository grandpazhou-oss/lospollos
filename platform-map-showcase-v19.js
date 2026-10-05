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
