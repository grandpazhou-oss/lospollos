(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./network-contract-v18.js'):root.STCTV18?.networkContract,typeof module==='object'&&module.exports?require('./vendor/xlsx/xlsx.full.min.js'):root.XLSX,typeof module==='object'&&module.exports?require('./platform-settings-v19.js'):root.STCTPlatformV19?.settingsRegistry,typeof module==='object'&&module.exports?require('./import-budget-v19.js'):root.STCTImportBudget);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document){const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};ns.importSession=api;ns.tabularIntake=api.tabularIntake;ns.businessNumber=api.businessNumber;}
})(globalThis,function(Contract,XLSX,Settings,Budget){
  'use strict';
  // Shared bounded intake and presentation helpers. These never change the model.
  const Intake=(function(){
  const text=value=>String(value??'').trim();
  const normalized=value=>text(value).toLowerCase().replace(/[\s_\-（）()]/g,'');
  function period(value){
    // A period is a column/cell value, not a date range embedded in a report title.
    const s=text(value).replace(/\s*[（(]?\s*(?:m³|m3|kg|t|吨|立方数|立方米|体积|volume|weight|箱数|箱|boxes|box|cases|case)\s*[)）]?\s*$/i,'').trim();
    const match=s.match(/^(20\d{2})\s*[-/.年]\s*(0?[1-9]|1[0-2])月?$/)||s.match(/^(20\d{2})(0[1-9]|1[0-2])$/);
    if(match)return `${match[1]}-${match[2].padStart(2,'0')}`;
    const named=s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-/.]?\s*(20\d{2})$/i);
    if(named)return `${named[2]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[1].toLowerCase())+1).padStart(2,'0')}`;
    return null;
  }
  function quantity(value){
    const s=normalized(value);
    if(/m³|m3|立方|体积|volume/.test(s))return {measure:'volume',unit:'m3'};
    if(/公斤|千克|kg/.test(s))return {measure:'weight',unit:'kg'};
    if(/吨|tonne|ton(?:s)?(?:$|\/)|\(t\)|（t）/.test(text(value).toLowerCase()))return {measure:'weight',unit:'t'};
    if(/箱|box|case/.test(s))return {measure:'boxes',unit:'boxes'};
    return {measure:'quantity',unit:''};
  }
  const aliases={
    demandId:/^(demandid|需求编号|业务编号|序号|编号|id|number)$/i,
    customerNodeId:/^(customernodeid|customerid|customernumber|客户编号|客户代码|送货地编号)$/i,
    customerName:/^(customername|customer|客户名称|客户|送货地名称|送货地|代理商|代理商名称|名称)$/i,
    customerAddress:/^(customeraddress|address|客户地址|送货地址|配送地址|地址)$/i,
    currentSiteId:/^(currentsiteid|depot|depotid|warehouse|dc|仓库|仓库编号|归属仓库|所属仓|当前仓库)$/i,
    coordinate:/^(coordinate|coordinates|coord|经纬度|坐标)(?:近似[，,]?)?(?:经度[,，]纬度)?$/i,
    longitude:/^(longitude|lon|lng|经度)$/i,latitude:/^(latitude|lat|纬度)$/i,
    nodeId:/^(nodeid|nodecode|节点编号|节点代码|id|code|编号|代码)$/i,
    name:/^(name|nodename|节点名称|名称|仓库名称|工厂名称|dc)$/i,
    role:/^(role|noderole|节点角色|角色|类型)$/i,address:/^(address|地址)$/i,
    flowId:/^(flowid|流水号|货流编号|id|编号|序号)$/i,
    fromNodeId:/^(fromnodeid|from|source|来源|供应商|供应商编号|工厂|入库工场由来|出发地)$/i,
    toNodeId:/^(tonodeid|to|destination|到达|到达仓库|入库仓|dc|仓库|仓库编号)$/i,
    siteNodeId:/^(sitenodeid|siteid|depotid|仓库编号|归属仓库)$/i,
    period:/^(period|month|期间|月份|年月)$/i,
    quantity:/^(quantity|demand|物量|需求|需求量|数量|体积|volume|weight|重量)(?:m3|m³|kg|t|吨|箱)?$/i,
    unit:/^(unit|单位|物量单位)$/i,statedTotal:/^(statedtotal|total|合计|总计)$/i
  };
  function header(sheet){
    const candidates=(sheet?.rows||[]).slice(0,20).map(row=>{
      const score=row.values.reduce((sum,value)=>sum+(period(value)||/^(0?[1-9]|1[0-2])月$/.test(text(value))?2:Object.values(aliases).some(rx=>rx.test(normalized(value)))?2:0),0);
      return {rowNumber:row.rowNumber,values:row.values,score};
    });
    return candidates.reduce((best,row)=>row.score>best.score?row:best,{rowNumber:1,values:[],score:0});
  }
  function headerBand(sheet, rowNumbers){
    const first=header(sheet),selected=rowNumbers?.length?[...rowNumbers]:[first.rowNumber];
    if(!rowNumbers?.length){
      const next=sheet.rows.find(row=>row.rowNumber===first.rowNumber+1),cells=(next?.values||[]).filter(value=>text(value));
      if(cells.length&&cells.some(value=>quantity(value).unit)&&cells.every(value=>quantity(value).unit||Object.values(aliases).some(rx=>rx.test(normalized(value)))))selected.push(next.rowNumber);
    }
    const rows=selected.map(n=>sheet.rows.find(row=>row.rowNumber===n)).filter(Boolean);
    const years=[...new Set(sheet.rows.filter(row=>row.rowNumber<=Math.max(...selected)).flatMap(row=>row.values.flatMap(value=>[...text(value).matchAll(/\b(20\d{2})(?=年|[-/.]|\b)/g)].map(match=>match[1]))))];
    const year=years.length===1?years[0]:null;
    const columns=Array.from({length:sheet.columnCount||Math.max(0,...rows.map(row=>row.values.length))},(_,index)=>{
      const parts=rows.flatMap(row=>{
        // Do not repeat a sheet-wide title into the business column headings.
        if(row.values.filter(value=>text(value)).length===1&&row.values.length>1)return [];
        const merge=(sheet.merges||[]).find(m=>row.rowNumber>=m.startRow&&row.rowNumber<=m.endRow&&index+1>=m.startColumn&&index+1<=m.endColumn);
        const value=merge?sheet.rows.find(r=>r.rowNumber===merge.startRow)?.values[merge.startColumn-1]:row.values[index];
        return text(value)?[text(value)]:[];
      });
      const values=[...new Set(parts)],date=values.map(value=>period(value)||(year&&/^(0?[1-9]|1[0-2])月$/.test(value)?`${year}-${value.slice(0,-1).padStart(2,'0')}`:null)).find(Boolean);
      return {values,heading:values.join(' · '),period:date||null,...quantity(values.join(' '))};
    });
    return {rows:selected,columns,year};
  }
  function inferPeriodColumns(sheet,rowNumbers){
    return headerBand(sheet,rowNumbers).columns.flatMap((column,index)=>column.period?[{column:index+1,period:column.period,measure:column.measure,unit:column.unit}]:[]);
  }
  function mappingReview(sheet,block,keys,matchedBlock){
    const band=headerBand(sheet,block.headerRows),excluded=new Set((block.excludeRows||[]).map(row=>row.rowNumber));
    const rows=(sheet.rows||[]).filter(row=>row.rowNumber>=block.startRow&&row.rowNumber<=block.endRow&&!band.rows.includes(row.rowNumber)&&!excluded.has(row.rowNumber));
    return keys.map(key=>{
      const spec=block.fields?.[key],column=typeof spec==='number'?spec:spec?.column||0;
      const constant=spec!==undefined?spec&&typeof spec==='object'&&Object.hasOwn(spec,'constant')?spec.constant:undefined:block.constants?.[key];
      const candidates=band.columns.flatMap((item,index)=>aliases[key]&&item.values.some(value=>aliases[key].test(normalized(value)))?[index+1]:[]);
      const sameProfile=matchedBlock?.sheet===block.sheet&&spec!==undefined&&JSON.stringify(spec)===JSON.stringify(matchedBlock.fields?.[key]);
      const status=constant!==undefined?'CONSTANT':column?sameProfile?'PROFILE':candidates.length===1&&candidates[0]===column?'EXACT':'CHOSEN':candidates.length>1?'AMBIGUOUS':'UNMAPPED';
      const populated=column?rows.filter(row=>text(row.values[column-1])!==''):[];
      return {key,column,status,required:(block.requiredFields||[]).includes(key),heading:band.columns[column-1]?.heading||'',headerRows:band.rows,constant,
        candidates:candidates.map(value=>({column:value,heading:band.columns[value-1].heading})),
        samples:populated.slice(0,3).map(row=>({rowNumber:row.rowNumber,value:row.values[column-1]})),
        reviewedRows:rows.length,nonEmptyRows:populated.length,emptyRows:column?rows.length-populated.length:null,
        quantity:quantity(band.columns[column-1]?.heading||''),
        transforms:[...(spec?.prefix!==undefined?['PREFIX']:[]),...(spec?.fillDown?['FILL_DOWN']:[]),...(spec?.map?['LOOKUP']:[])]};
    });
  }
  function template(workbook){
    const blocks=(workbook.sheets||[]).filter(sheet=>sheet.rowCount>1).map(sheet=>{
      const head=header(sheet),band=headerBand(sheet),values=head.values.map(normalized),fields={};
      const has=key=>band.columns.some(column=>column.values.some(value=>aliases[key].test(normalized(value))));
      const periods=inferPeriodColumns(sheet,band.rows),hasQuantity=periods.length||has('period')&&has('quantity');
      const kind=has('role')?'NODE':has('fromNodeId')&&has('toNodeId')?'OBSERVED_INBOUND':hasQuantity?'PERIOD_DEMAND':has('name')&&has('address')?'NODE':'UNCONFIRMED';
      const keys=kind==='NODE'?['nodeId','name','role','address','coordinate','longitude','latitude']:kind==='OBSERVED_INBOUND'?['flowId','fromNodeId','toNodeId','period','quantity','unit','statedTotal']:['demandId','customerNodeId','customerName','customerAddress','currentSiteId','coordinate','longitude','latitude','period','quantity','unit','statedTotal'];
      const used=new Set(),suggestions={};
      for(const key of keys){const matches=band.columns.flatMap((column,i)=>!used.has(i)&&column.values.some(value=>aliases[key].test(normalized(value)))?[i]:[]);if(matches.length===1){fields[key]=matches[0]+1;used.add(matches[0]);suggestions[key]={status:'EXACT',columns:[matches[0]+1]};}else if(matches.length>1)suggestions[key]={status:'AMBIGUOUS',columns:matches.map(i=>i+1)};}
      const periodColumns=periods;
      const layout=!periodColumns.length&&fields.period&&fields.quantity?'LONG':'WIDE';
      const primaryMeasure=periodColumns.some(row=>row.measure==='volume')?'volume':periodColumns[0]?.measure||'quantity';
      const repeated=(sheet.rows||[]).filter(row=>row.rowNumber>head.rowNumber&&JSON.stringify(row.values.map(normalized))===JSON.stringify(values)).map(row=>({rowNumber:row.rowNumber,reasonCode:'REPEATED_HEADER'}));
      return {sheet:sheet.name,kind,layout,startRow:Math.max(...band.rows)+1,endRow:sheet.rowCount,headerRows:band.rows,excludeRows:repeated,nodeRole:kind==='NODE'?(band.columns.some(column=>column.values.some(value=>/^dc$|^仓库名称$/i.test(value)))?'DC':''):'CUSTOMER',primaryMeasure,recordUnit:fields.quantity?quantity(band.columns[fields.quantity-1].heading).unit:'',fields,suggestions,periodColumns,requiredFields:kind==='NODE'?['name']:kind==='OBSERVED_INBOUND'?['flowId','fromNodeId','toNodeId']:kind==='PERIOD_DEMAND'?['demandId','customerName']:[]};
    });
    return {schemaVersion:'stct-supply-chain-import-profile-v19',profileId:`MAPPING-${Date.now()}`,name:workbook.fileName,blocks};
  }
  const publicFields={
    orders:{orderId:['orderId','订单编号','订单号','业务编号'],customerName:['customerName','客户名称','客户'],address:['address','地址','送货地址'], 'coordinate.0':['longitude','lng','lon','经度'],'coordinate.1':['latitude','lat','纬度'],coordinate:['coordinate','经纬度','坐标'],'demand.volume':['demand.volume','volume','体积','物量'],'demand.weight':['demand.weight','weight','重量'],'timeWindow.start':['timeWindow.start','开始时间'],'timeWindow.end':['timeWindow.end','结束时间'],serviceDuration:['serviceDuration','服务分钟']},
    depots:{depotId:['depotId','仓库编号','仓库代码'],name:['name','仓库名称','名称'],address:['address','地址'],'coordinate.0':['longitude','经度'],'coordinate.1':['latitude','纬度'],coordinate:['coordinate','经纬度','坐标'],fixedOperatingCost:['fixedOperatingCost','固定运营费用'],variableHandlingCost:['variableHandlingCost','处理费率']},
    candidateSites:{siteId:['siteId','节点编号','候选仓编号'],name:['name','名称','仓库名称'],'coordinate.0':['longitude','经度'],'coordinate.1':['latitude','纬度'],coordinate:['coordinate','经纬度'],fixedCost:['fixedCost','固定费用'],capacity:['capacity','容量']},
    vehicles:{vehicleId:['vehicleId','车辆编号','车牌号'],'capacity.volume':['capacity.volume','容积','最大容积'],'capacity.weight':['capacity.weight','载重','最大载重'],vehicleTypeId:['vehicleTypeId','车型编号'],homeDepotId:['homeDepotId','所属仓库']}
  };
  publicFields.facilityDemands={demandId:['demandId','需求编号'],name:['name','需求名称'],coordinate:['coordinate','经纬度'],'coordinate.0':['longitude','经度'],'coordinate.1':['latitude','纬度'],'demand.volume':['volume','体积','物量'],'demand.quantity':['quantity','数量']};
  publicFields.facilitySites={siteId:['siteId','候选仓编号'],name:['name','仓库名称'],coordinate:['coordinate','经纬度'],'coordinate.0':['longitude','经度'],'coordinate.1':['latitude','纬度'],fixedCost:['fixedCost','固定费用'],handlingCostPerUnit:['handlingCostPerUnit','处理费率'],'capacity.volume':['capacity.volume','处理能力'],status:['status','状态']};
  const kindAliases={facilityDemands:['facilityDemands','需求点','需求点表'],facilitySites:['facilitySites','候选仓库','候选仓库表'],orders:['orders','订单','订单表','送货订单'],depots:['depots','仓库','仓库表'],candidateSites:['candidateSites','候选仓','候选节点'],vehicles:['vehicles','车辆','车辆表']};
  function publicKind(name,headers){
    for(const [kind,names]of Object.entries(kindAliases))if(names.map(normalized).includes(normalized(name)))return kind;
    const scored=Object.entries(publicFields).map(([kind,fields])=>[kind,Object.values(fields).filter(names=>headers.some(h=>names.map(normalized).includes(normalized(h)))).length]);
    scored.sort((a,b)=>b[1]-a[1]);return scored[0]?.[1]>=2&&scored[0][1]>scored[1][1]?scored[0][0]:name;
  }
  function publicMapping(kind,headers){
    return Object.fromEntries(headers.map(value=>{const h=normalized(value),found=Object.entries(publicFields[kind]||{}).find(([key,names])=>names.map(normalized).includes(h));return [value,found?.[0]||(/^[a-z][a-z0-9.]*$/i.test(value)?value:'')];}));
  }
  function suggest(workbook){
    const heads=workbook.sheets.map(header);
    if(workbook.sheets.some(sheet=>inferPeriodColumns(sheet).length)||heads.some(h=>h.values.some(period)||h.values.some(v=>aliases.period.test(normalized(v)))&&h.values.some(v=>aliases.quantity.test(normalized(v)))))return 'SUPPLY_CHAIN_PERIOD';
    if(heads.some(h=>h.values.some(v=>/fixedcost|固定费用/.test(normalized(v))))&&heads.some(h=>h.values.some(v=>/demandid|需求编号/.test(normalized(v)))))return 'FACILITY';
    if(heads.some(h=>h.values.some(v=>/orderid|订单号|订单编号/i.test(normalized(v)))))return 'NETWORK_ORDERS';
    return null;
  }
  function csvDelimiter(textValue){
    const line=String(textValue).split(/\r?\n/).filter(line=>line.trim()).slice(0,10).join('\n');
    const counts={',':0,';':0,'\t':0};let quoted=false;
    for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&Object.hasOwn(counts,c))counts[c]++;}
    return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  }
  return Object.freeze({period,quantity,header,headerBand,periodColumns:inferPeriodColumns,mappingReview,template,publicFields,publicKind,publicMapping,suggest,csvDelimiter});
})();
  const Display=(function(){
  const finite=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
  function number(value,locale='zh-CN',digits=1){
    if(!finite(value))return '—';
    const n=Number(value),threshold=10**-digits;
    if(n!==0&&Math.abs(n)<threshold)return `${n<0?'−':''}<${threshold.toFixed(digits)}`;
    return n.toLocaleString(locale,{maximumFractionDigits:digits});
  }
  function percent(value,locale='zh-CN'){
    if(!finite(value))return '—';
    const n=Number(value)*100;
    if(n>0&&n<100&&Math.round(n*10)>=1000)return '<100%';
    if(n>100&&Math.round(n*10)<=1000)return '>100%';
    return `${number(n,locale)}%`;
  }
  function exact(value){return finite(value)?String(value).trim():'—';}
  function filename(name,kind,extension){
    const safe=String(name||'study').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,70)||'study';
    return `${safe}_${kind}.${extension}`;
  }
  return Object.freeze({number,percent,exact,filename});
})();
  const LIMITS=Budget.LIMITS;
  const INPUT_KINDS=Object.freeze({RAW:'RAW_SOURCE_IMPORT',CANONICAL:'CANONICAL_DATASET_EXPORT',PORTABLE:'PORTABLE_STUDY_PACKAGE'});
    const IDS=Object.freeze({orders:'orderId',depots:'depotId',candidateSites:'siteId',costParameters:'costKey',vehicles:'vehicleId',vehicleTypes:'vehicleTypeId',drivers:'driverId',docks:'dockId',zones:'zoneId',waves:'waveId'});
  const clone=value=>structuredClone(value);
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  function safe(value,depth=0){
    if(depth>LIMITS.depth)fail('IMPORT_DEPTH_LIMIT');
    if(typeof value==='string'&&(value.length>LIMITS.string||/<script\b|javascript:/i.test(value)))fail('IMPORT_UNSAFE_STRING');
    if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))fail('IMPORT_UNSAFE_KEY');safe(child,depth+1);}
    return value;
  }
  function parseJson(text,maxBytes=LIMITS.expandedBytes){
    if(text.length>maxBytes)fail('IMPORT_SIZE_LIMIT');
    let depth=0,quoted=false,escape=false;
    for(const char of text){if(quoted){if(escape)escape=false;else if(char==='\\')escape=true;else if(char==='"')quoted=false;}else if(char==='"')quoted=true;else if(char==='{'||char==='['){if(++depth>LIMITS.depth)fail('IMPORT_DEPTH_LIMIT');}else if(char==='}'||char===']')depth--;}
    return safe(JSON.parse(text.replace(/^\uFEFF/,'')));
  }
  async function readFiles(files,options={}){
    if(options.csvDelimiter!==undefined&&![',',';','\t'].includes(options.csvDelimiter))fail('IMPORT_DELIMITER_INVALID');
    const started=performance.now();
    let fileReadMs=0;
    if(!files.length||files.length>LIMITS.sheets)fail('IMPORT_FILE_COUNT');
    const tables=[],sources=[];let inputKind=INPUT_KINDS.RAW,canonicalContext=null;
    for(const file of files){
      Budget.checkFileSize(file);
      const extension=file.name.split('.').pop().toLowerCase();if(!['xlsx','csv','json'].includes(extension))fail('IMPORT_FORMAT_UNSUPPORTED');
      const readStarted=performance.now(),bytes=new Uint8Array(await file.arrayBuffer());fileReadMs+=performance.now()-readStarted;
      const rawFileHash='sha256:'+Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      sources.push({fileName:file.name,rawFileHash,origin:'FILE_UPLOAD',originalBytesStored:false});
      if(extension==='json'){
        const payload=parseJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(payload?.schemaVersion==='stct-study-package-p5'||payload?.schemaVersion==='stct-study-package-p6')fail('IMPORT_PORTABLE_PACKAGE_USE_STUDY_IMPORT');
        if(!payload||!payload.scenario)fail('IMPORT_JSON_SCHEMA_REQUIRED');
        if(payload.schemaVersion==='stct-dataset-export-p5.1'){
          if(files.length!==1||inputKind!==INPUT_KINDS.RAW)fail('IMPORT_CANONICAL_EXPORT_MUST_BE_SINGLE_FILE');
          if(payload.canonicalUnits?.weight!=='kg'||payload.canonicalUnits?.volume!=='m3'||!payload.canonicalDataHash)fail('IMPORT_CANONICAL_CONTEXT_INVALID');
          inputKind=INPUT_KINDS.CANONICAL;
          canonicalContext={canonicalDataHash:String(payload.canonicalDataHash),canonicalUnits:clone(payload.canonicalUnits),sourceUnits:clone(payload.sourceUnits||{}),conversionLedger:clone(payload.conversionLedger||[]),datasetVersionId:String(payload.datasetVersionId||'')};
          sources.at(-1).origin='CANONICAL_DATASET_EXPORT';
        }else if(payload.schemaVersion&&!['stct-network-fixture-v1.9-p5','stct-network-upload-p5'].includes(payload.schemaVersion))fail('IMPORT_JSON_SCHEMA_UNSUPPORTED');
        for(const [kind,records]of Object.entries(payload.scenario))if(Array.isArray(records)&&IDS[kind])tables.push({fileName:file.name,sheet:kind,kind,records:clone(records),headers:[...new Set(records.flatMap(Object.keys))],formulaRows:[]});
        tables.push({fileName:file.name,sheet:'context',kind:'context',records:[Object.fromEntries(Object.entries(payload.scenario).filter(([key])=>!IDS[key]))],headers:[],formulaRows:[]});
        continue;
      }
      let workbook;
      if(extension==='xlsx'){Budget.zipPreflight(bytes);workbook=XLSX.read(bytes,{type:'array',cellFormula:true,cellHTML:false,bookVBA:false});}
      else {let csv;try{csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch(error){fail('IMPORT_UTF8_INVALID');}workbook=XLSX.read(csv,{type:'string',raw:true,FS:options.csvDelimiter??Intake.csvDelimiter(csv),cellFormula:true});}
      Budget.checkWorkbook(workbook,XLSX);
      for(const sheet of workbook.SheetNames){
        const ws=workbook.Sheets[sheet];if(!ws['!ref'])continue;
        const range=XLSX.utils.decode_range(ws['!ref']);if(range.e.r>=LIMITS.rows||range.e.c>=LIMITS.columns)fail('IMPORT_TABLE_LIMIT');
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:true});
        const found=Intake.header({rows:rows.map((values,i)=>({rowNumber:range.s.r+i+1,values}))}),headerRow=found.score>=2?found.rowNumber:range.s.r+1;
        rows.splice(0,headerRow-range.s.r);
        const headers=(found.score>=2?found.values:XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:true})[0]||[]).map(String);if(new Set(headers).size!==headers.length)fail('IMPORT_DUPLICATE_HEADERS');
        const records=rows.map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]??''])));
        const formulaRows=Object.keys(ws).filter(key=>!key.startsWith('!')&&ws[key].f).map(key=>({row:XLSX.utils.decode_cell(key).r+1,field:headers[XLSX.utils.decode_cell(key).c]}));
        const kind=Intake.publicKind(extension==='csv'?file.name.replace(/\.csv$/i,''):sheet,headers);
        tables.push({fileName:file.name,sheet,kind,records,headers,formulaRows,headerRow,rowNumbers:rows.map((_,i)=>headerRow+i+1),...(extension==='csv'?{csvDelimiter:options.csvDelimiter??Intake.csvDelimiter(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}:{})});
      }
    }
    if(tables.some(table=>table.records.length>LIMITS.rows))fail('IMPORT_ROW_LIMIT');
    return {schemaVersion:'stct-import-session-p5.1',inputKind,canonicalContext,sources,tables:safe(tables),mapping:Object.fromEntries(tables.map((table,i)=>[i,Intake.publicMapping(table.kind,table.headers)])),revision:1,performance:{fileReadMs,parseMs:performance.now()-started-fileReadMs,fileBytes:files.reduce((sum,file)=>sum+file.size,0),evidenceClass:'MEASURED'}};
  }
  function decodeCell(value){if(typeof value!=='string')return value;const text=value.trim();return text.startsWith('{')||text.startsWith('[')?parseJson(text):value;}
  function setField(record,field,value){
    const keys=field.split('.');if(keys.some(key=>['__proto__','constructor','prototype'].includes(key)))fail('IMPORT_UNSAFE_KEY');
    let parent=record;keys.slice(0,-1).forEach((key,index)=>{if(!parent[key])parent[key]=/^\d+$/.test(keys[index+1])?[]:{};parent=parent[key];});
    const last=keys.at(-1);
    const numeric=['fixedOperatingCost','variableHandlingCost','fixedCost','handlingCostPerUnit','carbonFactor','simultaneousCapacity','loadRate','unloadRate','fixedSetupMinutes','maxTrips','maxDrivingMinutes','maxDutyMinutes','serviceDuration','priorityWeight','amount'];
    const boolean=['reloadSupported','transferSupported','preferredDepotException'];
    if(boolean.includes(field)&&typeof value==='string'&&/^(true|false)$/i.test(value.trim()))parent[last]=value.trim().toLowerCase()==='true';
    else parent[last]=(numeric.includes(field)||['coordinate','demand','capacity','cost'].includes(keys[0])&&keys.length>1)&&value!==''?Number(value):decodeCell(value);
  }
  function validate(session,settings){
    const started=performance.now();
    if(!['DESIGN','COMMAND','SHARED_REFERENCE'].includes(settings.scope))fail('IMPORT_SCOPE_REQUIRED');
    if(settings.coordinateSystem!=='WGS84')fail('IMPORT_WGS84_CONFIRMATION_REQUIRED');
    if(!['kg','tonne'].includes(settings.weightUnit)||!['m3','litre'].includes(settings.volumeUnit))fail('IMPORT_UNIT_REQUIRED');
    if(!settings.observationPeriod||!settings.costPeriod||!settings.currency||!settings.classification)fail('IMPORT_CONTEXT_REQUIRED');
    const canonicalInput=session.inputKind===INPUT_KINDS.CANONICAL;
    if(canonicalInput&&(!session.canonicalContext||session.canonicalContext.canonicalUnits?.weight!=='kg'||session.canonicalContext.canonicalUnits?.volume!=='m3'))fail('IMPORT_CANONICAL_CONTEXT_INVALID');
    const scenario={},issues=[],rows=[],conversionLedger=canonicalInput?clone(session.canonicalContext.conversionLedger||[]):[];
    const add=(row,field,code)=>issues.push({code,file:row.fileName,sheet:row.sheet,row:row.row,field,rowKey:row.key,scope:settings.scope});
    session.tables.forEach((table,index)=>{
      const kind=table.kind;if(!IDS[kind]&&kind!=='context'){issues.push({code:'IMPORT_KIND_UNMAPPED',file:table.fileName,sheet:table.sheet,row:1,field:'kind',scope:settings.scope});return;}
      table.records.forEach((raw,j)=>{
        const row={fileName:table.fileName,sheet:table.sheet,row:table.rowNumbers?.[j]||j+2,key:`${index}:${j}`,kind,record:{}};rows.push(row);
        try{for(const [header,value]of Object.entries(raw)){const field=Object.hasOwn(session.mapping[index]||{},header)?session.mapping[index][header]:header;if(!field)continue;setField(row.record,field,value);}safe(row.record);}catch(e){add(row,'record',e.code||'IMPORT_CELL_JSON_INVALID');}
        if(table.formulaRows.some(item=>item.row===row.row))add(row,'formula','IMPORT_FORMULA_UNSUPPORTED');
        if(kind==='context'){Object.assign(scenario,row.record);return;}
        const idField=IDS[kind];if(row.record[idField]===undefined||row.record[idField]==='')add(row,idField,'IMPORT_ID_REQUIRED');else row.record[idField]=String(row.record[idField]);
        if(['orders','depots','candidateSites'].includes(kind)){const c=row.record.coordinate;if(!Array.isArray(c)||c.length!==2||!c.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(c[0])>180||Math.abs(c[1])>90)add(row,'coordinate','IMPORT_COORDINATE_INVALID');}
        if(kind==='orders'&&row.record.demand?.volume===undefined)add(row,'demand.volume','IMPORT_VOLUME_REQUIRED');
        if(['vehicles','vehicleTypes'].includes(kind)&&row.record.capacity?.volume===undefined)add(row,'capacity.volume','IMPORT_CAPACITY_REQUIRED');
        for(const [field,value]of Object.entries(row.record.cost||{}))if(value===''||!Number.isFinite(Number(value))||Number(value)<0)add(row,`cost.${field}`,'IMPORT_COST_INVALID');
        for(const field of ['fixedOperatingCost','variableHandlingCost'])if(row.record[field]!==undefined&&(!Number.isFinite(Number(row.record[field]))||Number(row.record[field])<0))add(row,field,'IMPORT_COST_INVALID');
        for(const field of ['demand','capacity'])if(row.record[field])for(const dimension of ['weight','volume']){
          if(row.record[field][dimension]===undefined)continue;
          const rawValue=row.record[field][dimension];const value=Number(rawValue);if(rawValue===''||rawValue===null||!Number.isFinite(value)||value<0){add(row,`${field}.${dimension}`,'IMPORT_NEGATIVE_OR_INVALID_QUANTITY');continue;}
          const unit=canonicalInput?(dimension==='weight'?'kg':'m3'):(dimension==='weight'?settings.weightUnit:settings.volumeUnit);const factor=canonicalInput?1:unit==='tonne'?1000:unit==='litre'?.001:1;
          row.record[field][dimension]=Math.round(value*factor*1e6)/1e6;
          if(!canonicalInput)conversionLedger.push({rowKey:row.key,field:`${field}.${dimension}`,sourceValue:value,sourceUnit:unit,factor,normalizedValue:row.record[field][dimension],targetUnit:dimension==='weight'?'kg':'m3'});
        }
        (scenario[kind]=scenario[kind]||[]).push(row.record);
      });
    });
    for(const [kind,idField]of Object.entries(IDS)){
      const seen=new Set();for(const row of rows.filter(row=>row.kind===kind)){const id=row.record[idField];if(seen.has(id))add(row,idField,'IMPORT_DUPLICATE_ID');seen.add(id);}
    }
    const known=kind=>new Set((scenario[kind]||[]).map(row=>row[IDS[kind]]));
    const depots=known('depots'),types=known('vehicleTypes');
    for(const row of rows){
      for(const field of ['allowedDepotIds','forbiddenDepotIds','allowedStartDepotIds','allowedEndDepotIds'])for(const id of row.record[field]||[])if(!depots.has(id))add(row,field,'IMPORT_UNKNOWN_DEPOT');
      for(const field of ['homeDepotId','depotId','preferredDepotId','fixedDepotId'])if(row.record[field]&&!depots.has(row.record[field]))add(row,field,'IMPORT_UNKNOWN_DEPOT');
      if(row.record.vehicleTypeId&&!types.has(row.record.vehicleTypeId))add(row,'vehicleTypeId','IMPORT_UNKNOWN_VEHICLE_TYPE');
    }
    const excluded=new Set(settings.excludedRows||[]);
    const badRows=new Set(issues.map(issue=>issue.rowKey).filter(Boolean));
    if(excluded.size&&!settings.confirmExclusion)fail('IMPORT_EXCLUSION_CONFIRMATION_REQUIRED');
    for(const key of excluded)if(!badRows.has(key))fail('IMPORT_EXCLUSION_UNKNOWN_ROW');
    const acceptedRows=rows.filter(row=>!excluded.has(row.key));
    for(const [kind]of Object.entries(IDS))if(scenario[kind])scenario[kind]=acceptedRows.filter(row=>row.kind===kind).map(row=>row.record);
    if(scenario.costParameters?.length){
      try{
        const costs=scenario.costParameters;
        if(costs.some(row=>!row.basis||!row.period||!row.currency))fail('COST_BASIS_PERIOD_CURRENCY_REQUIRED');
        if(costs.some(row=>row.currency!==settings.currency))fail('MIXED_CURRENCY_BLOCKED');
        const rule=settings.normalizationTarget==='YEAR'?{target:'YEAR',monthlyPeriodsPerYear:12,annualBusinessDays:Number(settings.annualBusinessDays)}:{};
        if(rule.target&&!settings.confirmNormalization)fail('COST_NORMALIZATION_CONFIRMATION_REQUIRED');
        const converted=Settings.normalizePeriods(costs,rule);
        scenario.assumptions={...scenario.assumptions,preparedCostContext:{...converted,aggregationBoundary:'SOURCE_COST_PARAMETERS_ONLY_NOT_ADDED_TO_ROUTE_LEDGER',modelEstimate:true}};
        conversionLedger.push(...converted.rows.map(row=>({costKey:row.costKey,sourceAmount:row.sourceAmount,sourcePeriod:row.sourcePeriod,amount:row.amount,period:row.period,factor:row.factor,normalizationHash:row.normalizationHash})));
      }catch(error){issues.push({code:error.code||'COST_CONTEXT_INVALID',field:'costParameters',scope:settings.scope});}
    }
    const missing=['orders','depots','vehicles','vehicleTypes','drivers','docks'].filter(kind=>!scenario[kind]?.length);
    if(scenario.vehicleTypes?.some(type=>!type.cost||!['fixed','trip','perKm','perMinute'].every(key=>Number.isFinite(Number(type.cost[key])))))missing.push('costParameters');
    scenario.dataClassification=settings.classification;
    scenario.assumptions={...scenario.assumptions,observationPeriod:settings.observationPeriod,costPeriod:settings.costPeriod,currency:settings.currency,accountingOptions:{...scenario.assumptions?.accountingOptions,currency:settings.currency},units:{weight:'kg',volume:'m3'}};
    const mappingValidationMs=performance.now()-started,canonicalStarted=performance.now();
    let normalized=null;
    if(!missing.length&&!issues.some(issue=>!excluded.has(issue.rowKey))){try{const network=clone(scenario);delete network.candidateSites;delete network.costParameters;normalized=Contract.normalizeScenario(network);}catch(e){issues.push({code:e.code||'IMPORT_CANONICAL_INVALID',message:e.message,field:e.field||'scenario',scope:settings.scope});}}
    const blocking=issues.filter(issue=>!excluded.has(issue.rowKey));
    const canonicalDataHash=blocking.length?null:Contract.hashArtifact({network:normalized||scenario,candidateSites:scenario.candidateSites||[],costParameters:scenario.costParameters||[]});
    if(canonicalInput&&canonicalDataHash!==null&&canonicalDataHash!==session.canonicalContext.canonicalDataHash){issues.push({code:'IMPORT_CANONICAL_HASH_MISMATCH',field:'canonicalDataHash',scope:settings.scope});}
    const finalBlocking=issues.filter(issue=>!excluded.has(issue.rowKey));
    return {schemaVersion:'stct-import-validation-p5.1',inputKind:session.inputKind||INPUT_KINDS.RAW,sourceUnitContext:canonicalInput?clone(session.canonicalContext.sourceUnits):{weight:settings.weightUnit,volume:settings.volumeUnit},canonicalUnits:{weight:'kg',volume:'m3'},status:finalBlocking.length?'BLOCKED':missing.length?'DATA_ONLY_SAVED':'READY',missingRequiredInput:missing,issues,totalRecords:rows.length,acceptedRecords:acceptedRows.length,rejectedRecords:excluded.size,rejectedRows:rows.filter(row=>excluded.has(row.key)),records:scenario,normalizedScenario:normalized,mappingHash:Contract.hashArtifact(session.mapping),unitContextHash:Contract.hashArtifact({canonicalUnits:{weight:'kg',volume:'m3'},sourceUnits:canonicalInput?session.canonicalContext.sourceUnits:{weight:settings.weightUnit,volume:settings.volumeUnit}}),canonicalDataHash,networkInputHash:normalized?Contract.identityBundle(normalized).networkInputHash:null,conversionLedger,settings:{...clone(settings),weightUnit:canonicalInput?'kg':settings.weightUnit,volumeUnit:canonicalInput?'m3':settings.volumeUnit},source:clone(session.sources),validationRevision:session.revision,performance:{...session.performance,mappingValidationMs,canonicalizationMs:performance.now()-canonicalStarted,normalizeValidateMs:performance.now()-started,evidenceClass:'MEASURED'}};
  }
  function facilityStudy(session,settings){
    if(!settings.confirmed||settings.coordinateSystem!=='WGS84')fail('FACILITY_ASSUMPTION_CONFIRM_REQUIRED');
    if(!settings.observationPeriod||!settings.currency||!settings.costPeriod||!['volume','quantity'].includes(settings.basis)||settings.basis==='volume'&&settings.volumeUnit!=='m3')fail('FACILITY_IMPORT_CONTEXT_REQUIRED');
    if(settings.observationPeriod!==settings.costPeriod)fail('FACILITY_PERIOD_CONVERSION_UNSUPPORTED');
    const scalar=(value,field,source)=>{if(value==null||typeof value==='string'&&value.trim()===''||!['number','string'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<0)throw Object.assign(new Error('FACILITY_IMPORT_VALUE_INVALID'),{code:'FACILITY_IMPORT_VALUE_INVALID',detail:{...source,field}});return Number(value);};
    const demands=[],sites=[],sourceRows=[],excludedRows=[];
    session.tables.forEach((table,index)=>{
      if(!['facilityDemands','facilitySites'].includes(table.kind))fail('FACILITY_IMPORT_TABLE_KIND_REQUIRED');
      table.records.forEach((raw,j)=>{
        const source={fileName:table.fileName,sheet:table.sheet,rowNumber:table.rowNumbers?.[j]||j+2,rawValues:clone(raw)},value={};sourceRows.push(source);
        if(Object.values(raw).every(v=>v==null||String(v).trim()==='')){excludedRows.push({...source,reasonCode:'EMPTY_ROW'});return;}
        if(table.formulaRows.some(cell=>cell.row===source.rowNumber))fail('IMPORT_FORMULA_UNSUPPORTED');
        for(const [header,cell]of Object.entries(raw)){
          const field=session.mapping[index]?.[header];if(!field)continue;
          const numeric=/^(coordinate\.[01]|demand\.(volume|quantity)|capacity\.volume|fixedCost|handlingCostPerUnit)$/.test(field);
          const missing=cell==null||typeof cell==='string'&&cell.trim()==='';
          if(field==='capacity.volume'&&missing)continue;
          // Validate raw numeric cells before the legacy mapper can coerce blanks/booleans to zero.
          setField(value,field,numeric&&(missing||!['number','string'].includes(typeof cell))?NaN:cell);
        }
        const coords=value.coordinate;
        if(!Array.isArray(coords)||coords.length!==2||!coords.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(coords[0])>180||Math.abs(coords[1])>90)throw Object.assign(new Error('FACILITY_IMPORT_COORDINATE_INVALID'),{code:'FACILITY_IMPORT_COORDINATE_INVALID',detail:source});
        if(table.kind==='facilityDemands'){
          if(!value.demandId)fail('FACILITY_DEMAND_ID_REQUIRED');
          const q=scalar(value.demand?.[settings.basis],`demand.${settings.basis}`,source);
          demands.push({demandId:String(value.demandId),name:String(value.name||value.demandId),coordinate:coords,demand:{[settings.basis]:q},source});
        }else{
          if(!value.siteId)fail('FACILITY_SITE_ID_REQUIRED');
          const capacity=value.capacity?.volume;
          sites.push({siteId:String(value.siteId),name:String(value.name||value.siteId),coordinate:coords,fixedCost:scalar(value.fixedCost,'fixedCost',source),handlingCostPerUnit:scalar(value.handlingCostPerUnit,'handlingCostPerUnit',source),capacity:capacity==null||capacity===''?{}:{volume:scalar(capacity,'capacity.volume',source)},status:String(value.status||'OPTIONAL'),source});
        }
      });
    });
    if(!demands.length||!sites.length)fail('FACILITY_DEMAND_AND_CANDIDATES_REQUIRED');
    const count=scalar(settings.siteCount,'siteCount',{});if(!Number.isInteger(count)||count<1||count>sites.length)fail('FACILITY_COUNTS_INVALID');
    return {studyId:`FACILITY-${globalThis.crypto.randomUUID()}`,name:session.sources[0]?.fileName.replace(/\.[^.]+$/,''),coordinateSystem:'WGS84',dataClassification:settings.classification,observationPeriod:settings.observationPeriod,demands,sites,options:{transportBasis:settings.basis,transportCostPerUnitKm:scalar(settings.transportRate,'transportRate',{}),currency:settings.currency,costPeriod:settings.costPeriod,facilityCounts:[count]},sourceRefs:[{kind:'MAPPED_TABULAR_INPUT',files:clone(session.sources),mapping:clone(session.mapping),sourceRows,excludedRows}],assumptions:{distanceMode:'ESTIMATED_GEODESIC',factor:1,speedKph:32,coordinateConfirmation:'USER_CONFIRMED_WGS84',screeningOnly:true,travelTimeAssumption:'32 km/h screening only; SLA unverified',unselectedDemandDimensions:'NOT_APPLICABLE_TO_SELECTED_BASIS'}};
  }
  return Object.freeze({tabularIntake:Intake,businessNumber:Display,facilityStudy,LIMITS,IDS,INPUT_KINDS,safe,parseJson,zipPreflight:Budget.zipPreflight,readFiles,validate});
});
