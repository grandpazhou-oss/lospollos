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
for(const [locale,expected,unsupportedCause] of [
  ['zh',['任务已不存在','无法继续','输入仍保留','开始分析','重新分析'],/重启|过期/],
  ['en',['job no longer exists','cannot continue','inputs remain','Start analysis','rerun'],/restart|expir/i],
  ['ja',['ジョブは存在しない','継続できません','入力はこの画面に保持','分析を開始','再分析'],/再起動|期限切れ/]
])test(`missing job explains interruption and recovery in ${locale}`,()=>{
  const state={study:null,status:'FAILED',job:{jobId:'lost-job',status:'SOLVING'},snapshot:null,candidates:[],solverRuns:[]};
  const before=structuredClone(state),view=View.createView({download(){}});
  view.setController({viewState:()=>state});view.setError({code:'SUPPLY_JOB_NOT_FOUND'});
  // Switching the actual render locale must translate the stored error too.
  const html=view.render(state,locale);
  const message=html.match(/<p class="sc-message is-error" role="alert">([^<]+)<\/p>/)?.[1];
  assert.ok(message,'Missing visible error alert');
  for(const text of expected)assert.ok(message.includes(text),message);
  assert.doesNotMatch(message,unsupportedCause,'A missing job does not establish restart or expiry as its cause');
  assert.ok(html.includes('SUPPLY_JOB_NOT_FOUND'),'Technical error evidence must remain available');
  assert.deepEqual(state,before,'Error presentation must not mutate job, result or study state');
});
