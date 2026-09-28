(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./network-contract-v18.js'):root.STCTV18?.networkContract);if(typeof module==='object'&&module.exports)module.exports=api;if(root.document)(root.STCTPlatformV19=root.STCTPlatformV19||{}).settingsRegistry=api;})(globalThis,function(Contract){
  'use strict';
  const FIELDS={PLATFORM:['locale','reducedMotion','noWebGL','weightUnit','volumeUnit','currency'],DESIGN:['observationPeriod','costPeriod','annualBusinessDays','monthlyPeriodsPerYear','tollPerKm','demandDimension'],COMMAND:['planningDate','timeWindowStart','timeWindowEnd']};
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  async function save(repository,scope,value,expectedRevision){
    if(!FIELDS[scope]||Object.keys(value).some(key=>!FIELDS[scope].includes(key)))fail('SETTINGS_SCOPE_FIELD_INVALID');
    if(value.annualBusinessDays!==undefined&&(!Number.isInteger(value.annualBusinessDays)||value.annualBusinessDays<1||value.annualBusinessDays>366))fail('SETTINGS_BUSINESS_DAYS_INVALID');
    if(value.monthlyPeriodsPerYear!==undefined&&value.monthlyPeriodsPerYear!==12)fail('SETTINGS_MONTHS_INVALID');
    if(value.tollPerKm!==undefined&&(!Number.isFinite(value.tollPerKm)||value.tollPerKm<0))fail('SETTINGS_TOLL_INVALID');
    for(const [key,allowed]of Object.entries({locale:['zh','en','ja'],weightUnit:['kg','tonne'],volumeUnit:['m3','litre'],currency:['CNY','JPY','USD'],demandDimension:['both','volume','weight']}))if(value[key]!==undefined&&!allowed.includes(value[key]))fail('SETTINGS_VALUE_INVALID');
    for(const key of ['timeWindowStart','timeWindowEnd'])if(value[key]!==undefined&&!/^(?:[01]\d|2[0-9]):[0-5]\d$/.test(value[key]))fail('SETTINGS_TIME_INVALID');
    const payload={scope,values:structuredClone(value),applicationPolicy:'FUTURE_IMPORT_DEFAULTS_ONLY',providerPrivacyGate:'NO_PUBLIC_PROVIDER_ENABLED',revision:expectedRevision+1};
    const id=scope+':'+Contract.hashArtifact(payload);
    return repository.commit({records:{settings:[repository.record(id,payload)]},pointer:{id:'SETTINGS:'+scope,scope,type:'SETTINGS',refs:[{store:'settings',id}]},expectedRevision,action:'SAVE_SCOPED_SETTINGS'});
  }
  function normalizePeriods(rows,rule={}){
    if(rule.target&&!['YEAR'].includes(rule.target))fail('COST_NORMALIZATION_TARGET_UNSUPPORTED');
    const currencies=new Set(rows.map(row=>row.currency));if(currencies.size!==1)fail('MIXED_CURRENCY_BLOCKED');
    const periods=new Set(rows.filter(row=>row.period!=='ONE_TIME').map(row=>row.period));
    if(periods.size>1&&!rule.annualBusinessDays)fail('MIXED_COST_PERIOD_BLOCKED');
    const converted=rows.map(row=>{
      if(!Number.isFinite(row.amount)||row.amount<0)fail('COST_VALUE_INVALID');
      if(row.normalizationHash)fail('COST_ALREADY_NORMALIZED');
      let factor=1;
      if(rule.target==='YEAR'){
        if(row.period==='MONTH'){if(rule.monthlyPeriodsPerYear!==12)fail('MONTH_RULE_REQUIRED');factor=12;}
        else if(row.period==='DAY'){if(!Number.isInteger(rule.annualBusinessDays)||rule.annualBusinessDays<1||rule.annualBusinessDays>366)fail('BUSINESS_DAYS_REQUIRED');factor=rule.annualBusinessDays;}
        else if(!['YEAR','ONE_TIME'].includes(row.period))fail('COST_PERIOD_UNSUPPORTED');
      }
      return {...structuredClone(row),sourceAmount:row.amount,sourcePeriod:row.period,factor,amount:Math.round(row.amount*factor*1000)/1000,period:row.period==='ONE_TIME'?'ONE_TIME':rule.target||row.period,normalizationHash:Contract.hashArtifact(rule)};
    });
    return{rows:converted,oneTime:converted.filter(row=>row.period==='ONE_TIME'),recurring:converted.filter(row=>row.period!=='ONE_TIME'),currency:[...currencies][0],rule:structuredClone(rule),sourceAuthority:'EXPLICIT_UNIT_PERIOD_CONVERSION_NOT_COST_SOLVER'};
  }
  return Object.freeze({FIELDS,save,normalizePeriods});
});
