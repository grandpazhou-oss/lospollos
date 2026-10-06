"""Production storage/controller modules against Chromium native IndexedDB.

Synthetic data only. Quota/transaction faults are deliberately injected through the
repository's existing fault seam and exercise native atomic rollback, not actual
browser quota exhaustion. The harness intercepts every request: no server, service
ports, dependency install, native solver, private data, or full-UI acceptance claim.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
MODULES = (
    'vendor/xlsx/xlsx.full.min.js', 'integrity-hash-v151.js', 'network-contract-v18.js',
    'import-budget-v19.js', 'platform-settings-v19.js', 'platform-import-session-v19.js',
    'supply-chain-import-v19.js', 'supply-chain-design-v19.js', 'supply-chain-explanation-v19.js',
    'supply-chain-report-v19.js', 'supply-chain-joint-v19.js', 'supply-chain-v5-results-v19.js',
    'local-road-client-v86.js', 'supply-chain-controller-v19.js', 'platform-repository-v19.js',
)
RUN = r'''async () => {
  const ns=STCTPlatformV19, repositories=[], passed=[];
  const input=(id='NATIVE-STORAGE-SYNTHETIC',name='Original')=>({studyId:id,name,classification:'SYNTHETIC_TEST',nodes:[{nodeId:'A',role:'DC'},{nodeId:'C',role:'CUSTOMER'}],periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'A',period:'P',quantity:5,unit:'m3'}]});
  const repository=(options={})=>{const value=ns.platformRepository.createRepository({name:'enterprise-storage-'+crypto.randomUUID(),...options});repositories.push(value);return value;};
  const controller=repo=>ns.supplyChainController.createController({repository:repo,fetch:async()=>{throw Error('Unexpected network request');}});
  const check=(condition,label)=>{if(!condition)throw Error(label);};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const reject=async(promise,code)=>{let error;try{await promise;}catch(e){error=e;}check(error?.code===code,`Expected ${code}, got ${error?.code||error||'success'}`);};
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  try {
    const closing=repository(), opening=closing.open();closing.close();let closeTimer;
    try {await reject(Promise.race([opening,new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Native open remained pending after close')),2000);})]),'STORAGE_CLOSED');}
    finally {clearTimeout(closeTimer);}
    passed.push('native-open-settles-after-immediate-close');
    for(const stage of ['BEFORE_RECORDS','AFTER_RECORDS','BEFORE_POINTER','AFTER_POINTER','AFTER_SELECTION']) {
      for(const fault of ['QuotaExceededError','STORAGE_TRANSACTION_FAILED']) {
        const name='enterprise-fault-'+crypto.randomUUID(), repo=repository({name}), owner=controller(repo);
        owner.loadStudy(input());const initial=await owner.save();
        const failing=repository({name,fault:value=>value===stage?fault:null}), editing=controller(failing);
        await editing.reopen(initial.pointer.id);editing.updateStudy({name:'Edited but rejected'});
        const before=editing.snapshot(), inputHash=before.study.inputHash;
        await reject(editing.save(),fault==='QuotaExceededError'?'STORAGE_QUOTA_EXCEEDED':fault);
        check(same(editing.snapshot(),before),'Failed save changed controller receipt');
        check(same(await repo.read('pointers',initial.pointer.id),initial.pointer),'Failed save changed existing pointer');
        check(!await repo.read('supplyStudies',inputHash),'Native rollback left partial immutable record');
        check((await repo.read('audit')).length===1,'Native rollback left partial audit');
        check(Boolean(await repo.read('supplyStudies',initial.pointer.inputHash)),'Rollback lost the original record');
        passed.push(stage+':'+fault+':native-atomic-rollback');
      }
    }
    const name='enterprise-race-'+crypto.randomUUID(), firstRepo=repository({name}), secondRepo=repository({name}), a=controller(firstRepo), b=controller(secondRepo);
    a.loadStudy(input('RACE'));b.loadStudy(input('RACE'));
    const race=await Promise.allSettled([a.save(),b.save()]);
    check(race.filter(r=>r.status==='fulfilled').length===1,'Concurrent create did not have one winner');
    check(race.filter(r=>r.status==='rejected'&&r.reason.code==='REVISION_CONFLICT').length===1,'Concurrent create did not report CAS conflict');
    passed.push('two-native-connections-create-CAS');
    await a.reopen('SUPPLY:RACE');await b.reopen('SUPPLY:RACE');
    a.updateStudy({name:'Winner edit'});const latest=await a.save();b.updateStudy({name:'Stale edit'});await reject(b.save(),'REVISION_CONFLICT');
    check(same(await secondRepo.read('pointers','SUPPLY:RACE'),latest.pointer),'Stale editor overwrote native pointer');
    passed.push('two-native-connections-update-CAS');
    await a.deleteStudy('SUPPLY:RACE');const tombstone=await firstRepo.read('pointers','SUPPLY:RACE');
    await reject(b.save(),'REVISION_CONFLICT');await b.openVersion(latest.pointer.inputHash);await reject(b.save(),'REVISION_CONFLICT');
    check(same(await secondRepo.read('pointers','SUPPLY:RACE'),tombstone),'Old version resurrected native tombstone');
    passed.push('native-tombstone-preserved-for-stale-and-old-version');
    const receiptRepo=repository(), committed=deferred(), release=deferred();
    const delayed={...receiptRepo,commit:async batch=>{const receipt=await receiptRepo.commit(batch);committed.resolve();await release.promise;return receipt;}};
    const savingController=controller(delayed);savingController.loadStudy(input('LATE-RECEIPT'));const saving=savingController.save();await committed.promise;
    savingController.loadStudy(input('NEW-STUDY'));const newer=savingController.snapshot();release.resolve();const receipt=await saving;
    check(receipt.status==='SAVED'&&receipt.pointer.id==='SUPPLY:LATE-RECEIPT','Durable receipt identity changed');
    check(same(savingController.snapshot(),newer),'Durable receipt overwrote the new editing session');
    check(Boolean(await receiptRepo.read('pointers',receipt.pointer.id)),'Durable receipt was not backed by native storage');
    passed.push('native-durable-receipt-does-not-bind-new-study');
    return {status:'PASS',passed,scope:'PRODUCTION_MODULES_NATIVE_INDEXEDDB_COMPONENT_HARNESS',faultMethod:'CONTROLLED_FAULT_INJECTION_NATIVE_TRANSACTION_ABORT',nativeSolver:false};
  } finally {for(const repo of repositories)repo.close();}
}'''


def main() -> int:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        executable = os.environ.get('STCT_CHROMIUM') or shutil.which('chromium')
        browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}), args=['--no-sandbox'])
        try:
            context = browser.new_context()
            context.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body='<!doctype html><title>Synthetic native storage regression</title>'))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1/__enterprise_storage', wait_until='load')
            for name in MODULES:
                page.add_script_tag(content=(ROOT / name).read_text(encoding='utf-8'))
            result = page.evaluate(RUN)
            if errors:
                raise AssertionError(f'Unhandled browser errors: {errors}')
            result.update(suite='ENTERPRISE_STORAGE_NATIVE', browser=browser.version, unhandledErrors=errors)
            print(json.dumps(result, ensure_ascii=False))
            return 0
        finally:
            browser.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'suite':'ENTERPRISE_STORAGE_NATIVE','status':'FAIL_OR_ENVIRONMENT_BLOCK','error':str(error)}), file=sys.stderr)
        sys.exit(1)
