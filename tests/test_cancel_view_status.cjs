'use strict';
// Production view; explicitly controlled controller receipts, no native solver claim.
const assert=require('node:assert/strict');
const test=require('node:test');
const View=require('../supply-chain-view-v19.js');
for(const [status,expected] of [
  ['CANCELLED','计算已取消'],['COMPLETE','任务已完成，取消未生效'],
  ['PARTIAL','任务已结束并保留部分结果，未确认取消'],['FAILED','任务已失败，取消未生效'],
  [null,'尚未确认取消']
])test(`visible cancellation follows ${status||'unconfirmed'} receipt`,async()=>{
  const state={study:null,status:'SOLVING',job:status?{status}:null,candidates:[],solverRuns:[]};
  const view=View.createView({download(){}});
  view.setController({viewState:()=>state,cancel:async()=>state});
  await view.action('cancel-run');
  const html=view.render(state);assert.ok(html.includes(expected),html);
  if(status!=='CANCELLED')assert.ok(!html.includes('计算已取消；'));
});
test('cancelled comparison does not inherit a prior complete solver message',async()=>{
  const state={study:null,status:'CANCELLED',job:{status:'COMPLETE'},candidates:[],solverRuns:[]};
  const view=View.createView({download(){}});
  view.setController({viewState:()=>state,cancel:async()=>state});await view.action('cancel-run');
  assert.ok(view.render(state).includes('计算已取消；'));
});
for(const [code,expected] of [['SUPPLY_JOB_BUSY','本次请求未排队'],['SUPPLY_SERVICE_INCOMPATIBLE','未提交计算'],['SUPPLY_JOB_PROTOCOL_INVALID','未采用该结果']]) {
  test(`business error message explains ${code}`,()=>{
    const state={study:null,status:'FAILED',job:null,candidates:[],solverRuns:[]};
    const view=View.createView({download(){}});view.setController({viewState:()=>state});view.setError({code});
    assert.ok(view.render(state).includes(expected));
  });
}
