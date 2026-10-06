(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  (root.STCTPlatformV19=root.STCTPlatformV19||{}).localRoadClient=api;
})(globalThis,function(){
  'use strict';
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const coordinate=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
  const snapMeters=(from,to)=>{const radians=v=>v*Math.PI/180,lat=radians(to[1]-from[1]),lon=radians(to[0]-from[0]),a=Math.sin(lat/2)**2+Math.cos(radians(from[1]))*Math.cos(radians(to[1]))*Math.sin(lon/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));};
  function settings(input={}){
    const endpoint=new URL(input.localRoadEndpoint||'http://127.0.0.1:5001');
    if(!['http:','https:'].includes(endpoint.protocol)||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')fail('ROAD_LOCAL_ENDPOINT_REQUIRED');
    const timeoutMs=Number(input.roadRequestTimeoutMs??10000),budgetMs=Number(input.roadBudgetMs??120000),maxSnapMeters=Number(input.roadMaxSnapMeters??1000);
    if(![timeoutMs,budgetMs,maxSnapMeters].every(v=>Number.isFinite(v)&&v>0)||timeoutMs>60000||budgetMs>600000)fail('ROAD_BUDGET_INVALID');
    if(input.roadProfile!=null&&input.roadProfile!=='driving')fail('ROAD_PROFILE_UNSUPPORTED');
    return {endpoint:endpoint.origin,timeoutMs,budgetMs,maxSnapMeters,profile:'driving',networkVersion:input.roadNetworkVersion||null};
  }
  // Cross-study reuse is stricter than accepting a user-supplied distance table.
  // Missing provenance means recalculate, not promote an estimate to verified data.
  function reuseAssessment(row,from,to,coordinateUse,options={},now=Date.now()){
    const reject=reason=>({reusable:false,reason});
    let config;try{config=settings(options);}catch(error){return reject(error.code||'ROAD_CONFIG_INVALID');}
    const maxAgeMs=options.roadReuseMaxAgeMs??30*24*60*60*1000;
    if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isFinite(now))return reject('ROAD_REUSE_POLICY_INVALID');
    if(typeof config.networkVersion!=='string'||!config.networkVersion.trim())return reject('ROAD_NETWORK_VERSION_REQUIRED');
    if(!row||row.source!=='OSRM_LOCAL'||row.strategy!=='ROUTE_DRIVING'||row.quality!=='ESTIMATED_ROAD'||row.unit!=='km')return reject('ROAD_PROVENANCE_UNSUPPORTED');
    if(!finite(row.distanceKm)||!finite(row.travelSeconds))return reject('ROAD_METRIC_INVALID');
    const evidence=row.evidence;
    if(!evidence||evidence.endpoint!==config.endpoint||evidence.profile!==config.profile||evidence.networkVersion!==config.networkVersion)return reject('ROAD_NETWORK_IDENTITY_MISMATCH');
    if(!['WGS84','ASSUMED_WGS84_SCREENING'].includes(coordinateUse)||evidence.coordinateUse!==coordinateUse)return reject('ROAD_COORDINATE_SYSTEM_UNCONFIRMED');
    if(evidence.verification!=='ENGINE_CALCULATED_NOT_MANUALLY_VERIFIED'||evidence.truckRestrictions!=='NOT_VERIFIED'||evidence.traffic!=='NOT_MODELED')return reject('ROAD_ASSUMPTIONS_MISMATCH');
    const requested=evidence.requestedCoordinates,snapped=evidence.snappedCoordinates;
    if(!coordinate(from)||!coordinate(to)||!Array.isArray(requested)||requested.length!==2||!requested.every(coordinate)||!Array.isArray(snapped)||snapped.length!==2||!snapped.every(coordinate))return reject('ROAD_COORDINATE_INVALID');
    if(![from,to].every((value,i)=>value.every((number,j)=>number===requested[i][j])))return reject('ROAD_DIRECTED_PAIR_MISMATCH');
    for(const field of ['snapMeters','measuredSnapMeters'])if(!Array.isArray(evidence[field])||evidence[field].length!==2||!evidence[field].every(value=>finite(value)&&value<=config.maxSnapMeters))return reject('ROAD_SNAP_LIMIT_EXCEEDED');
    if(requested.some((value,i)=>snapMeters(value,snapped[i])>config.maxSnapMeters))return reject('ROAD_SNAP_LIMIT_EXCEEDED');
    const observedAt=typeof row.observedAt==='string'?Date.parse(row.observedAt):NaN;
    if(!Number.isFinite(observedAt)||observedAt>now||now-observedAt>maxAgeMs)return reject('ROAD_EVIDENCE_EXPIRED');
    return {reusable:true,reason:null};
  }
  async function route(coords,options={}){
    if(!Array.isArray(coords)||coords.length<2||!coords.every(coordinate))fail('ROAD_COORDINATE_INVALID');
    if(!['WGS84','ASSUMED_WGS84_SCREENING'].includes(options.coordinateUse))fail('ROAD_COORDINATE_SYSTEM_UNCONFIRMED');
    // Capture request inputs before yielding: caller mutation must not rewrite provenance.
    coords=coords.map(value=>[...value]);
    options={...options};
    const config=settings(options),abort=new AbortController(),signal=options.signal;
    let timer,onAbort;
    const stopped=new Promise((_,reject)=>{onAbort=()=>{abort.abort();reject(Object.assign(new Error('ROAD_CANCELLED'),{code:'ROAD_CANCELLED'}));};if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Object.assign(new Error('ROAD_REQUEST_TIMEOUT'),{code:'ROAD_REQUEST_TIMEOUT'}));},config.timeoutMs);});
    try{
      const url=config.endpoint+'/route/v1/'+config.profile+'/'+coords.map(c=>c.map(v=>v.toFixed(6)).join(',')).join(';')+'?overview='+ (options.geometry?'full':'false')+'&geometries=geojson&alternatives=false&steps=false';
      const response=await Promise.race([(options.fetch||globalThis.fetch)(url,{signal:abort.signal,redirect:'error'}),timeout,stopped]);
      if(!response.ok)fail('ROAD_HTTP_ERROR',{status:response.status});
      const body=await Promise.race([response.json(),timeout,stopped]),result=body?.routes?.[0];
      if(body?.code!=='Ok'||!result)fail('ROAD_UNREACHABLE',{code:body?.code||null});
      if(!finite(result.distance)||!finite(result.duration))fail('ROAD_METRIC_INVALID');
      if(!Array.isArray(body.waypoints)||body.waypoints.length!==coords.length||body.waypoints.some(w=>!coordinate(w.location)||!finite(w.distance)))fail('ROAD_SNAP_EVIDENCE_MISSING');
      const measuredSnapMeters=body.waypoints.map((w,index)=>snapMeters(coords[index],w.location));
      if(body.waypoints.some(w=>w.distance>config.maxSnapMeters)||measuredSnapMeters.some(distance=>distance>config.maxSnapMeters))fail('ROAD_SNAP_LIMIT_EXCEEDED',{maxSnapMeters:config.maxSnapMeters});
      const geometry=result.geometry?.coordinates;
      if(options.geometry&&(!Array.isArray(geometry)||geometry.length<2||!geometry.every(coordinate)))fail('ROAD_GEOMETRY_INVALID');
      const row={distanceKm:result.distance/1000,travelSeconds:result.duration,unit:'km',quality:'ESTIMATED_ROAD',source:'OSRM_LOCAL',strategy:'ROUTE_DRIVING',observedAt:new Date().toISOString(),evidence:{endpoint:config.endpoint,profile:config.profile,networkVersion:config.networkVersion,coordinateUse:options.coordinateUse,requestedCoordinates:coords,snappedCoordinates:body.waypoints.map(w=>w.location),snapMeters:body.waypoints.map(w=>w.distance),measuredSnapMeters,verification:'ENGINE_CALCULATED_NOT_MANUALLY_VERIFIED',truckRestrictions:'NOT_VERIFIED',traffic:'NOT_MODELED'}};
      if(options.geometry)row.geometry=geometry;
      return row;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  }
  async function matrix(study,pairs,options={}){
    if(!['WGS84','ASSUMED_WGS84_SCREENING'].includes(study.coordinateUse))fail('ROAD_COORDINATE_SYSTEM_UNCONFIRMED');
    const config=settings(options),abort=new AbortController(),external=options.signal;
    let timeout=false,done=0,index=0;
    const rows=[],failures=[],started=Date.now(),stop=()=>abort.abort();
    external?.addEventListener('abort',stop,{once:true});if(external?.aborted)stop();
    const timer=setTimeout(()=>{timeout=true;abort.abort();},config.budgetMs);
    try{
      await Promise.all(Array.from({length:Math.min(6,pairs.length)},async()=>{
        while(index<pairs.length&&!abort.signal.aborted){
          const [from,to]=pairs[index++];
          try{const row=await route([from.coordinate,to.coordinate],{...options,coordinateUse:study.coordinateUse,signal:abort.signal});rows.push({...row,fromNodeId:from.nodeId,toNodeId:to.nodeId});}
          catch(error){failures.push({fromNodeId:from.nodeId,toNodeId:to.nodeId,code:error.code||'ROAD_CONNECTION_FAILED'});}
          done++;options.onProgress?.({done,total:pairs.length,successful:rows.length,failed:failures.length});
        }
      }));
      if(external?.aborted)fail('ROAD_CANCELLED');
      return {rows,failures,total:pairs.length,done,status:timeout?'PARTIAL_BUDGET_EXPIRED':failures.length?'PARTIAL':'COMPLETE',elapsedMs:Date.now()-started};
    }finally{clearTimeout(timer);external?.removeEventListener('abort',stop);}
  }
  function reusable(row,study,options={}){
    if(!row||!study||!Array.isArray(study.nodes))return false;
    const from=study.nodes.find(node=>node.nodeId===row.fromNodeId)?.coordinate;
    const to=study.nodes.find(node=>node.nodeId===row.toNodeId)?.coordinate;
    return reuseAssessment(row,from,to,study.coordinateUse,options,options.now??Date.now()).reusable;
  }
  return Object.freeze({settings,route,matrix,reuseAssessment,reusable});
});
