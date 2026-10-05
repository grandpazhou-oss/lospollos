"""Contract tests with synthetic local responses. These are NOT real OSRM road validation."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'osrm-windows'))
import build_matrix as m
import osrm_local as local

META={'image':'synthetic-fixture','pbfSha256':'fixture-only','datasetDate':'2026-01-01'}
def package():
    return {'schemaVersion':'stct-supply-chain-draft-v1','study':{'nodes':[
        {'nodeId':'F','role':'FACTORY','coordinate':[120,30],'coordinateSystem':'WGS84'},
        {'nodeId':'D','role':'DC','coordinate':[121,30],'coordinateSystem':'WGS84'},
        {'nodeId':'C','role':'CUSTOMER','coordinate':[122,30],'coordinateSystem':'WGS84'}],
        'periodDemand':[{'customerNodeId':'C','quantity':7},{'customerNodeId':'C','quantity':11}],
        'observedInbound':[{'fromNodeId':'UNKNOWN','toNodeId':'D','quantity':3}]}}
def reply(km=10,seconds=900,snap=5):
    return {'code':'Ok','distances':[[None if km is None else km*1000]],'durations':[[seconds]],'sources':[{'distance':snap}], 'destinations':[{'distance':snap}]}
class MatrixTests(unittest.TestCase):
    def setUp(self): self.study,self.nodes=m.study_nodes(package())
    def test_pairs_preserve_volume(self):
        self.assertEqual(m.make_pairs(self.study,self.nodes,'joint'),[('D','C'),('F','D')])
        self.assertEqual(sum(x['quantity'] for x in self.study['periodDemand']),18)
        self.assertEqual(self.study['observedInbound'][0]['fromNodeId'],'UNKNOWN')
    def test_unknown_crs(self):
        p=package();p['study']['nodes'][0]['coordinateSystem']=None
        with self.assertRaises(ValueError):m.study_nodes(p)
        self.assertTrue(m.study_nodes(p,True)[1]['F']['crsAssumed'])
    def test_known_other_crs_not_overridden(self):
        p=package();p['study']['nodes'][0]['coordinateSystem']='GCJ02'
        with self.assertRaises(ValueError):m.study_nodes(p,True)
    def test_invalid_coords(self):
        for v in [[None,30],['',30],[float('nan'),30],[181,30],[True,30]]:
            p=package();p['study']['nodes'][0]['coordinate']=v
            with self.assertRaises(ValueError):m.study_nodes(p)
    def test_directed_units(self):
        replies=iter([reply(10),reply(19)])
        rows,errors=m.matrix(self.nodes,[('D','C'),('C','D')],'http://127.0.0.1:5001',META,fetch=lambda _:next(replies))
        self.assertEqual([r['distanceKm'] for r in rows],[10,19]);self.assertEqual(errors,[])
        self.assertTrue(all(r['quality']=='ESTIMATED_ROAD' and r['travelSeconds']==900 for r in rows))
    def test_unreachable_not_zero(self):
        rows,errors=m.matrix(self.nodes,[('D','C')],'http://127.0.0.1:5001',META,fetch=lambda _:reply(None))
        self.assertEqual(rows,[]);self.assertEqual(errors[0]['reason'],'UNREACHABLE_OR_INVALID_DISTANCE')
    def test_snap_limit(self):
        rows,errors=m.matrix(self.nodes,[('D','C')],'http://127.0.0.1:5001',META,fetch=lambda _:reply(snap=1001))
        self.assertFalse(rows);self.assertEqual(errors[0]['reason'],'SNAP_DISTANCE_REVIEW_REQUIRED')
    def test_real_zero_allowed(self):
        rows,errors=m.matrix(self.nodes,[('D','C')],'http://127.0.0.1:5001',META,fetch=lambda _:reply(0,0))
        self.assertEqual(rows[0]['distanceKm'],0);self.assertFalse(errors)
    def test_malformed_rejected(self):
        with self.assertRaises((ValueError,KeyError)):
            m.matrix(self.nodes,[('D','C')],'http://127.0.0.1:5001',META,fetch=lambda _: {'code':'Ok'})
    def test_endpoint_boundary(self):
        for endpoint in ['https://router.project-osrm.org','http://example.com:5001','http://localhost:5001','http://127.0.0.1:8787','http://u:p@127.0.0.1:5001','http://127.0.0.1:5001/path']:
            with self.assertRaises(ValueError):m.local_url(endpoint)
    def test_batch_100_and_no_fallback(self):
        nodes={str(i):{'coordinate':[120+i/1000,30]} for i in range(206)}
        sizes=[]
        def fetch(url):
            self.assertNotIn('fallback_speed',url)
            count=len(url.split('destinations=')[1].split(';'));sizes.append(count)
            return {'code':'Ok','distances':[[100]*count],'durations':[[60]*count],'sources':[{'distance':0}],'destinations':[{'distance':0}]*count}
        rows,_=m.matrix(nodes,[('0',str(i)) for i in range(1,206)],'http://127.0.0.1:5001',META,fetch=fetch)
        self.assertEqual(len(rows),205);self.assertEqual(sizes,[99,99,7])
    def test_ownership_refusal(self):
        with patch.object(local,'inspect',return_value={'Config':{'Labels':{local.OWNER:'someone-else'}}}):
            with self.assertRaises(ValueError):local.owned({'owner':'ours','container':'test'})
    def test_reserved_ports(self):
        for port in [8787,8791,8877,80,99999]:
            with self.assertRaises(ValueError):local.free_port(port)
    def test_image_pinned(self):
        self.assertIn('@sha256:',local.IMAGE)
        manifest=json.loads((local.ROOT/'image-manifest.json').read_text())
        self.assertIn({'architecture':'amd64','os':'linux'},manifest['platforms'])
    def test_download_url_boundary(self):
        import types
        for url in ['http://download.geofabrik.de/asia/china.osm.pbf', 'https://example.com/asia/china.osm.pbf', 'https://download.geofabrik.de/asia/china.osm.pbf?token=hidden']:
            with self.assertRaises(ValueError):local.download(types.SimpleNamespace(url=url,download_to=None))
    def test_download_checksum(self):
        import tempfile, types, io, hashlib
        class Reply(io.BytesIO): headers={'Last-Modified':'fixture'}
        payload=b'synthetic map bytes'
        with tempfile.TemporaryDirectory() as folder:
            dest=Path(folder)/'map.osm.pbf'
            args=types.SimpleNamespace(url='https://download.geofabrik.de/asia/fixture.osm.pbf',download_to=dest,stage_timeout=5)
            responses=[Reply((hashlib.md5(payload).hexdigest()+'  fixture').encode()),Reply(payload)]
            with patch.object(local.urllib.request,'urlopen',side_effect=responses):local.download(args)
            self.assertEqual(dest.read_bytes(),payload)
            self.assertEqual(json.loads(dest.with_suffix('.download.json').read_text())['sha256'],hashlib.sha256(payload).hexdigest())
            with self.assertRaises(ValueError):local.download(args)
    def test_download_bad_checksum_keeps_partial(self):
        import tempfile,types,io
        class Reply(io.BytesIO):headers={}
        with tempfile.TemporaryDirectory() as folder:
            dest=Path(folder)/'bad.osm.pbf'
            args=types.SimpleNamespace(url='https://download.geofabrik.de/asia/fixture.osm.pbf',download_to=dest,stage_timeout=5)
            with patch.object(local.urllib.request,'urlopen',side_effect=[Reply(b'0'*32),Reply(b'bad')]):
                with self.assertRaises(ValueError):local.download(args)
            self.assertFalse(dest.exists());self.assertTrue(dest.with_suffix('.pbf.partial').exists())
    def test_no_overwrite(self):
        import tempfile, types
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder);pbf=path/'original.osm.pbf';pbf.write_bytes(b'fixture')
            with self.assertRaisesRegex(ValueError,'new directory'):
                local.prepare(types.SimpleNamespace(pbf=pbf,data=path,dataset_date='2026-01-01'))
            self.assertEqual(pbf.read_bytes(),b'fixture')
if __name__=='__main__':unittest.main(verbosity=2)
