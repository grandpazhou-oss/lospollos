'use strict';
const assert=require('node:assert/strict');
const Road=require('../local-road-client-v86.js');
const Contract=require('../network-contract-v18.js');
const Design=require('../supply-chain-design-v19.js');
const networkVersion='china-260928-arterial-ferry-mld';
const body={code:'Ok',routes:[{distance:1089765,duration:7200,geometry:{coordinates:[[116.4,39.9],[117.2,40.1]]}}],waypoints:[{location:[116.4,39.9],distance:0},{location:[117.2,40.1],distance:0}]};
const fetch=async()=>({ok:true,json:async()=>body});
(async()=>{
  const options={coordinateUse:'WGS84',roadNetworkVersion:networkVersion,fetch};
  const row=await Road.route([[116.4,39.9],[117.2,40.1]],options);
  assert.equal(row.evidence.networkVersion,networkVersion);
  assert.equal(Object.hasOwn(row,'geometry'),false);
  assert.equal(Contract.hashArtifact(row),Contract.hashArtifact(JSON.parse(JSON.stringify(row))));

  const source={studyId:'W1-ROUNDTRIP',classification:'SYNTHETIC_TEST',costApplicability:{inventoryHolding:'NOT_APPLICABLE',transferTransport:'NOT_APPLICABLE'},nodes:[{nodeId:'F',role:'FACTORY'},{nodeId:'W',role:'DC'},{nodeId:'C',role:'CUSTOMER'}],periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'W',period:'P1',quantity:1,unit:'m3'}],observedInbound:[],distanceRows:[{...row,fromNodeId:'F',toNodeId:'W'}],rates:[]};
  const study=Design.createStudy(source);
  const reopened=Design.createStudy(JSON.parse(JSON.stringify(study)));
  assert.equal(reopened.inputHash,study.inputHash);
  const draft={schemaVersion:'stct-supply-chain-draft-v1',study,profile:null,scenario:null,staleResult:null};
  assert.equal(Design.hash(JSON.parse(JSON.stringify(draft))),Design.hash(draft));

  const withGeometry=await Road.route([[116.4,39.9],[117.2,40.1]],{...options,geometry:true});
  assert.deepEqual(withGeometry.geometry,body.routes[0].geometry.coordinates);
  assert.equal(withGeometry.evidence.networkVersion,networkVersion);
  assert.equal(Contract.hashArtifact(withGeometry),Contract.hashArtifact(JSON.parse(JSON.stringify(withGeometry))));

  const legacyShape={...row,geometry:undefined};
  assert.notEqual(Contract.hashArtifact(legacyShape),Contract.hashArtifact(JSON.parse(JSON.stringify(legacyShape))));
  console.log(JSON.stringify({status:'PASS',checks:8,scope:'STUDY_AND_PACKAGE_JSON_ROUND_TRIP_IDENTITY_AND_NETWORK_PROVENANCE'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
