(function(root){
  'use strict';
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const COPY={zh:{all:'显示全部',search:'搜索仓库、需求、路线或车辆',close:'关闭详情',detail:'实体详情',layers:'地图图层',schematic:'示意空间视图',neutral:'中性地理画布 · 未加载道路底图',basis:'计算依据与数据来源',entities:'实体列表',previous:'上一个',next:'下一个',locate:'定位',empty:'选择地图或列表中的实体查看详情',demo:'演示数据',assignment:'分配关系（不是道路路线）',planned:'计划路线',actual:'模拟执行轨迹',vehicle:'模拟车辆位置',facility:'仓库',demand:'需求点',alert:'异常',source:'来源',validation:'方案试跑 · 不影响当前运输计划'},en:{all:'Show all',search:'Find facility, demand, route or vehicle',close:'Close details',detail:'Entity details',layers:'Map layers',schematic:'Schematic spatial view',neutral:'Neutral geographic canvas · no road basemap loaded',basis:'Calculation Basis & Sources',entities:'Entity list',previous:'Previous',next:'Next',locate:'Locate',empty:'Select an entity on the map or list',demo:'Synthetic demo',assignment:'Assignment relation (not a road route)',planned:'Planned route',actual:'Simulated execution track',vehicle:'Simulated vehicle position',facility:'Facility',demand:'Demand',alert:'Alert',source:'Source',validation:'Validation · does not affect current plan'},ja:{all:'全体表示',search:'拠点・需要・ルート・車両を検索',close:'詳細を閉じる',detail:'対象の詳細',layers:'地図レイヤー',schematic:'模式的な空間表示',neutral:'地理キャンバス · 道路背景図は未読込',basis:'計算根拠とデータソース',entities:'対象一覧',previous:'前へ',next:'次へ',locate:'位置を表示',empty:'地図または一覧から対象を選択',demo:'合成デモデータ',assignment:'割当関係（道路ルートではありません）',planned:'計画ルート',actual:'シミュレーション軌跡',vehicle:'シミュレーション車両位置',facility:'拠点',demand:'需要',alert:'異常',source:'ソース',validation:'試行検証 · 現在の輸送計画に影響しません'}};
  const SEARCH_COPY={zh:{empty:'没有找到匹配的对象。试试仓库、车辆或路线编号。',clear:'清空搜索',results:'个匹配对象'},en:{empty:'No matching objects. Try a facility, vehicle or route ID.',clear:'Clear search',results:'matching objects'},ja:{empty:'一致する対象がありません。拠点・車両・ルートの ID で検索してください。',clear:'検索をクリア',results:'件の一致'}};
  const searchCopy=()=>SEARCH_COPY[config?.locale]||SEARCH_COPY.zh;
  const WORKBENCH_COPY={
    zh:{all:'全部对象',route:'路线',vehicle:'车辆',alert:'异常',stop:'停靠点',supplier:'供应商',facility:'仓库',demand:'需求点',objects:'工作列表',filter:'筛选工作列表',facts:'更多信息',choose:'选择一个对象',hint:'从左侧列表或地图选择，详情与可执行操作会显示在这里。'},
    en:{all:'All objects',route:'Routes',vehicle:'Vehicles',alert:'Alerts',stop:'Stops',supplier:'Suppliers',facility:'Facilities',demand:'Demand',objects:'Work list',filter:'Filter the work list',facts:'More information',choose:'Select an object',hint:'Choose from the list or map to see details and available actions.'},
    ja:{all:'すべて',route:'ルート',vehicle:'車両',alert:'異常',stop:'配送先',supplier:'供給元',facility:'拠点',demand:'需要',objects:'作業一覧',filter:'作業一覧を絞込',facts:'詳細情報',choose:'対象を選択',hint:'一覧または地図から選択すると、詳細と操作が表示されます。'}
  };
  const wb=()=>WORKBENCH_COPY[config?.locale]||WORKBENCH_COPY.zh;
  let host,canvas,parking,map,observer,model,config,owner='',sourceId='',ready=false,failed=false,lastData='',syncing=false,basemapStatus='LOADING',basemapFallback=false;
  const views=new Map(),measurements=[],warnings=[];
  const now=()=>root.performance?.now()||Date.now();
  function measured(name,fn){const start=now();try{return fn();}finally{measurements.push({name,ms:now()-start});if(measurements.length>3000)measurements.shift();}}
  const c=()=>COPY[config?.locale]||COPY.zh;
  function view(){if(!views.has(owner))views.set(owner,{workspace:owner,center:null,zoom:null,bearing:0,pitch:0,selectedEntityId:'',activeLayerIds:null,revision:0});return views.get(owner);}
  function park(){if(host&&parking){map?.stop();parking.append(host);host.hidden=true;}}
  function init(){if(host)return;parking=root.document.createElement('div');parking.hidden=true;root.document.body.append(parking);host=root.document.createElement('section');host.className='p7-map-workspace';host.innerHTML='<div class="p7-map-metrics"></div><div class="p7-map-topbar"><div class="p7-map-search"></div><div class="p7-map-toolbar"></div></div><div class="p7-map-grid"><details class="p7-entity-details"><summary></summary><div class="p7-map-list"></div></details><div class="p7-map-viewport"><div class="p7-map-canvas"></div><div class="p7-map-schematic"></div><div class="p7-map-labels"></div><p class="p7-map-mode"></p></div><div role="complementary" aria-labelledby="p7-inspector-title" class="p7-map-inspector" tabindex="-1"></div></div><div class="p7-map-legend"></div><details class="p7-map-basis"><summary></summary><pre></pre></details>';
    canvas=host.querySelector('.p7-map-canvas');host.addEventListener('click',onClick);host.addEventListener('input',onInput);host.addEventListener('change',onChange);host.addEventListener('keydown',onKey);observer=new ResizeObserver(()=>{if(!host.hidden)measured('map.resize',()=>{map?.resize();labels();});});observer.observe(host.querySelector('.p7-map-viewport'));parking.append(host);
  }
  const BASEMAP_COPY={
    zh:{loaded:'OpenFreeMap 地理底图',loading:'正在加载地理底图…',degraded:'部分底图资源未加载，业务图层仍可用',unavailable:'底图暂不可用，业务图层仍可用',retry:'重试底图'},
    en:{loaded:'OpenFreeMap geographic basemap',loading:'Loading geographic basemap…',degraded:'Some basemap resources are unavailable; business layers remain available',unavailable:'Basemap unavailable; business layers remain available',retry:'Retry basemap'},
    ja:{loaded:'OpenFreeMap 地理背景図',loading:'地理背景図を読込中…',degraded:'一部の背景図を読込できません。業務レイヤーは利用できます',unavailable:'背景図を読込できません。業務レイヤーは利用できます',retry:'背景図を再読込'}
  };
  const basemapUrl=()=>root.STCT_CONFIG?.mapStyleUrl||'https://tiles.openfreemap.org/styles/liberty';
  const neutralStyle=()=>({version:8,sources:{},layers:[{id:'p7-neutral',type:'background',paint:{'background-color':'#eef3f2'}}]});
  function basemapInfo(){return {status:config?.noWebGL||failed||!root.maplibregl?'SCHEMATIC':basemapStatus,styleUrl:basemapUrl(),tilesLoaded:Boolean(map&&ready&&map.areTilesLoaded())};}
  function mapProvenance(){return {...model?.provenance,basemap:basemapInfo()};}
  function retryBasemap(){if(!map||config.noWebGL||failed)return;ready=false;sourceId='';lastData='';basemapFallback=false;basemapStatus='LOADING';map.setStyle(basemapUrl(),{diff:false});renderMode();}
  function construct(){
    if(map||failed||config.noWebGL)return;
    try{
      measured('map.construct',()=>{
        map=new root.maplibregl.Map({container:canvas,style:basemapUrl(),center:[117,39],zoom:8,attributionControl:true,cooperativeGestures:true,localIdeographFontFamily:'sans-serif',transformRequest:(url,type)=>{
          if(type==='Glyphs'&&url.startsWith('https://tiles.openfreemap.org/fonts/')){
            const font=/bold/i.test(url)?'Noto Sans Bold':'Noto Sans Regular';
            return {url:url.replace(/\/fonts\/[^/]+\//,`/fonts/${encodeURIComponent(font)}/`)};
          }
          return {url};
        }});
        map.addControl(new root.maplibregl.NavigationControl({showCompass:false}),'top-left');
        map.addControl(new root.maplibregl.ScaleControl(),'bottom-left');
      });
      map.on('style.load',()=>{ready=true;sourceId='';lastData='';updateSource();fit();renderMode();});
      map.on('idle',()=>{if(basemapStatus==='LOADING'&&ready&&!basemapFallback){basemapStatus='LOADED';renderMode();}});
      map.on('click',event=>{
        const layers=map.getStyle().layers.filter(x=>x.id.startsWith('p7-')&&x.id!=='p7-neutral').map(x=>x.id);
        const feature=map.queryRenderedFeatures(event.point,{layers})[0];
        if(feature?.properties?.entityId)select(feature.properties.entityId,true);
      });
      map.on('movestart',()=>{host.querySelector('.p7-map-labels').hidden=true;});
      map.on('moveend',()=>{host.querySelector('.p7-map-labels').hidden=false;labels();if(!owner||syncing)return;const center=map.getCenter();Object.assign(view(),{center:[center.lng,center.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()});});
      map.on('error',event=>{
        warnings.push({kind:'BASEMAP_RESOURCE_WARNING',message:String(event.error?.message||event.error)});
        if(!ready&&!basemapFallback){basemapFallback=true;basemapStatus='UNAVAILABLE';sourceId='';lastData='';map.setStyle(neutralStyle(),{diff:false});}
        else if(!basemapFallback)basemapStatus='DEGRADED';
        renderMode();
      });
      map.on('webglcontextlost',()=>{failed=true;renderMode();});
      map.on('webglcontextrestored',()=>{failed=false;renderMode();});
    }catch(error){failed=true;warnings.push({kind:'WEBGL_UNAVAILABLE',message:error.message});}
  }
  function cleanSource(){if(!map||!ready||!sourceId)return;for(const layer of [...map.getStyle().layers].reverse())if(layer.source===sourceId)map.removeLayer(layer.id);if(map.getSource(sourceId))map.removeSource(sourceId);sourceId='';lastData='';}
  function density(){const points=(model?.features||[]).filter(f=>f.properties.kind==='demand'&&f.properties.layer!=='unserved'),limited=points.length>200&&!view().showAllDemand,step=Math.ceil(points.length/200),ids=new Set(points.filter((f,i)=>!limited||i%step===0||f.properties.entityId===view().selectedEntityId).map(f=>f.properties.entityId));return {total:points.length,shown:ids.size,limited,ids};}
  function activeFeatures(fullExtent=false){const active=view().activeLayerIds,d=density();return (model.features||[]).filter(f=>(!active||active.includes(f.properties.layer))&&(fullExtent||!d.limited||!['demand','assignment'].includes(f.properties.kind)||['unserved','inbound'].includes(f.properties.layer)||d.ids.has(f.properties.entityId))).map(f=>({...f,properties:{...f.properties,focused:f.properties.entityId===view().selectedEntityId}}));}
  function densityCopy(){const d=density();if(!d.limited)return '';return config.locale==='en'?`Display sample: ${d.shown} / ${d.total} demand points. All entities remain in the list; calculations are unchanged.`:config.locale==='ja'?`表示を間引き：需要 ${d.shown} / ${d.total} 点。全対象は一覧で確認でき、計算は変更しません。`:`显示简化：${d.shown} / ${d.total} 个需求点。列表保留全部实体，计算数据不变。`;}

  function updateSource(){if(!map||!ready||config.noWebGL||failed)return;measured('map.sourceUpdate',()=>{const data={type:'FeatureCollection',features:activeFeatures()},signature=JSON.stringify(data);if(signature===lastData&&sourceId)return;lastData=signature;if(sourceId&&map.getSource(sourceId)){map.getSource(sourceId).setData(data);return;}sourceId='p7-'+owner.toLowerCase();map.addSource(sourceId,{type:'geojson',data});
      measured('map.layerUpdate',()=>{const line=(suffix,filter,dash,width)=>map.addLayer({id:sourceId+suffix,source:sourceId,type:'line',filter:['all',['==',['geometry-type'],'LineString'],filter],paint:{'line-color':['coalesce',['get','color'],'#26778a'],'line-width':['case',['==',['get','focused'],true],width+2,width],...(dash?{'line-dasharray':dash}:{})}});
      line('-relations',['==',['get','kind'],'assignment'],[3,3],1.5);line('-planned',['==',['get','kind'],'planned'],null,3);line('-actual',['==',['get','kind'],'actual'],[1,2],3);line('-preview',['==',['get','kind'],'preview'],[4,2],4);
      for(const role of ['existing','candidate','selected'])if(!map.hasImage('p7-site-'+role)){const icon=root.document.createElement('canvas');icon.width=24;icon.height=24;const g=icon.getContext('2d');g.strokeStyle='#16736b';g.lineWidth=3;g.fillStyle=role==='selected'?'#16736b':'#ffffff';g.beginPath();if(role==='candidate'){g.moveTo(12,2);g.lineTo(22,12);g.lineTo(12,22);g.lineTo(2,12);g.closePath();}else g.rect(4,4,16,16);g.fill();g.stroke();map.addImage('p7-site-'+role,g.getImageData(0,0,24,24));}
      map.addLayer({id:sourceId+'-facilities',source:sourceId,type:'symbol',filter:['==',['get','kind'],'facility'],layout:{'icon-image':['concat','p7-site-',['coalesce',['get','facilityRole'],'existing']],'icon-size':['case',['==',['get','focused'],true],1.2,.8],'icon-allow-overlap':true}});
      for(const kind of ['vehicle','alert'])if(!map.hasImage('p7-'+kind)){const icon=root.document.createElement('canvas');icon.width=24;icon.height=24;const g=icon.getContext('2d');g.fillStyle=kind==='alert'?'#b33737':'#31658c';g.strokeStyle='white';g.lineWidth=2;g.beginPath();g.moveTo(12,2);g.lineTo(22,kind==='alert'?21:12);if(kind!=='alert')g.lineTo(12,22);g.lineTo(2,kind==='alert'?21:12);g.closePath();g.fill();g.stroke();map.addImage('p7-'+kind,g.getImageData(0,0,24,24));}
      map.addLayer({id:sourceId+'-vehicles-alerts',source:sourceId,type:'symbol',filter:['in',['get','kind'],['literal',['vehicle','alert']]],layout:{'icon-image':['concat','p7-',['get','kind']],'icon-size':['case',['==',['get','focused'],true],1.25,.85],'icon-allow-overlap':true}});
      map.addLayer({id:sourceId+'-points',source:sourceId,type:'circle',filter:['all',['==',['geometry-type'],'Point'],['!',['in',['get','kind'],['literal',['facility','vehicle','alert']]]]],paint:{'circle-radius':['case',['has','change'],8,['==',['get','focused'],true],10,['==',['get','kind'],'demand'],4,7],'circle-color':['coalesce',['get','color'],'#236b78'],'circle-stroke-width':2,'circle-stroke-color':'#ffffff'}});});
    });}
  function fit(id){if(!model)return;const features=id?model.features.filter(f=>f.properties.entityId===id):activeFeatures(true),points=features.flatMap(f=>f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates).filter(p=>Array.isArray(p)&&p.every(Number.isFinite));if(!points.length)return;if(map&&ready&&!config.noWebGL&&!failed)measured(id?'map.locate':'map.fit',()=>{map.resize();if(points.length===1)map.jumpTo({center:points[0],zoom:Math.max(map.getZoom(),11)});else map.fitBounds(points.reduce((b,p)=>b.extend(p),new root.maplibregl.LngLatBounds(points[0],points[0])),{padding:{top:55,right:45,bottom:85,left:55},duration:0,maxZoom:16});});}
  function schematic(){const features=activeFeatures(),pts=features.flatMap(f=>f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates);if(!pts.length)return '<p>'+escape(c().empty)+'</p>';const lat=pts.reduce((s,p)=>s+p[1],0)/pts.length,cos=Math.cos(lat*Math.PI/180),xy=pts.map(p=>[p[0]*cos,-p[1]]),minX=Math.min(...xy.map(p=>p[0])),minY=Math.min(...xy.map(p=>p[1])),width=Math.max(...xy.map(p=>p[0]))-minX,height=Math.max(...xy.map(p=>p[1]))-minY,scale=Math.min(690/Math.max(width,.001),340/Math.max(height,.001)),project=p=>[35+(p[0]*cos-minX)*scale+(690-width*scale)/2,25+(-p[1]-minY)*scale+(340-height*scale)/2];
    return `<svg viewBox="0 0 760 400" role="img" aria-label="${escape(c().schematic)}">${features.map(f=>{const p=f.properties,id=escape(p.entityId),color=escape(p.color||'#26778a');if(f.geometry.type==='LineString')return `<polyline data-p7-entity="${id}" points="${f.geometry.coordinates.map(p=>project(p).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${p.kind==='assignment'?1.4:3}" ${p.kind!=='planned'?'stroke-dasharray="5 4"':''}/>`;const [x,y]=project(f.geometry.coordinates),shape=p.kind==='facility'&&p.facilityRole==='candidate'?`<path d="M${x},${y-8}l8,8l-8,8l-8,-8z" fill="white" stroke="${color}" stroke-width="2"/>`:p.kind==='vehicle'?`<path d="M${x},${y-7}l7,7l-7,7l-7,-7z" fill="${color}"/>`:p.kind==='facility'?`<rect x="${x-6}" y="${y-6}" width="12" height="12" fill="${p.selected?color:'white'}" stroke="${color}" stroke-width="2"/>`:p.kind==='alert'?`<path d="M${x},${y-8}l8,14h-16z" fill="${color}"/>`:`<circle cx="${x}" cy="${y}" r="${p.kind==='demand'?3:6}" fill="${color}"/>`;return `<g data-p7-entity="${id}">${shape}<title>${escape(p.label||p.entityId)}</title></g>`;}).join('')}<text x="12" y="390" fill="#405762" font-size="11">WGS84 · ${escape(c().schematic)} · ${pts.length} coordinates</text></svg>`;}
  function renderMode(){
    if(!host)return;
    host.querySelector('.p7-map-legend').textContent=model.legend+' '+densityCopy();
    const fallback=config.noWebGL||failed||!root.maplibregl,copy=BASEMAP_COPY[config.locale]||BASEMAP_COPY.zh;
    canvas.hidden=fallback;host.querySelector('.p7-map-schematic').hidden=!fallback;
    host.querySelector('.p7-map-schematic').innerHTML=fallback?schematic():'';
    host.querySelector('.p7-map-mode').textContent=fallback?c().schematic:copy[basemapStatus.toLowerCase()];
    host.dataset.mapMode=fallback?'SCHEMATIC':basemapFallback?'MAPLIBRE_NEUTRAL':'MAPLIBRE_BASEMAP';
    host.querySelector('.p7-map-basis pre').textContent=JSON.stringify(mapProvenance(),null,2);
    let retry=host.querySelector('[data-p7-basemap-retry]');
    if(!retry){retry=root.document.createElement('button');retry.type='button';retry.dataset.p7BasemapRetry='';host.querySelector('.p7-map-toolbar').append(retry);}
    retry.textContent=copy.retry;retry.hidden=fallback||!['UNAVAILABLE','DEGRADED'].includes(basemapStatus);
    labels();
  }
  function filteredEntities(query=view().searchQuery||'') {
    const term=query.trim().toLowerCase(),kind=view().entityKind||'all';
    return model.entities.filter(entity=>(kind==='all'||entity.kind===kind)&&(!term||(entity.label+' '+entity.id+' '+(entity.routeId||'')+' '+(entity.summary||'')).toLowerCase().includes(term)));
  }
  function metrics() {
    const kinds=[...new Set(model.entities.map(entity=>entity.kind))];
    host.querySelector('.p7-map-metrics').innerHTML=['all',...kinds].map(kind=>{
      const count=kind==='all'?model.entities.length:model.entities.filter(e=>e.kind===kind).length;
      return `<button type="button" data-p7-kind="${escape(kind)}" aria-pressed="${(view().entityKind||'all')===kind}" aria-label="${escape(wb().filter+' · '+(wb()[kind]||kind))}"><span>${escape(wb()[kind]||kind)}</span><strong>${count}</strong></button>`;
    }).join('');
  }
  function labels() {
    if(!host||!model)return;
    const layer=host.querySelector('.p7-map-labels');
    if(!map||!ready||config.noWebGL||failed){layer.replaceChildren();return;}
    const seen=new Set(),placed=[],bounds=canvas.getBoundingClientRect();
    layer.innerHTML=activeFeatures().filter(f=>f.geometry.type==='Point'&&(['facility','vehicle'].includes(f.properties.kind)||f.properties.entityId===view().selectedEntityId)).sort((a,b)=>Number(b.properties.entityId===view().selectedEntityId)-Number(a.properties.entityId===view().selectedEntityId)).slice(0,24).map(f=>{
      const id=f.properties.entityId;if(seen.has(id))return '';seen.add(id);
      const p=map.project(f.geometry.coordinates);if(p.x<25||p.y<40||p.x>bounds.width-25||p.y>bounds.height-20)return '';
      const width=Math.max(44,id.length*7+20);if(placed.some(q=>Math.abs(p.x-q.x)<(width+q.width)/2+4&&Math.abs(p.y-q.y)<34))return '';placed.push({x:p.x,y:p.y,width});
      return `<button type="button" data-p7-entity="${escape(id)}" class="p7-map-label${id===view().selectedEntityId?' is-selected':''}" style="left:${p.x}px;top:${p.y}px" aria-label="${escape(c().detail+' '+id)}">${escape(id)}</button>`;
    }).join('');
  }
  function list(query='') {
    view().searchQuery=query;const rows=filteredEntities(query);
    host.querySelector('.p7-search-count').textContent=rows.length+' '+searchCopy().results;
    host.querySelector('[data-p7-search-clear]').hidden=!query;
    host.querySelector('.p7-entity-details summary').textContent=wb().objects+' · '+rows.length;
    host.querySelector('.p7-map-list').innerHTML=rows.length?rows.map(entity=>{
      const progress=Number.isFinite(entity.completed)&&entity.total>0?`<span class="p7-row-progress" role="img" aria-label="${escape(c().planned+' '+entity.completed+'/'+entity.total)}"><i style="width:${Math.min(100,entity.completed/entity.total*100)}%"></i></span>`:'';
      return `<button type="button" data-p7-entity="${escape(entity.id)}" data-kind="${escape(entity.kind)}" aria-pressed="${view().selectedEntityId===entity.id}"><span class="p7-row-symbol">${escape(entity.symbol||'○')}</span><span class="p7-row-copy"><strong>${escape(entity.kind==='facility'?entity.id:entity.label)}</strong><small>${escape(entity.kind==='facility'?entity.label:entity.summary||'')}</small>${progress}</span>${entity.openAlerts?`<span class="p7-row-alert">${entity.openAlerts}</span>`:''}</button>`;
    }).join(''):`<p class="p7-search-empty" role="status">${escape(searchCopy().empty)}</p>`;
  }
  function inspector() {
    const entity=view().inspectorDismissed?null:model.entities.find(e=>e.id===view().selectedEntityId),aside=host.querySelector('.p7-map-inspector');
    const facts=entity?.facts||[],technical=facts.filter(([key])=>[ns.mapAdapters?.words[config.locale]?.coordinate,ns.mapAdapters?.words[config.locale]?.source,'Plan','Run','WGS84','Source'].includes(key)),business=facts.filter(row=>!technical.includes(row));
    const factRows=rows=>rows.map(([key,value])=>`<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('');
    aside.innerHTML=entity?`<div class="p7-inspector-heading"><span class="p7-inspector-kind">${escape(wb()[entity.kind]||c().detail)}</span><button type="button" data-p7-close>${escape(c().close)}</button></div><h2 id="p7-inspector-title">${escape(entity.label)}</h2><p>${escape(entity.summary||'')}</p><div class="p7-inspector-actions">${(entity.actions||[]).map(a=>`<button type="button" data-p7-route="${escape(a.route)}">${escape(a.label)}</button>`).join('')}</div><dl>${factRows(business)}</dl>${technical.length?`<details class="p7-entity-technical"><summary>${escape(wb().facts)}</summary><dl>${factRows(technical)}</dl></details>`:''}`:`<div class="p7-inspector-empty"><span aria-hidden="true">◎</span><h2 id="p7-inspector-title">${escape(wb().choose)}</h2><p>${escape(wb().hint)}</p></div>`;
    aside.classList.toggle('is-open',Boolean(entity)&&view().inspectorOpen===true);
  }
  function select(id,focus=false){if(!model.entities.some(e=>e.id===id))return;view().selectedEntityId=id;view().inspectorOpen=true;view().inspectorDismissed=false;view().revision++;const entity=model.entities.find(e=>e.id===id);config.onSelect?.(entity);list(host.querySelector('[data-p7-search]')?.value||'');inspector();updateSource();renderMode();fit(id);if(focus)host.querySelector('.p7-map-inspector').focus({preventScroll:true});}
  function onClick(event){if(event.target.closest('[data-p7-basemap-retry]')){retryBasemap();return;}const category=event.target.closest('[data-p7-kind]');if(category){view().entityKind=category.dataset.p7Kind;host.querySelector('.p7-entity-details').open=true;metrics();list(view().searchQuery||'');host.querySelector(`[data-p7-kind="${view().entityKind}"]`).focus({preventScroll:true});return;}if(event.target.closest('[data-p7-search-clear]')){const input=host.querySelector('[data-p7-search]');input.value='';view().entityKind='all';metrics();list();input.focus();return;}const e=event.target.closest('[data-p7-entity]');if(e){select(e.dataset.p7Entity,true);return;}if(event.target.closest('[data-p7-fit]'))fit();if(event.target.closest('[data-p7-close]')){const id=view().selectedEntityId;view().inspectorOpen=false;view().inspectorDismissed=true;inspector();const target=[...host.querySelectorAll('button[data-p7-entity]')].find(e=>e.dataset.p7Entity===id);(target&&host.querySelector('.p7-entity-details').open?target:host.querySelector('[data-p7-search]')).focus({preventScroll:true});}const route=event.target.closest('[data-p7-route]');if(route)config.navigate?.(route.dataset.p7Route);const step=event.target.closest('[data-p7-step]');if(step){const rows=filteredEntities(),i=rows.findIndex(e=>e.id===view().selectedEntityId);select(rows[(i+Number(step.dataset.p7Step)+rows.length)%rows.length]?.id,true);}}
  function onKey(event){if(event.key==='Escape'&&view().selectedEntityId)host.querySelector('[data-p7-close]')?.click();}
  function onInput(event){if(event.target.matches('[data-p7-search]')){view().entityKind='all';metrics();host.querySelector('.p7-entity-details').open=true;list(event.target.value);}}
  function onChange(event){if(event.target.matches('[data-p7-all-demand]')){view().showAllDemand=event.target.checked;updateSource();renderMode();return;}if(event.target.matches('[data-p7-layer]')){view().activeLayerIds=[...host.querySelectorAll('[data-p7-layer]:checked')].map(e=>e.dataset.p7Layer);updateSource();renderMode();}}
  function mount(slot,nextModel,nextConfig={}){if(!slot)return;init();const changed=owner!==nextModel.owner;syncing=true;config=nextConfig;model=nextModel;if(changed){cleanSource();owner=model.owner;}const priorCamera=structuredClone(view()),layoutChanged=(view().route==='/design/facility-location')!==(config.route==='/design/facility-location');if(changed||view().route!==config.route){view().inspectorOpen=false;view().inspectorDismissed=false;}Object.assign(view(),{route:config.route});if(!view().entityKind)view().entityKind=model.entities.some(e=>e.kind==='vehicle')?'vehicle':model.entities.some(e=>e.kind==='facility')?'facility':'all';host.hidden=false;slot.append(host);host.dataset.owner=owner;
    host.querySelector('.p7-map-toolbar').innerHTML=`<button type="button" data-p7-fit>${escape(c().all)}</button><button type="button" data-p7-step="-1">${escape(c().previous)}</button><button type="button" data-p7-step="1">${escape(c().next)}</button><details><summary>${escape(c().layers)}</summary>${model.layers.map(l=>`<label><input type="checkbox" data-p7-layer="${escape(l.id)}" ${!view().activeLayerIds||view().activeLayerIds.includes(l.id)?'checked':''}>${escape(l.label)}</label>`).join('')}</details>${density().total>200?`<label><input type="checkbox" data-p7-all-demand${view().showAllDemand?' checked':''}>${escape(config.locale==='en'?'Show every demand point':config.locale==='ja'?'全需要点を表示':'显示全部需求点')}</label>`:''}`;
    host.querySelector('.p7-map-legend').textContent=model.legend;host.querySelector('.p7-entity-details summary').textContent=c().entities+' · '+model.entities.length;host.querySelector('.p7-map-search').innerHTML=`<input type="search" data-p7-search aria-label="${escape(c().search)}" placeholder="${escape(c().search)}" value="${escape(view().searchQuery||'')}"><button type="button" data-p7-search-clear>${escape(searchCopy().clear)}</button><span class="p7-search-count" role="status" aria-live="polite"></span>`;host.querySelector('.p7-map-basis summary').textContent=c().basis;host.querySelector('.p7-map-basis pre').textContent=JSON.stringify(model.provenance,null,2);if(nextConfig.selectedId)view().selectedEntityId=nextConfig.selectedId;if(!model.entities.some(e=>e.id===view().selectedEntityId))view().selectedEntityId='';host.querySelector('.p7-entity-details').open=Boolean(view().searchQuery)||(root.innerWidth>1100&&config.route!=='/design/facility-location');metrics();list(view().searchQuery||'');inspector();construct();renderMode();updateSource();if(map&&ready){map.resize();if(layoutChanged)fit();else if(changed&&priorCamera.center)map.jumpTo(priorCamera);else if(changed||!priorCamera.center)fit();}syncing=false;if(map&&ready){const center=map.getCenter();Object.assign(view(),{center:[center.lng,center.lat],zoom:map.getZoom()});}return host;
  }
  ns.mapRuntime={mount,park,select,fit,measured,snapshot:()=>structuredClone(model),project(id){const f=model?.features.find(f=>f.properties.entityId===id&&f.geometry.type==='Point');if(!f||!map)return null;const p=map.project(f.geometry.coordinates);return {x:p.x,y:p.y};},copy:locale=>COPY[locale]||COPY.zh,escape,diagnostics:()=>({owner,mode:host?.dataset.mapMode,mapInstances:map?1:0,sources:map&&ready?Object.keys(map.getStyle().sources):[],layers:map&&ready?map.getStyle().layers.map(x=>x.id):[],viewStates:Object.fromEntries(views),measurements:[...measurements],warnings:[...warnings],mapEventListeners:map?Object.fromEntries(Object.entries(map._listeners||{}).map(([key,values])=>[key,values.length])):{},density:{total:density().total,shown:density().shown,limited:density().limited},renderedEntityIds:model?activeFeatures().map(f=>f.properties.entityId):[],entityCount:model?.entities.length||0,provenance:mapProvenance(),basemap:basemapInfo(),renderedBasemapFeatureCount:map&&ready&&!config?.noWebGL&&!failed?map.queryRenderedFeatures().filter(f=>!f.layer.id.startsWith('p7-')).length:0})};
})(globalThis);
