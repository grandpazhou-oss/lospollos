'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const current=require('../integrity-hash-v151.js');
// Independent UTF-8 comparator retains the exact numeric return value, not just its sign.
const reference=(a,b)=>{const encode=x=>new TextEncoder().encode(String(x??'').replace(/\r\n?/g,'\n').normalize('NFC'));const left=encode(a),right=encode(b);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];return left.length-right.length;};
const values=['','abc','ab','\r\n','\r','é','e\u0301','日本語','中文','😀','\ud800','\u007f','\u0080',null,100];
for(const a of values)for(const b of values)assert.equal(current.utf8Compare(a,b),reference(a,b));
const payload={z:0,a:-0,'日本語':'e\u0301',values:[null,true,false,0,12.345678,'😀']};
assert.equal(current.sha256Text(current.canonicalString(payload)),'sha256:'+crypto.createHash('sha256').update(current.canonicalString(payload)).digest('hex'));
if(process.env.STCT_HASH_BASELINE){const context={module:{exports:{}},TextEncoder,Uint8Array,Uint32Array,DataView};vm.runInNewContext(fs.readFileSync(process.env.STCT_HASH_BASELINE,'utf8'),context);const old=context.module.exports;for(const a of values)for(const b of values)assert.equal(current.utf8Compare(a,b),old.utf8Compare(a,b));if(process.env.STCT_SUPPLY_PACKAGE){const input=JSON.parse(fs.readFileSync(process.env.STCT_SUPPLY_PACKAGE,'utf8'));for(const item of [input,input.study,input.snapshot])assert.equal(current.hashValue(item),old.hashValue(item));}}
console.log(JSON.stringify({status:'PASS',utf8NumericComparisons:values.length**2,canonicalBytes:'UNCHANGED',sha256:'INDEPENDENT_NODE_CRYPTO_MATCH'}));
