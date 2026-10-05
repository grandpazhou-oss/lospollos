#!/usr/bin/env python3
"""Real Chromium/IndexedDB component regressions with synthetic domain collaborators.

This is NOT full-app, native-solver, Windows, or real-OSRM acceptance.
Requires the existing Python Playwright environment and a Chromium executable.
No dependency installation, external HTTP calls, or fixed service ports.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
HTML = b'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>STCT hardening component regression</title></head><body>
<h1>STCT controller / native IndexedDB regression</h1>
<p>Synthetic domain collaborators. Not a full application or solver acceptance test.</p>
<button id="run">Run storage regression</button><pre id="results">Ready</pre>
</body></html>'''


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        if self.path != '/':
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(HTML)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *args):
        pass


SETUP = r'''
() => {
  const F=EnterpriseHardeningFixture;
  const createRepository=STCTPlatformV19.platformRepository.createRepository;
  const createController=STCTPlatformV19.supplyChainController.createController;
  const name='stct-hardening-'+crypto.randomUUID();
  window.fixtureDatabase=name;
  const repositories=[];
  const repository=options=>{const repo=createRepository({name,...options});repositories.push(repo);return repo;};
  const controller=repo=>createController({repository:repo,fetch:async()=>{throw Error('Unexpected HTTP');}});
  const check=(condition,label)=>{if(!condition)throw Error(label);return label;};
  const reject=async(fn,code)=>{let error;try{await fn();}catch(e){error=e;}check(error?.code===code,'Expected '+code+', got '+error?.code);};
  document.querySelector('#run').onclick=async()=>{
    const passed=[];
    try{
      const repo=repository(),first=controller(repo);first.loadStudy(F.makeStudy());await first.save();
      passed.push(check((await repo.read('pointers','SUPPLY:A')).revision===1,'initial durable save'));
      const before=JSON.stringify(await repo.read('pointers','SUPPLY:A'));
      for(const [label,full,same] of [['changed draft',false,false],['identical draft',false,true],['full package',true,false]]){
        const imported=controller(repo);imported.importPackage(F.makePackage(F.makeStudy('A',same?'Original':'Imported'),full));
        await reject(()=>imported.save(),'REVISION_CONFLICT');
        passed.push(check(JSON.stringify(await repo.read('pointers','SUPPLY:A'))===before,label+' leaves pointer unchanged'));
      }
      passed.push(check((await repo.read('supplyStudies')).length===1,'rejected imports write no orphan records'));
      const reopened=controller(repo);await reopened.reopen('SUPPLY:A');reopened.updateStudy({name:'Edited'});await reopened.save();
      passed.push(check((await repo.read('pointers','SUPPLY:A')).revision===2,'bound editing session saves revision 2'));
      first.updateStudy({name:'Stale'});await reject(()=>first.save(),'REVISION_CONFLICT');passed.push('stale editor rejected');
      const broken=repository({fault:stage=>stage==='BEFORE_POINTER'?'QuotaExceededError':null}),draft=controller(broken);
      draft.loadStudy(F.makeStudy('QUOTA'));const quotaHash=draft.viewState().study.inputHash;
      await reject(()=>draft.save(),'STORAGE_QUOTA_EXCEEDED');
      passed.push(check(!await repo.read('pointers','SUPPLY:QUOTA')&&!await repo.read('supplyStudies',quotaHash),'native transaction rollback removes partial records'));
      const a=controller(repository()),b=controller(repository());a.loadStudy(F.makeStudy('RACE'));b.loadStudy(F.makeStudy('RACE'));
      const race=await Promise.allSettled([a.save(),b.save()]);
      passed.push(check(race.filter(r=>r.status==='fulfilled').length===1&&race.filter(r=>r.status==='rejected'&&r.reason.code==='REVISION_CONFLICT').length===1,'two connections: exactly one first writer'));
      const deleted=controller(repo);deleted.loadStudy(F.makeStudy('DELETED'));await deleted.save();await deleted.deleteStudy('SUPPLY:DELETED');
      const imported=controller(repo);imported.loadStudy(F.makeStudy('DELETED'));await reject(()=>imported.save(),'REVISION_CONFLICT');
      passed.push(check((await repo.read('pointers','SUPPLY:DELETED')).deleted===true,'tombstone cannot be resurrected'));
      for(const item of repositories)item.close();
      window.fixtureResult={status:'PASS',passed,database:name};
    }catch(error){for(const item of repositories)item.close();window.fixtureResult={status:'FAIL',passed,error:String(error),database:name};}
    document.querySelector('#results').textContent=JSON.stringify(window.fixtureResult,null,2);
  };
}
'''


def inject(page):
    page.add_script_tag(content=(ROOT / 'tests/enterprise_hardening_fixture.js').read_text())
    page.evaluate('EnterpriseHardeningFixture.installGlobals(globalThis)')
    for filename in ('local-road-client-v86.js', 'platform-repository-v19.js', 'supply-chain-controller-v19.js'):
        page.add_script_tag(content=(ROOT / filename).read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence-dir', type=Path, required=True, help='Outside the source repository')
    args = parser.parse_args()
    evidence = args.evidence_dir.resolve()
    if evidence == ROOT or ROOT in evidence.parents:
        parser.error('Write evidence outside the repository')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('BLOCKED_ENVIRONMENT: Python Playwright is required; nothing installed automatically')
        return 2
    evidence.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    errors = []
    result = {'status': 'BLOCKED_ENVIRONMENT', 'scope': 'COMPONENT_NATIVE_INDEXEDDB',
              'domainCollaborators': 'SYNTHETIC', 'nativeSolver': 'NOT_RUN'}
    try:
        with sync_playwright() as p:
            executable = os.environ.get('STCT_CHROMIUM') or shutil.which('chromium')
            browser = p.chromium.launch(headless=True, executable_path=executable)
            try:
                context = browser.new_context(viewport={'width': 1280, 'height': 800})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
                url = 'http://127.0.0.1:%s/' % server.server_port
                page.goto(url)
                # After navigation succeeds, assertion failures are FAIL, not an environment skip.
                result['status'] = 'FAIL'
                assert page.title() == 'STCT hardening component regression'
                assert page.locator('h1').is_visible()
                inject(page)
                page.evaluate(SETUP)
                page.get_by_role('button', name='Run storage regression').click()
                page.wait_for_function('window.fixtureResult !== undefined', timeout=20000)
                result.update(page.evaluate('window.fixtureResult'))
                result['browser'] = browser.version
                result['viewport'] = {'width': 1280, 'height': 800}
                assert result['status'] == 'PASS', result
                database = result['database']
                page.reload()
                inject(page)
                restored = page.evaluate('''async name=>{
                    const r=STCTPlatformV19.platformRepository.createRepository({name});
                    const c=STCTPlatformV19.supplyChainController.createController({repository:r});
                    await c.reopen('SUPPLY:A');
                    const value={name:c.viewState().study.name,revision:c.viewState().savedPointer.revision,deleted:(await r.read('pointers','SUPPLY:DELETED')).deleted};
                    r.close();return value;
                }''', database)
                assert restored == {'name': 'Edited', 'revision': 2, 'deleted': True}, restored
                result['passed'].append('page reload restores saved content, revision and tombstone')
                result['consoleErrors'] = errors
                assert not errors, errors
                page.locator('#results').evaluate('(el,result)=>el.textContent=JSON.stringify(result,null,2)', result)
                page.screenshot(path=str(evidence / 'native-indexeddb.png'), full_page=True)
                page.evaluate('name=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);})', database)
            finally:
                browser.close()
    except Exception as error:
        result.update(status='FAIL' if result.get('status') == 'PASS' else result['status'], error=str(error), consoleErrors=errors)
    finally:
        server.shutdown()
        server.server_close()
    (evidence / 'native-indexeddb.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
