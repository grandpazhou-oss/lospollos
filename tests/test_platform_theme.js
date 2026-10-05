'use strict';
// Isolated preference and map lifecycle vectors, using the production asset.
// Browser journeys are recorded separately; these are not native OS tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../platform-map-runtime-v19.js'),'utf8');
const preferenceSource=source.slice(0,source.indexOf('\n(function(root){',source.indexOf('})(globalThis);')));
const KEY='stct-ui-appearance-v1';
function environment(saved=null,{systemDark=false,failWrite=false}={}){
  const listeners={},docListeners={},writes=[],events=[],fields={'select[data-ui-theme]':[{value:''}],'select[data-ui-basemap]':[{value:''}],'[data-ui-theme-status]':[]};
  const media={matches:systemDark,addEventListener:(name,fn)=>media.change=fn};
  const sandbox={matchMedia:()=>media,localStorage:{getItem:()=>saved,setItem:(key,value)=>{if(failWrite)throw Error('quota');writes.push({key,value});saved=value;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>{events.push(event);listeners[event.type]?.(event);},addEventListener:(name,fn)=>listeners[name]=fn,document:{documentElement:{dataset:{}},querySelectorAll:selector=>fields[selector]||[],addEventListener:(name,fn)=>docListeners[name]=fn}};
  vm.runInNewContext(preferenceSource,sandbox);
  return {api:sandbox.STCTPlatformV19.theme,sandbox,listeners,docListeners,writes,events,media,fields};
}
const clean=value=>JSON.parse(JSON.stringify(value));
let env=environment(null,{systemDark:true});
assert.deepEqual(clean(env.api.state()),{mode:'light',map:'auto',resolved:'light',persistent:true},'existing users stay light even on dark OS');
assert.equal(env.writes.length,0,'loading is read-only');
env.api.set('mode','dark');assert.equal(env.sandbox.document.documentElement.dataset.uiTheme,'dark');assert.equal(env.fields['select[data-ui-theme]'][0].value,'dark');
assert.equal(env.writes[0].key,KEY);assert.deepEqual(Object.keys(JSON.parse(env.writes[0].value)).sort(),['map','mode'],'no study/job/result fields in UI preferences');
assert.equal(env.api.set('mode','invalid'),false);assert.equal(env.api.set('studyId','X'),false);assert.equal(env.writes.length,1);
const count=env.events.length;env.api.set('mode','dark');assert.equal(env.events.length,count,'same theme does not restart map styles');
env.api.set('mode','system');assert.equal(env.api.state().resolved,'dark');env.media.matches=false;env.media.change();assert.equal(env.api.state().resolved,'light');
env.api.set('mode','light');env.media.matches=true;env.media.change();assert.equal(env.api.state().resolved,'light','OS changes do not override manual preference');
env.listeners.storage({key:KEY,newValue:JSON.stringify({mode:'dark',map:'light'})});assert.equal(env.api.state().resolved,'dark');assert.equal(env.api.basemap({mapStyles:{dark:'D'},mapStyleUrl:'L'}),'L');
env.api.set('map','dark');env.api.set('mode','light');assert.equal(env.api.basemap({mapStyles:{dark:'D'},mapStyleUrl:'L'}),'D','independent map override');
env.api.set('map','auto');assert.equal(env.api.basemap({mapStyles:{dark:'D'},mapStyleUrl:'L'}),'L');
const previous=clean(env.api.state());env.listeners.storage({key:'unrelated',newValue:'{}'});assert.deepEqual(clean(env.api.state()),previous);
env.listeners.storage({key:KEY,newValue:'broken'});assert.equal(env.api.state().mode,'light');
assert.equal(environment(JSON.stringify({mode:'dark',map:'auto'})).api.state().resolved,'dark','cold reload restores before DOM content');
env=environment(null,{failWrite:true});env.api.set('mode','dark');assert.equal(env.api.state().resolved,'dark');assert.equal(env.api.state().persistent,false);assert.match(env.api.controls('en'),/could not save/);
for(const lang of ['zh','en','ja']){const html=env.api.controls(lang,true);assert.match(html,/aria-label=/);assert.match(html,/data-ui-theme/);assert.match(html,/data-ui-basemap/);assert.ok(!html.includes('undefined'));}

// Header icon toggles use the resolved theme, including a previously saved system preference.
env=environment(JSON.stringify({mode:'system',map:'auto'}),{systemDark:true});
assert.match(env.api.toggle('zh'),/切换为浅色模式/);assert.match(env.api.toggle('en'),/Switch to light mode/);assert.match(env.api.toggle('ja'),/ライトモードに切り替え/);
env.docListeners.click({target:{closest:()=>({})}});assert.equal(env.api.state().mode,'light');assert.match(env.api.toggle('zh'),/<circle/);
env.docListeners.click({target:{closest:()=>({})}});assert.equal(env.api.state().mode,'dark');assert.ok(!env.api.toggle('zh').includes('<circle'));assert.equal(JSON.parse(env.writes.at(-1).value).map,'auto');
assert.ok(!env.api.toggle('unsupported').includes('undefined'));
const unchangedWrites=env.writes.length;env.docListeners.click({target:{closest:()=>null}});assert.equal(env.writes.length,unchangedWrites);

// Actual map methods under a controlled MapLibre lifecycle; no business state injection in browser.
const seam=`root.__mapTheme={setup(m,canvasMap,peerMap){model=m;owner='SUPPLY';views.clear();config={};host={};map=canvasMap;peer={map:peerMap,ready:true};ready=true;failed=false;loadedThemeStyle='L';Object.assign(view(),{contextKey:'study:snapshot',selectedEntityId:'A',activeLayerIds:['one'],analysisIds:['A'],split:true,center:[1,2]});updateSource=()=>root.sourceUpdates++;renderMode=()=>{};},view,config:()=>config,retryBasemap,construct,neutralStyle,mapAppearance,toggleBasemap,camera:()=>styleCamera,loaded:()=>loadedThemeStyle};`;
const listeners={},sandbox={structuredClone,sourceUpdates:0,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},addEventListener:(type,fn)=>listeners[type]=fn,dispatchEvent:e=>listeners[e.type]?.(e)};
vm.runInNewContext(source.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox);
const styles=[],peerStyles=[],camera={center:[111,32],zoom:7,bearing:12,pitch:20};
const fakeMap={getCenter:()=>({toArray:()=>camera.center}),getZoom:()=>camera.zoom,getBearing:()=>camera.bearing,getPitch:()=>camera.pitch,setStyle:(url,options)=>styles.push({url,options})};
const model={provenance:{studyId:'SYNTHETIC',snapshotHash:'SNAP'},features:[]},original=JSON.stringify(model),api=sandbox.__mapTheme;
sandbox.STCT_CONFIG={mapStyleUrl:'L',mapStyles:{dark:'D'}};api.setup(model,fakeMap,{setStyle:url=>peerStyles.push(url)});
const viewBefore=JSON.stringify(api.view());sandbox.STCTPlatformV19.theme.set('mode','dark');assert.equal(styles[0].url,'D');assert.equal(peerStyles[0],'D');assert.deepEqual(clean(api.camera()),{owner:'SUPPLY',contextKey:'study:snapshot',...camera});assert.equal(JSON.stringify(api.view()),viewBefore);assert.equal(JSON.stringify(model),original);
api.config().noWebGL=true;sandbox.STCTPlatformV19.theme.set('mode','light');assert.equal(styles.length,1);assert.equal(api.loaded(),'D','skipped no-WebGL switch cannot claim style loaded');
api.config().noWebGL=false;api.construct();assert.equal(styles[1].url,'L','restored map picks up preference missed in no-WebGL mode');
assert.equal(JSON.stringify(model),original);assert.equal(JSON.stringify(api.view()),viewBefore);
// In-map theme button changes only the basemap, including neutral / no-WebGL fallback.
api.toggleBasemap();assert.equal(sandbox.STCTPlatformV19.theme.state().mode,'light');assert.equal(api.mapAppearance(),'dark');assert.equal(styles.at(-1).url,'D');assert.equal(peerStyles.at(-1),'D');assert.equal(api.neutralStyle().layers[0].paint['background-color'],'#101722');
assert.equal(JSON.stringify(model),original);assert.equal(JSON.stringify(api.view()),viewBefore);
api.toggleBasemap();assert.equal(api.mapAppearance(),'light');assert.equal(styles.at(-1).url,'L');assert.equal(api.neutralStyle().layers[0].paint['background-color'],'#eef3f2');
sandbox.STCTPlatformV19.theme.set('mode','dark');assert.equal(api.mapAppearance(),'light','explicit light map stays light with a dark UI');
api.config().noWebGL=true;const styleCount=styles.length;api.toggleBasemap();assert.equal(styles.length,styleCount);assert.equal(api.neutralStyle().layers[0].paint['background-color'],'#101722');
api.config().noWebGL=false;api.construct();assert.equal(styles.at(-1).url,'D');assert.equal(JSON.stringify(api.view()),viewBefore);
console.log('PASS theme: default, persistence, system, storage sync/failure, independent basemap, zh/en/ja, actual map retry camera/selection/split preservation, no-WebGL recovery. Node VM only.');
