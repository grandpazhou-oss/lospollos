'use strict';
const assert=require('node:assert/strict'),Map=require('../platform-supply-map-v8.js');
const polygon=()=>({type:'Polygon',coordinates:[[[110,29],[112,29],[112,31],[110,31],[110,29]]]});
const named=name=>({type:'name',properties:{name}});
const region=(declaration,level)=>{
  const geometry=polygon(),feature={type:'Feature',properties:{},geometry},collection={type:'FeatureCollection',features:[feature]};
  ({collection,feature,geometry})[level].crs=declaration;
  return collection;
};
const model={entities:[{id:'A',coordinate:[111,30]},{id:'B',coordinate:[115,30]}],relations:[{relationId:'AB',fromNodeId:'A',toNodeId:'B'}]};
let checks=0;
function accepted(value){
  const before=JSON.stringify({model,value});
  assert.deepEqual(Map.regionMembers(model,value,'ORIGIN'),['AB']);
  assert.equal(JSON.stringify({model,value}),before);
  checks++;
}
function rejected(value,code='REGION_CRS_UNSUPPORTED'){
  const before=JSON.stringify({model,value});
  assert.throws(()=>Map.regionMembers(model,value,'ORIGIN'),error=>error.message===code);
  assert.equal(JSON.stringify({model,value}),before);
  checks++;
}
// Small numeric projected coordinates are still not longitude/latitude: range checks cannot identify CRS.
for(const level of ['collection','feature','geometry']){
  for(const declaration of [named('EPSG:3857'),named('EPSG:4490'),named('UNKNOWN'),named('GCJ-02'),null,{},'EPSG:4326',{type:'link',properties:{href:'https://example.invalid/crs'}}])rejected(region(declaration,level));
}
for(const value of [polygon(),{type:'Feature',properties:{},geometry:polygon()},{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:polygon()}]}])accepted(value);
const supported=['WGS84','WGS 84','EPSG:4326','OGC:CRS84','CRS84','urn:ogc:def:crs:EPSG::4326','urn:ogc:def:crs:EPSG:6.6:4326','urn:ogc:def:crs:OGC:1.3:CRS84','http://www.opengis.net/def/crs/EPSG/0/4326','https://www.opengis.net/def/crs/OGC/1.3/CRS84'];
for(const level of ['collection','feature','geometry'])for(const name of supported)accepted(region(named(name),level));
const inherited=region(named('EPSG:4326'),'collection');
inherited.features[0].geometry.crs=named('EPSG:3857');rejected(inherited);
const mixed=region(named('EPSG:4326'),'collection');
mixed.features.push({type:'Feature',properties:{},geometry:{...polygon(),crs:named('UNKNOWN')}});rejected(mixed);
accepted({type:'MultiPolygon',coordinates:[polygon().coordinates],crs:named('EPSG:4326')});
rejected({...polygon(),crs:named('https://www.opengis.net/def/crs/EPSG/0/3857')});
rejected({...polygon(),crs:named('urn:ogc:def:crs:EPSG::43260')});
rejected({type:'Polygon',coordinates:[[[0,0],[2,2],[2,0],[0,2],[0,0]]]},'REGION_SELF_INTERSECTION');
rejected({type:'Polygon',coordinates:[[[179,0],[-179,0],[-179,1],[179,1],[179,0]]]},'REGION_DATELINE_UNSUPPORTED');
const many=Array.from({length:1000},(_,i)=>[110+Math.cos(i/1000*Math.PI*2),30+Math.sin(i/1000*Math.PI*2)]);many.push(many[0]);
rejected({type:'Polygon',coordinates:[many]},'REGION_RING_LIMIT_1000');
console.log(JSON.stringify({status:'PASS',tier:'SYNTHETIC_PURE_PROJECTION',checks,scope:'Explicit CRS at collection, feature and geometry; RFC 7946 defaults; unsupported and conflicting declarations; geometry protections and immutability'}));
