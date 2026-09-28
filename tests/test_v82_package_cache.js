'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Controller=require('../supply-chain-controller-v19.js');

const file=process.env.STCT_SUPPLY_PACKAGE;
if(!file)throw Error('STCT_SUPPLY_PACKAGE is required');
const original=fs.readFileSync(file,'utf8');
const controller=Controller.createController();
controller.importPackage(original);
const first=controller.exportPackage(),second=controller.exportPackage();
assert.equal(second,first,'same immutable snapshot must produce byte-identical package');
assert.equal(JSON.parse(first).packageHash,JSON.parse(original).packageHash);
controller.updateStudy({name:`${controller.snapshot().study.name} changed`});
assert.throws(()=>controller.exportPackage(),{code:'SUPPLY_SNAPSHOT_NOT_READY'},'changed input must invalidate the cached package');
controller.importPackage(original);
assert.equal(controller.exportPackage(),first,'reloaded verified snapshot must export identically');
console.log(JSON.stringify({status:'PASS',byteIdentical:true,changedInputBlocked:true,reloadedVerified:true}));
