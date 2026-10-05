#!/usr/bin/env python3
"""Build directed road estimates from an exported STCT study, using owned local OSRM only."""
import argparse
import csv
import json
import math
import os
import tempfile
import subprocess
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from osrm_local import owned, sha


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def study_nodes(package, assume_wgs84=False):
    if package.get('schemaVersion') not in ('stct-supply-chain-package-v1.9', 'stct-supply-chain-draft-v1'):
        raise ValueError('Export a native STCT supply-chain study/draft package first')
    study = package['study']
    nodes = {}
    for row in study['nodes']:
        node_id = row.get('nodeId')
        if not isinstance(node_id, str) or not node_id or node_id in nodes or node_id.lstrip().startswith(('=', '+', '-', '@')):
            raise ValueError('Missing or duplicate node ID')
        coord = row.get('coordinate')
        crs = (row.get('coordinateSystem') or '').upper().replace('-', '')
        if crs and crs != 'WGS84':
            raise ValueError('Unsupported CRS for ' + node_id + ': ' + crs + '; no automatic conversion')
        if not crs and not assume_wgs84:
            raise ValueError('Unknown CRS for ' + node_id + '; confirm coordinates independently or use explicit audited --assume-wgs84')
        if not isinstance(coord, list) or len(coord) != 2 or not all(numeric(x) for x in coord) or abs(coord[0]) > 180 or abs(coord[1]) > 90:
            raise ValueError('Missing/invalid longitude,latitude for ' + node_id)
        nodes[node_id] = {'coordinate': coord, 'role': row.get('role'), 'crsAssumed': not crs}
    return study, nodes


def make_pairs(study, nodes, scope, direct=False, transfer=False):
    sites = [k for k, n in nodes.items() if n['role'] in ('DC', 'WAREHOUSE')]
    suppliers = [k for k, n in nodes.items() if n['role'] in ('FACTORY', 'SUPPLIER')]
    customers = list(dict.fromkeys(r['customerNodeId'] for r in study.get('periodDemand', [])))
    pairs = []
    if scope in ('outbound', 'joint'): pairs += [(s, c) for s in sites for c in customers]
    if scope in ('upstream', 'joint'): pairs += [(f, s) for f in suppliers for s in sites]
    if direct: pairs += [(f, c) for f in suppliers for c in customers]
    if transfer: pairs += [(a, b) for a in sites for b in sites if a != b]
    # Keep observed transport coverage even when planning options differ. Unknown suppliers stay a gap.
    for row in study.get('observedInbound', []) if scope != 'outbound' else []:
        if row.get('fromNodeId') in nodes and row.get('toNodeId') in nodes:
            pairs.append((row['fromNodeId'], row['toNodeId']))
    result = list(dict.fromkeys(pairs))
    if not result or len(result) > 50000 or any(a not in nodes or b not in nodes for a,b in result):
        raise ValueError('No valid pairs, unknown endpoints, or >50000 pairs')
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('OSRM redirects are prohibited')


def local_url(value):
    url = urllib.parse.urlsplit(value)
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('Endpoint must be http://127.0.0.1:PORT (no public services)')
    if not url.port or url.port in (8787, 8791, 8877):
        raise ValueError('Explicit, non-protected OSRM port required')
    return value.rstrip('/')


def matrix(nodes, pairs, endpoint, metadata, max_snap=1000, budget=600, fetch=None):
    endpoint = local_url(endpoint)
    if not numeric(max_snap) or max_snap < 0 or not numeric(budget) or budget <= 0:
        raise ValueError('Invalid snap limit / time budget')
    start = time.monotonic()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def request(url):
        with opener.open(url, timeout=min(30, max(.1, budget - (time.monotonic() - start)))) as response:
            return json.load(response)
    fetch = fetch or request
    by_origin = {}
    for a,b in pairs: by_origin.setdefault(a, []).append(b)
    rows, errors = [], []
    timestamp = datetime.now(timezone.utc).isoformat()
    for a, targets in by_origin.items():
        for offset in range(0, len(targets), 99):
            if time.monotonic() - start >= budget:
                raise TimeoutError('Overall matrix budget exceeded; no complete result written')
            batch = targets[offset:offset+99]
            coordinates = ';'.join(','.join(str(x) for x in nodes[k]['coordinate']) for k in [a, *batch])
            indices = ';'.join(str(i) for i in range(1,len(batch)+1))
            # No fallback_speed: disconnected road pairs must remain missing.
            url = f'{endpoint}/table/v1/driving/{coordinates}?annotations=distance,duration&sources=0&destinations={indices}'
            result = fetch(url)
            if result.get('code') != 'Ok':
                raise ValueError('OSRM returned ' + str(result.get('code')))
            distances = result['distances'][0]; durations = result['durations'][0]
            if len(distances) != len(batch) or len(durations) != len(batch) or len(result['destinations']) != len(batch):
                raise ValueError('Malformed OSRM table shape')
            origin_snap = result['sources'][0].get('distance')
            for i,b in enumerate(batch):
                distance, duration = distances[i], durations[i]
                destination_snap = result['destinations'][i].get('distance')
                reason = None
                if not all(numeric(v) and v >= 0 for v in [distance,duration]): reason = 'UNREACHABLE_OR_INVALID_DISTANCE'
                elif not all(numeric(v) and 0 <= v <= max_snap for v in [origin_snap,destination_snap]): reason = 'SNAP_DISTANCE_REVIEW_REQUIRED'
                audit = {'from':a,'to':b,'originSnapMeters':origin_snap,'destinationSnapMeters':destination_snap}
                if reason:
                    errors.append({**audit,'reason':reason}); continue
                source = f"OSRM {metadata['image']} | PBF {metadata['pbfSha256']} | {metadata['datasetDate']}"
                rows.append({**audit,'distanceKm':distance / 1000,'travelSeconds':duration,'unit':'km',
                             'quality':'ESTIMATED_ROAD','source':source,'observedAt':timestamp,
                             'strategy':'car.lua / MLD preferred driving path; not truck-verified'})
    return rows, errors


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--study',type=Path,required=True); p.add_argument('--data',type=Path,required=True)
    p.add_argument('--endpoint',default='http://127.0.0.1:5001')
    p.add_argument('--scope',choices=['outbound','upstream','joint'],required=True)
    p.add_argument('--direct',action='store_true');p.add_argument('--transfer',action='store_true')
    p.add_argument('--assume-wgs84',action='store_true')
    p.add_argument('--max-snap-m',type=float,default=1000);p.add_argument('--budget',type=float,default=600)
    p.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    local_url(args.endpoint)
    if args.out.exists(): raise ValueError('Output directory already exists; choose a new directory')
    metadata=json.loads((args.data/'stct-osrm.json').read_text(encoding='utf-8'))
    info=owned(metadata)
    binding={'HostIp':'127.0.0.1','HostPort':str(urllib.parse.urlsplit(args.endpoint).port)}
    if not info['State']['Running'] or binding not in (info['NetworkSettings']['Ports'].get('5000/tcp') or []):
        raise ValueError('Endpoint does not belong to this prepared OSRM container')
    study,nodes=study_nodes(json.loads(args.study.read_text(encoding='utf-8-sig')),args.assume_wgs84)
    pairs=make_pairs(study,nodes,args.scope,args.direct,args.transfer)
    rows,errors=matrix(nodes,pairs,args.endpoint,metadata,args.max_snap_m,args.budget)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=args.out.name + '.pending-', dir=args.out.parent))
    audit={'requestedPairs':len(pairs),'usablePairs':len(rows),'missingPairs':len(errors),
           'status':'COMPLETE' if not errors else 'INCOMPLETE','inputSha256':sha(args.study),
           'studyInputHash':study.get('inputHash'),'scope':args.scope,'direct':args.direct,'transfer':args.transfer,
           'crsAssumedNodeIds':[k for k,v in nodes.items() if v['crsAssumed']],
           'dataset':metadata,'maxSnapMeters':args.max_snap_m,'errors':errors,
           'semantics':'Directed car road estimates. No live traffic, truck legality, GPS or costs inferred.'}
    (pending/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # Partial matrices are audit-only, never accidentally imported as complete evidence.
    if not errors:
        columns=['from','to','distanceKm','quality','source','unit','travelSeconds','observedAt','strategy','originSnapMeters','destinationSnapMeters']
        with (pending/'matrix.csv').open('w',encoding='utf-8-sig',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=columns);writer.writeheader();writer.writerows(rows)
    else:
        (pending/'partial-rows.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    os.replace(pending, args.out)
    print(json.dumps({k:audit[k] for k in ['requestedPairs','usablePairs','missingPairs','status']}))
    return 0 if not errors else 2


if __name__=='__main__':
    try: sys.exit(main())
    except (ValueError,OSError,KeyError,IndexError,TimeoutError,subprocess.SubprocessError) as error:
        print('BLOCKED:',error,file=sys.stderr);sys.exit(1)
