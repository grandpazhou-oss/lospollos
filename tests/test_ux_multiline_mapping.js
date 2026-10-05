'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Import=require('../supply-chain-import-v19.js'),Intake=require('../platform-import-session-v19.js').tabularIntake,XLSX=require('../vendor/xlsx/xlsx.full.min.js');
function book(rows,merges=[],name='Synthetic monthly demand'){
  const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!merges']=merges.map(range=>XLSX.utils.decode_range(range));
  XLSX.utils.book_append_sheet(wb,sheet,name);
  return Import.inspectWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'SYNTHETIC.xlsx');
}
const source=book([
  ['2027年1月至2月配送数据'],
  ['需求编号','客户名称','配送地址','1月','','2月',''],
  ['','','','箱数','立方数','箱数','立方数'],
  ['D1','Cedar','SYNTHETIC address',10,1.25,20,2.75],
  ['D2','Birch','SYNTHETIC address',0,0,3,.125]
],['A1:G1','A2:A3','B2:B3','C2:C3','D2:E2','F2:G2']);
const before=JSON.stringify(source),profile=Intake.template(source),block=profile.blocks[0];
assert.equal(Intake.suggest(source),'SUPPLY_CHAIN_PERIOD','Grouped monthly tables remain strategic studies in public import');
assert.deepEqual(block.headerRows,[2,3]);assert.equal(block.startRow,4);assert.equal(block.kind,'PERIOD_DEMAND');assert.equal(block.primaryMeasure,'volume');
assert.deepEqual(block.periodColumns.map(p=>[p.column,p.period,p.measure,p.unit]),[[4,'2027-01','boxes','boxes'],[5,'2027-01','volume','m3'],[6,'2027-02','boxes','boxes'],[7,'2027-02','volume','m3']]);
assert.equal(block.fields.customerAddress,3);
assert.equal(Intake.headerBand(source.sheets[0],block.headerRows).columns[6].heading,'2月 · 立方数');
const imported=Import.applyProfile(source,profile);assert.equal(imported.summary.demandBusinessRows,2);assert.equal(imported.summary.periodDemandTotals.m3,4.125);assert.equal(imported.periodDemand.length,4);assert.equal(imported.periodDemand[0].source.rowNumber,4);
assert.equal(JSON.stringify(source),before,'Original cells and merges are immutable');
profile.matchSignature=Import.profileSignature(source,profile);
const profileBefore=JSON.stringify(profile),matched=Import.matchProfile(source,profile);
assert.equal(matched.requiresReview,false);assert.deepEqual(matched.profile,profile);assert.equal(JSON.stringify(profile),profileBefore);
const nextYear=structuredClone(source);nextYear.sheets[0].rows[0].values[0]='2028年1月至2月配送数据';
const yearMatch=Import.matchProfile(nextYear,profile);assert.equal(yearMatch.requiresReview,true);assert.deepEqual([...new Set(yearMatch.profile.blocks[0].periodColumns.map(c=>c.period))],['2028-01','2028-02']);
assert.equal(Import.applyProfile(nextYear,yearMatch.profile).periodDemand[0].period,'2028-01');
assert.equal(Intake.period('2027年1月至2月配送数据'),null);assert.equal(Intake.period('总计 2027-01'),null);assert.equal(Intake.period('2027-01m3'),'2027-01');assert.equal(Intake.period('2027年1月'),'2027-01');
const conflict=structuredClone(source);conflict.sheets[0].rows[0].values[0]='2026与2027年数据';
assert.equal(Intake.template(conflict).blocks[0].periodColumns.length,0,'Ambiguous year is not guessed');
const unknown=book([['备注','说明'],['alpha','beta']]),unknownProfile=Intake.template(unknown);
assert.equal(unknownProfile.blocks[0].kind,'UNCONFIRMED');assert.throws(()=>Import.applyProfile(unknown,unknownProfile),e=>e.code==='SC_PROFILE_KIND_INVALID'&&e.detail.sheet==='Synthetic monthly demand'&&e.detail.blockIndex===0);
const nodes=book([['节点名称','地址'],['Cedar','SYNTHETIC address']]),nodesProfile=Intake.template(nodes);
assert.equal(nodesProfile.blocks[0].kind,'NODE');assert.equal(nodesProfile.blocks[0].periodColumns.length,0);assert.throws(()=>Import.applyProfile(nodes,nodesProfile),e=>e.code==='SC_PROFILE_NODE_ROLE_REQUIRED');
nodesProfile.blocks[0].nodeRole='FACTORY';assert.equal(Import.applyProfile(nodes,nodesProfile).nodes[0].role,'FACTORY');
const bad=structuredClone(profile);bad.blocks[0].periodColumns[0].unit='';
assert.throws(()=>Import.applyProfile(source,bad),e=>e.code==='SC_PROFILE_PERIOD_INVALID'&&e.detail.column===4&&e.detail.sheet===source.sheets[0].name&&e.detail.blockIndex===0);
const results=[];
const catalog=require('../profiles/supply-chain-profile-catalog-v19.json');
const profiles=catalog.profiles.map(item=>item.profile||require(path.join('..',item.path)));
for(const [name,file]of [['UC_ORIGINAL',process.env.STCT_UC_ORIGINAL],['UC_COORDINATES',process.env.STCT_UC_WORKBOOK]]){
  if(!file){results.push({name,status:'NOT_RUN',reason:'Workbook environment variable not provided'});continue;}
  const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex'),wb=Import.inspectWorkbook(bytes,path.basename(file));
  const matches=profiles.map(p=>Import.matchProfile(wb,p)).filter(Boolean);assert.equal(matches.length,1,'Exactly one explicit layout matches');
  assert.equal(matches[0].requiresReview,false);assert.deepEqual(matches[0].changes,[]);
  const result=Import.applyProfile(wb,matches[0].profile);
  assert.equal(result.summary.demandBusinessRows,257);assert.equal(result.summary.inboundBusinessRows,12);assert.equal(result.periodDemand.length,1799);assert.equal(result.observedInbound.length,84);
  assert.deepEqual([...new Set(result.periodDemand.map(row=>row.period))].sort(),Array.from({length:7},(_,i)=>`2026-0${i+1}`));
  assert.ok(Math.abs(result.summary.periodDemandTotals.m3-115934.168)<1e-8);assert.ok(Math.abs(result.summary.observedInboundTotals.m3-97370.239)<1e-8);
  assert.equal(result.observedAssignments.length,257);assert.equal(result.nodes.filter(n=>!n.coordinate).length,name==='UC_ORIGINAL'?266:1);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
  results.push({name,status:'PASS',sha256:hash,summary:result.summary});
}
console.log(JSON.stringify({status:'PASS',method:'PRODUCTION_IMPORT_AND_MATCHING_NOT_BROWSER',synthetic:{periods:4,volume:4.125},realWorkbooks:results}));
