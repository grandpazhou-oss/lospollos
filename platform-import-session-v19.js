(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./network-contract-v18.js'):root.STCTV18?.networkContract,typeof module==='object'&&module.exports?require('./vendor/xlsx/xlsx.full.min.js'):root.XLSX,typeof module==='object'&&module.exports?require('./platform-settings-v19.js'):root.STCTPlatformV19?.settingsRegistry);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)(root.STCTPlatformV19=root.STCTPlatformV19||{}).importSession=api;
})(globalThis,function(Contract,XLSX,Settings){
  'use strict';
  const LIMITS=Object.freeze({fileBytes:8*1024*1024,expandedBytes:48*1024*1024,rows:10000,columns:100,depth:30,string:100000,sheets:24});
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
  async function readFiles(files){
    const started=performance.now();
    let fileReadMs=0;
    if(!files.length||files.length>LIMITS.sheets)fail('IMPORT_FILE_COUNT');
    const tables=[],sources=[];let inputKind=INPUT_KINDS.RAW,canonicalContext=null;
    for(const file of files){
      if(file.size>LIMITS.fileBytes)fail('IMPORT_FILE_TOO_LARGE');
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
      if(extension==='xlsx'){zipPreflight(bytes);workbook=XLSX.read(bytes,{type:'array',cellFormula:true,cellHTML:false,bookVBA:false});}
      else workbook=XLSX.read(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''),{type:'string',raw:true,FS:',',cellFormula:true});
      if(workbook.SheetNames.length>LIMITS.sheets)fail('IMPORT_SHEET_LIMIT');
      for(const sheet of workbook.SheetNames){
        const ws=workbook.Sheets[sheet];if(!ws['!ref'])continue;
        const range=XLSX.utils.decode_range(ws['!ref']);if(range.e.r>=LIMITS.rows||range.e.c>=LIMITS.columns)fail('IMPORT_TABLE_LIMIT');
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:true});
        const headers=(rows.shift()||[]).map(String);if(new Set(headers).size!==headers.length)fail('IMPORT_DUPLICATE_HEADERS');
        const records=rows.map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]??''])));
        const formulaRows=Object.keys(ws).filter(key=>!key.startsWith('!')&&ws[key].f).map(key=>({row:XLSX.utils.decode_cell(key).r+1,field:headers[XLSX.utils.decode_cell(key).c]}));
        const kind=extension==='csv'?file.name.replace(/\.csv$/i,''):sheet;
        tables.push({fileName:file.name,sheet,kind,records,headers,formulaRows});
      }
    }
    if(tables.some(table=>table.records.length>LIMITS.rows))fail('IMPORT_ROW_LIMIT');
    return {schemaVersion:'stct-import-session-p5.1',inputKind,canonicalContext,sources,tables:safe(tables),mapping:Object.fromEntries(tables.map((table,i)=>[i,Object.fromEntries(table.headers.map(header=>[header,header]))])),revision:1,performance:{fileReadMs,parseMs:performance.now()-started-fileReadMs,fileBytes:files.reduce((sum,file)=>sum+file.size,0),evidenceClass:'MEASURED'}};
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
        const row={fileName:table.fileName,sheet:table.sheet,row:j+2,key:`${index}:${j}`,kind,record:{}};rows.push(row);
        try{for(const [header,value]of Object.entries(raw)){const field=session.mapping[index]?.[header]||header;setField(row.record,field,value);}safe(row.record);}catch(e){add(row,'record',e.code||'IMPORT_CELL_JSON_INVALID');}
        if(table.formulaRows.some(item=>item.row===j+2))add(row,'formula','IMPORT_FORMULA_UNSUPPORTED');
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
    const canonicalDataHash=Contract.hashArtifact({network:normalized||scenario,candidateSites:scenario.candidateSites||[],costParameters:scenario.costParameters||[]});
    if(canonicalInput&&canonicalDataHash!==session.canonicalContext.canonicalDataHash){issues.push({code:'IMPORT_CANONICAL_HASH_MISMATCH',field:'canonicalDataHash',scope:settings.scope});}
    const finalBlocking=issues.filter(issue=>!excluded.has(issue.rowKey));
    return {schemaVersion:'stct-import-validation-p5.1',inputKind:session.inputKind||INPUT_KINDS.RAW,sourceUnitContext:canonicalInput?clone(session.canonicalContext.sourceUnits):{weight:settings.weightUnit,volume:settings.volumeUnit},canonicalUnits:{weight:'kg',volume:'m3'},status:finalBlocking.length?'BLOCKED':missing.length?'DATA_ONLY_SAVED':'READY',missingRequiredInput:missing,issues,totalRecords:rows.length,acceptedRecords:acceptedRows.length,rejectedRecords:excluded.size,rejectedRows:rows.filter(row=>excluded.has(row.key)),records:scenario,normalizedScenario:normalized,mappingHash:Contract.hashArtifact(session.mapping),unitContextHash:Contract.hashArtifact({canonicalUnits:{weight:'kg',volume:'m3'},sourceUnits:canonicalInput?session.canonicalContext.sourceUnits:{weight:settings.weightUnit,volume:settings.volumeUnit}}),canonicalDataHash,networkInputHash:normalized?Contract.identityBundle(normalized).networkInputHash:null,conversionLedger,settings:{...clone(settings),weightUnit:canonicalInput?'kg':settings.weightUnit,volumeUnit:canonicalInput?'m3':settings.volumeUnit},source:clone(session.sources),validationRevision:session.revision,performance:{...session.performance,mappingValidationMs,canonicalizationMs:performance.now()-canonicalStarted,normalizeValidateMs:performance.now()-started,evidenceClass:'MEASURED'}};
  }
  return Object.freeze({LIMITS,IDS,INPUT_KINDS,safe,parseJson,zipPreflight,readFiles,validate});
});
