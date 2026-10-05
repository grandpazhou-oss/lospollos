import ast,io,json,sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit
from typing import Any
tree=ast.parse(open(sys.argv[1],encoding='utf-8').read())
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
exec(compile(ast.Module(body=[cls],type_ignores=[]),sys.argv[1],'exec'))
rows=[]
for origin,expected in [(None,True),('null',False),('',False),('http://127.0.0.1:9865',True),('https://localhost:9865',True),('https://external.invalid',False),('http://user@localhost',False)]:
 h=Handler.__new__(Handler);h.headers={'Host':'127.0.0.1:9887'}
 if origin is not None:h.headers['Origin']=origin
 assert h._local_origin() is expected,(origin,expected)
 sent={};h.send_response=lambda x:None;h.send_header=lambda k,v:sent.update({k:v});h.end_headers=lambda:None;h.wfile=io.BytesIO()
 h._send(200,{'ok':True})
 assert sent.get('Access-Control-Allow-Origin')==(origin if expected and origin else None),sent
 rows.append({'origin':origin,'admitted':expected,'cors':sent.get('Access-Control-Allow-Origin')})
print(json.dumps(rows))
