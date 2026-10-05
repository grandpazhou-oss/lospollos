(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.STCTImportBudget=api;
})(globalThis,function(){
  'use strict';
  const LIMITS=Object.freeze({fileBytes:8*1024*1024,expandedBytes:48*1024*1024,rows:10000,columns:100,depth:30,string:100000,sheets:24});
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  function checkFileSize(file){if(!Number.isFinite(file.size)||file.size<0||file.size>LIMITS.fileBytes)fail('IMPORT_FILE_TOO_LARGE');}
  function checkJsonBudget(text){
    if(new TextEncoder().encode(text).length>LIMITS.fileBytes)fail('IMPORT_FILE_TOO_LARGE');
    let depth=0,quoted=false,escape=false;
    for(const char of text){if(quoted){if(escape)escape=false;else if(char==='\\')escape=true;else if(char==='"')quoted=false;}else if(char==='"')quoted=true;else if(char==='{'||char==='['){if(++depth>LIMITS.depth)fail('IMPORT_DEPTH_LIMIT');}else if(char==='}'||char===']')depth--;}
  }
  function checkValue(value,depth=0){
    if(depth>LIMITS.depth)fail('IMPORT_DEPTH_LIMIT');
    if(typeof value==='string'&&value.length>LIMITS.string)fail('IMPORT_STRING_LIMIT');
    if(value&&typeof value==='object')for(const child of Object.values(value))checkValue(child,depth+1);
    return value;
  }
  function checkWorkbook(workbook,XLSX){
    if(workbook.SheetNames.length>LIMITS.sheets)fail('IMPORT_SHEET_LIMIT');
    for(const name of workbook.SheetNames){const ws=workbook.Sheets[name];
      for(const ref of [ws['!ref'],ws['!fullref']].filter(Boolean)){const range=XLSX.utils.decode_range(ref);if(range.e.r>=LIMITS.rows||range.e.c>=LIMITS.columns)fail('IMPORT_TABLE_LIMIT');}
      for(const [key,cell]of Object.entries(ws))if(!key.startsWith('!')&&typeof cell.v==='string'&&cell.v.length>LIMITS.string)fail('IMPORT_STRING_LIMIT');
    }
    return workbook;
  }
  function zipPreflight(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(view.getUint32(at,true)===0x06054b50){end=at;break;}
    if(end<0)fail('IMPORT_XLSX_CONTAINER_INVALID');
    let at=view.getUint32(end+16,true),total=0;
    const count=view.getUint16(end+10,true);if(count>1000||view.getUint16(end+4,true)!==0)fail('IMPORT_XLSX_LIMIT');
    for(let i=0;i<count;i++){
      if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)fail('IMPORT_XLSX_CONTAINER_INVALID');
      if(view.getUint16(at+8,true)&1)fail('IMPORT_ENCRYPTED_UNSUPPORTED');
      total+=view.getUint32(at+24,true);if(total>LIMITS.expandedBytes)fail('IMPORT_EXPANDED_SIZE_LIMIT');
      const size=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true);
      const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+size));
      if(/vba|externalLinks|macrosheet|\.\.\//i.test(name))fail('IMPORT_ACTIVE_CONTENT_UNSUPPORTED');
      at+=46+size+extra+comment;
    }
  }
  return Object.freeze({LIMITS,checkFileSize,checkJsonBudget,checkValue,checkWorkbook,zipPreflight});
});
