'use strict';
const assert=require('node:assert/strict'),{rectangleBounds,selectArea}=require('../platform-supply-map-v8.js');
const m={entities:[{id:'east',coordinate:[179,10]},{id:'west',coordinate:[-179,10]},{id:'middle',coordinate:[0,10]},{id:'missing',coordinate:null}]};
for(const points of [[[178,0],[182,20]],[[-182,20],[-178,0]],[[538,0],[542,20]]]){assert.deepEqual(rectangleBounds(...points),[178,0,-178,20]);assert.deepEqual(selectArea(m,rectangleBounds(...points)),['east','west']);}
assert.deepEqual(selectArea(m,rectangleBounds([-200,0],[200,20])),['east','west','middle']);
assert.deepEqual(selectArea(m,rectangleBounds([-10,0],[10,20])),['middle']);
assert.equal(rectangleBounds([NaN,0],[1,2]),null);assert.deepEqual(selectArea(m,null),[]);
console.log('PASS: unwrapped world copies, dateline crossing, global and ordinary rectangles; missing coordinates excluded');
