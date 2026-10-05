'use strict';
// Finite CSV encoding/delimiter contracts; original bytes remain unchanged.
const assert=require('node:assert/strict'),Import=require('../supply-chain-import-v19.js'),View=require('../supply-chain-view-v19.js');
for(const delimiter of [',',';','\t']){
 const bytes=Buffer.from('\uFEFF'+['customer_id','customer_name','quantity'].join(delimiter)+'\n'+['001','Synthetic customer','0.25'].join(delimiter)),before=Buffer.from(bytes);
 const book=Import.inspectWorkbook(bytes,'synthetic.csv',{csvDelimiter:delimiter});assert.equal(book.sheets[0].rows[1].values[0],'001');assert.equal(String(book.sheets[0].rows[1].values[2]),'0.25');assert.deepEqual(bytes,before);
}
const invalid=Buffer.from([0x63,0x75,0x73,0x74,0x0a,0xc3,0x28]),before=Buffer.from(invalid);assert.throws(()=>Import.inspectWorkbook(invalid,'synthetic.csv'),{code:'SC_IMPORT_UTF8_INVALID'});assert.deepEqual(invalid,before);
assert.throws(()=>Import.inspectWorkbook(Buffer.from('a\nb'),'synthetic.csv',{csvDelimiter:'|'}),{code:'SC_IMPORT_DELIMITER_INVALID'});
const view=View.createView({download(){},renderHost(){}});view.setController({viewState:()=>({})});view.setError({code:'SC_IMPORT_UTF8_INVALID'});
for(const [locale,label] of [['zh','CSV 编码无法识别'],['en','The CSV encoding is invalid'],['ja','CSV の文字コードが無効']])assert.ok(view.render({},locale).includes(label));
console.log(JSON.stringify({status:'PASS',method:'CSV_BYTES_WITH_FATAL_UTF8_NO_BROWSER',checks:['comma-semicolon-tab','BOM','leading-zero-ID','fraction-preservation','invalid-UTF8-specific-code','original-bytes-unchanged']}));
