#!/usr/bin/env node
'use strict';
// Node VM checks of the real dismissal and guide actions with DOM/rendering doubles.
// Real dialog focus containment and 390px layout are covered by browser acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','platform-map-runtime-v19.js'),'utf8');
const seam=`
  root.__focusUnit={
    configure(state,fixture,options={}){
      owner='SUPPLY';views.clear();Object.assign(view(),state);host=fixture.host;config={locale:'zh',noWebGL:Boolean(options.noWebGL)};
      fullscreen=null;failed=Boolean(options.failed);areaSelection=options.area?{}:null;map={getCanvas:()=>fixture.canvas};
      root.document=fixture.document;root.matchMedia=()=>({matches:false});
      renderGuide=()=>{fixture.guideClose.hidden=!view().guideOpen;};renderAnalysis=()=>{};updateSource=()=>{};renderMode=()=>{};
      fullscreenGestures=()=>{};focusBar=()=>{};resizeMaps=()=>{};labels=()=>{};
      leaveFlow=()=>{fixture.actions.push('flow');view().flowOpen=false;};
      backToRelations=()=>{fixture.actions.push('relation');view().selectedRelationId='';};
      cancelArea=()=>{fixture.actions.push('area');areaSelection=null;};
      hidePicker=()=>{fixture.actions.push('picker');fixture.picker.hidden=true;};
      closeFullscreen=()=>{fixture.actions.push('fullscreen');fullscreen=null;view().expanded=false;};
    },openFullscreen,onClick,state:()=>view(),isFullscreen:()=>Boolean(fullscreen)
  };
`;
const sandbox={structuredClone};
vm.runInNewContext(source.replace(/\}\)\(globalThis\);\s*$/,seam+'})(globalThis);'),sandbox,{filename:'platform-map-runtime-v19.js (focus unit seam)'});
const api=sandbox.__focusUnit;let assertions=0;
function eq(actual,expected,label){assert.equal(actual,expected,label);assertions++;}
function fixture(){
  const f={actions:[],handlers:{}};
  const node=name=>({name,hidden:false,style:{},setAttribute(){},focus(){if(!this.hidden)f.document.activeElement=this;}});
  f.document={activeElement:null,body:{style:{overflow:''}},createElement:tag=>tag==='dialog'?f.dialog:node('placeholder')};
  f.summary=node('analysis-summary');f.tool={open:false,querySelector:()=>f.summary};
  f.guideButton=node('guide-button');f.guideButton.closest=()=>f.tool;f.guideButton.focus=function(){if(f.tool.open)f.document.activeElement=this;};
  f.guideClose=node('guide-close');f.picker=node('picker');f.picker.hidden=true;f.canvas=node('canvas');f.search=node('search');f.area=node('area');f.details={open:true};
  f.dialog={setAttribute(){},addEventListener:(type,listener)=>{f.handlers[type]=listener;},querySelector:()=>({append(){}}),showModal(){}};
  f.host={isConnected:true,hidden:false,parentNode:{insertBefore(){}},closest:()=>null,getBoundingClientRect:()=>({height:640}),classList:{add(){}},querySelector:selector=>({'[data-p7-guide]':f.guideButton,'[data-p7-guide-close]':f.guideClose,'.p7-map-picker':f.picker,'[data-p7-search]':f.search,'[data-p7-area]':f.area,'.p7-entity-details':f.details})[selector],querySelectorAll:()=>f.tool.open?[f.tool]:[]};
  f.clickGuide=()=>{f.tool.open=true;f.guideButton.focus();api.onClick({target:{closest:selector=>selector==='[data-p7-guide]'||selector==='.p7-tool-panel button'?f.guideButton:null}});};
  f.escape=(type='keydown')=>{const e={key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};f.handlers[type](e);eq(e.prevented,true,type+' prevents native dialog close');eq(e.stopped,true,type+' stops outer Escape handlers');};
  return f;
}

for(const eventType of ['keydown','cancel']){
  const f=fixture();api.configure({guideOpen:false},f);api.openFullscreen();f.clickGuide();
  eq(f.tool.open,false,'opening guide closes its tool popover');eq(api.state().guideOpen,true,'guide opens');
  eq(f.document.activeElement,f.guideClose,'focus moves into the opened guide');
  f.escape(eventType);eq(api.isFullscreen(),true,eventType+' first dismiss retains fullscreen');eq(api.state().guideOpen,false,eventType+' closes guide');
  eq(f.document.activeElement,f.summary,'focus returns to the visible analysis summary, not a hidden button');
  f.escape(eventType);eq(api.isFullscreen(),false,eventType+' next dismiss exits fullscreen');
}

for(const eventType of ['keydown','cancel']){
  const f=fixture();api.configure({flowOpen:true,selectedRelationId:'SYNTHETIC-RELATION',guideOpen:true},f,{area:true});api.openFullscreen();f.tool.open=true;f.picker.hidden=false;
  f.escape(eventType);eq(f.tool.open,false,'tool group has first priority');eq(api.state().flowOpen,true,'tool dismissal preserves flow');eq(f.document.activeElement,f.summary,'closed tool returns summary focus');
  f.escape(eventType);eq(f.actions.at(-1),'flow','flow has next priority');eq(api.state().selectedRelationId,'SYNTHETIC-RELATION','flow dismissal preserves relation');
  f.escape(eventType);eq(f.actions.at(-1),'relation','relation detail has next priority');
  f.escape(eventType);eq(f.actions.at(-1),'area','rectangle selection has next priority');eq(f.document.activeElement,f.area,'rectangle dismissal restores area button focus');
  f.escape(eventType);eq(api.state().guideOpen,false,'guide follows rectangle selection');eq(f.picker.hidden,false,'guide dismissal preserves picker');
  f.escape(eventType);eq(f.actions.at(-1),'picker','picker is dismissed before fullscreen');eq(f.document.activeElement,f.canvas,'picker returns WebGL canvas focus');
  eq(api.isFullscreen(),true,'all local layers dismiss before fullscreen');f.escape(eventType);eq(api.isFullscreen(),false,'last dismiss exits fullscreen');
}

for(const options of [{noWebGL:true},{failed:true}]){
  const f=fixture();api.configure({},f,options);api.openFullscreen();f.picker.hidden=false;f.escape('cancel');
  eq(f.document.activeElement,f.search,'picker returns search focus without a working map');eq(api.isFullscreen(),true,'fallback picker dismissal retains fullscreen');
}
const f=fixture();api.configure({guideOpen:true},f);api.openFullscreen();f.clickGuide();eq(api.state().guideOpen,false,'guide trigger toggles off existing guide');eq(f.document.activeElement,f.summary,'toggle off restores visible summary focus');
const ignored={key:'ArrowRight',preventDefault(){throw Error('ordinary key was prevented');},stopPropagation(){throw Error('ordinary key was stopped');}};f.handlers.keydown(ignored);eq(api.isFullscreen(),true,'ordinary dialog keys do not dismiss anything');
console.log('PASS fullscreen guide focus and shared dismissal ('+assertions+' assertions; VM DOM doubles, not browser acceptance)');
