"""Actual Chromium IndexedDB, two pages, production controller/repository; no solver required.

Requires Playwright and an installed Chromium. No browser/dependency download at runtime.
"""
import json
import os
from pathlib import Path
import shutil
import sys
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from local_web import Handler, Server
from playwright.sync_api import sync_playwright

MODULES = [
    'vendor/xlsx/xlsx.full.min.js', 'integrity-hash-v151.js', 'network-contract-v18.js',
    'import-budget-v19.js', 'platform-settings-v19.js', 'platform-import-session-v19.js',
    'supply-chain-import-v19.js', 'supply-chain-design-v19.js', 'supply-chain-explanation-v19.js',
    'supply-chain-report-v19.js', 'supply-chain-joint-v19.js', 'supply-chain-v5-results-v19.js',
    'local-road-client-v86.js', 'supply-chain-controller-v19.js', 'platform-repository-v19.js',
]
HTML = '<!doctype html><html><head><title>STCT native storage regression</title></head><body><h1>STCT native storage regression</h1><p>Synthetic data only</p>' + ''.join('<script src="/'+name+'"></script>' for name in MODULES) + '</body></html>'
SETUP = """() => {
  const ns=window.STCTPlatformV19;
  window.repo=ns.platformRepository.createRepository({name:'enterprise-native-regression'});
  window.controller=ns.supplyChainController.createController({repository:window.repo});
  return {storage:repo.diagnostics().storage};
}"""
INPUT = {'studyId':'NATIVE-SYNTHETIC','name':'Original','classification':'SYNTHETIC_TEST','nodes':[{'nodeId':'W','role':'DC'},{'nodeId':'C','role':'CUSTOMER'}],'periodDemand':[{'demandId':'D','customerNodeId':'C','period':'P1','quantity':5,'unit':'m3','currentSiteId':'W'}]}


class NativeStorageTests(unittest.TestCase):
    def test_same_id_import_and_cross_page_cas(self):
        server=Server(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as p:
                executable=os.environ.get('STCT_CHROMIUM') or shutil.which('chromium')
                browser=p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}),args=['--no-sandbox'])
                context=browser.new_context();errors=[]
                def route(request):
                    if request.request.url==base+'/__hardening':request.fulfill(status=200,content_type='text/html',body=HTML)
                    elif request.request.url.startswith(base+'/'):request.continue_()
                    else:request.abort()
                context.route('**/*',route)
                pages=[context.new_page(),context.new_page()]
                for page in pages:
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    page.goto(base+'/__hardening',wait_until='load')
                    self.assertEqual(page.title(),'STCT native storage regression')
                    self.assertEqual(page.evaluate(SETUP)['storage'],'NATIVE_INDEXED_DB')
                a,b=pages
                first=a.evaluate('async input=>{controller.loadStudy(input);return await controller.save();}',INPUT)
                pointer_id=first['pointer']['id']
                imported=b.evaluate("""async input=>{
                    controller.loadStudy(input);
                    let code;try{await controller.save();}catch(e){code=e.code;}
                    return {code,current:await repo.read('pointers','SUPPLY:'+input.studyId),draft:controller.snapshot().study.name};
                }""",{**INPUT,'name':'Conflicting import'})
                self.assertEqual(imported['code'],'REVISION_CONFLICT')
                self.assertEqual(imported['current'],first['pointer'])
                self.assertEqual(imported['draft'],'Conflicting import')
                b.evaluate('async id=>await controller.reopen(id)',pointer_id)
                second=a.evaluate("async()=>{controller.updateStudy({name:'Saved edit'});return await controller.save();}")
                stale=b.evaluate("async()=>{controller.updateStudy({name:'Stale edit'});try{await controller.save();return null;}catch(e){return e.code;}}")
                self.assertEqual(stale,'REVISION_CONFLICT')
                self.assertEqual(b.evaluate('async id=>await repo.read("pointers",id)',pointer_id),second['pointer'])
                # Same bytes imported again still do not acquire edit authority.
                draft=a.evaluate('()=>controller.exportDraftPackage()')
                duplicate=b.evaluate("async value=>{controller.importPackage(value);try{await controller.save();return null;}catch(e){return e.code;}}",draft)
                self.assertEqual(duplicate,'REVISION_CONFLICT')
                # Explicit Save-as uses a new ID and retains source lineage, as the existing UI does.
                branch=b.evaluate("""async()=>{
                    const prior=controller.snapshot().study,copy=structuredClone(prior);
                    copy.studyId=prior.studyId+'-BRANCH-'+crypto.randomUUID();
                    copy.assumptions={...copy.assumptions,branchOf:{studyId:prior.studyId,inputHash:prior.inputHash}};
                    controller.loadStudy(copy);return await controller.save();
                }""")
                self.assertNotEqual(branch['pointer']['id'],pointer_id)
                self.assertEqual(a.evaluate('async id=>await repo.read("pointers",id)',pointer_id),second['pointer'])
                b.reload(wait_until='load');b.evaluate(SETUP)
                restored=b.evaluate('async id=>await controller.reopen(id)',pointer_id)
                self.assertEqual(restored['study']['name'],'Saved edit')
                self.assertEqual(errors,[])
                evidence=os.environ.get('STCT_BROWSER_EVIDENCE_DIR')
                if evidence:
                    destination=Path(evidence);destination.mkdir(parents=True,exist_ok=True)
                    b.screenshot(path=str(destination/'native-storage.png'))
                print(json.dumps({'suite':'ENTERPRISE_NATIVE_INDEXEDDB','status':'PASS','browser':browser.version,'cases':['same_id_conflict','cross_page_cas','identical_import_conflict','explicit_branch','reload_readback'],'unhandledErrors':errors,'scope':'COMPONENT_HARNESS_NOT_FULL_UI'}))
                browser.close()
        finally:server.shutdown();server.server_close();thread.join(2)


if __name__=='__main__':unittest.main()
