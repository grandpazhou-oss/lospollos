'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),XLSX=require('../vendor/xlsx/xlsx.full.min.js');
const source=fs.readFileSync(require.resolve('../main.js'),'utf8');
function named(name){const at=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',at+1);assert.ok(at>=0);return source.slice(at,end<0?undefined:end);}
const ctx={XLSX,DATA:{depot:{code:'PROTECTED-OLD',name:'Old depot',lat:34,lon:120}},window:{},structuredClone,Date,Number};vm.createContext(ctx);
vm.runInContext(['firstValue','excelToNumber','normalizeLonLat','sheetRowsToObjects','excelSerialToDate','excelToRawData'].map(named).join('\n'),ctx);
vm.runInContext(fs.readFileSync(require.resolve('../validator.js'),'utf8'),ctx);
const wb=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
 ['Order ID','Date','Customer Code','Customer Name','Longitude','Latitude','Volume','Packages','TW Start','TW End','Service Min'],
 ['A','2026-10-04','A','Alpha',120,30,0.25,1,'09:00','17:00',1],
 ['B','2026-10-04','B','Beta',121,31,'oops',1,'09:00','17:00',1],
 ['C','2026-10-04','C','Gamma','','',2,1,'09:00','17:00',1],
 ['D','2026-10-04','D','Delta',0,0,0.5,1,'09:00','17:00',1],
]),'Orders');
XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Vehicle ID','Vehicle Name','Max Volume','Available Start','Available End'],['V','Van',10,'09:00','17:00']]),'Vehicles');
XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Depot ID','Depot Name','Longitude','Latitude'],['W','Warehouse',120,30]]),'Depots');
const raw=ctx.excelToRawData(wb);
assert.equal(raw.orders.length,4);assert.equal(raw.orders[0].volume,0.25);assert.equal(raw.orders[1].volume,'oops');
assert.equal(raw.orders[2].lon,null);assert.equal(raw.orders[2].lat,null);assert.equal(raw.orders[3].lon,0);
assert.equal(raw.orders[0].source.rowNumber,2);assert.equal(raw.orders[1].source.values[6],'oops');
let v=ctx.window.STCTValidator.validateRaw(raw);assert.equal(v.metrics.coordinateCompleteness,75);assert.equal(v.metrics.plannableRate,50);assert.equal(v.metrics.blockedOrderRows,2);assert.equal(v.canApply,false);
raw.importAssumptionsConfirmed=true;v=ctx.window.STCTValidator.validateRaw(raw);assert.equal(v.canApply,true);assert.equal(v.metrics.blockedOrderRows,2);
delete wb.Sheets.Depots;wb.SheetNames=wb.SheetNames.filter(n=>n!=='Depots');const missing=ctx.excelToRawData(wb);
assert.equal(missing.depot.code,'');assert.equal(missing.depot.lat,null);assert.equal(ctx.window.STCTValidator.validateRaw({...missing,importAssumptionsConfirmed:true}).canApply,false);
wb.Sheets.Vehicles=XLSX.utils.aoa_to_sheet([['Vehicle ID','Vehicle Name','Max Volume'],['V','Van','']]);const noCapacity=ctx.excelToRawData(wb);assert.equal(noCapacity.vehicles[0].maxVolume,null);assert.equal(ctx.window.STCTValidator.validateRaw(noCapacity).metrics.usableVehicles,0);
wb.Sheets.Vehicles=XLSX.utils.aoa_to_sheet([['Vehicle ID','Vehicle Name','Max Volume'],['V','Van','oops']]);assert.equal(ctx.excelToRawData(wb).vehicles[0].maxVolume,'oops');
console.log(JSON.stringify({status:'PASS',method:'PRODUCTION_LEGACY_PARSER_AND_VALIDATOR',checks:['preserve_small_volume','retain_invalid_original','missing_coordinates_null','explicit_zero_coordinate_valid','source_rows','original_coverage','explicit_default_confirmation','no_previous_depot','unknown_capacity_not_default500']}));
