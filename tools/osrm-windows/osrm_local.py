#!/usr/bin/env python3
"""Optional OSRM lifecycle. Standard library only; never controls STCT services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import uuid
import re
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
OWNER = 'stct.osrm.owner'
IMAGE = 'ghcr.io/project-osrm/osrm-backend@' + json.loads((ROOT / 'image-manifest.json').read_text())['digest']


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def docker(*args, **kwargs):
    return run(['docker', *map(str, args)], **kwargs)


def inspect(container):
    result = docker('inspect', container, capture_output=True)
    return json.loads(result.stdout)[0]


def owned(state):
    info = inspect(state['container'])
    if info['Config'].get('Labels', {}).get(OWNER) != state['owner']:
        raise ValueError('Container ownership mismatch; refusing to operate')
    return info


def atomic_json(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def free_port(port):
    if not 1024 <= port <= 65535 or port in (8787, 8791, 8877):
        raise ValueError('Use a non-protected port in 1024..65535')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))


def doctor():
    if not shutil.which('docker'):
        raise ValueError('Docker CLI missing. Install/launch Docker Desktop manually; no installation attempted.')
    info = json.loads(docker('info', '--format', '{{json .}}', capture_output=True).stdout)
    if info.get('OSType') != 'linux':
        raise ValueError('Docker must be running Linux containers')
    print(json.dumps({k: info.get(k) for k in ['OSType', 'Architecture', 'NCPU', 'MemTotal', 'ServerVersion']}, indent=2))


def prepare(args):
    pbf = args.pbf.resolve()
    if not pbf.is_file() or not pbf.name.endswith('.osm.pbf'):
        raise ValueError('An existing .osm.pbf file is required')
    # Never preprocess beside original files or overwrite an older prepared dataset.
    work = args.data.resolve()
    if work.exists():
        raise ValueError('Preparation requires a new directory; choose another --data path')
    if not args.dataset_date:
        raise ValueError('Record the extract timestamp using --dataset-date YYYY-MM-DD')
    datetime.strptime(args.dataset_date, '%Y-%m-%d')
    doctor()
    digest = sha(pbf)
    if args.pbf_sha256 and digest != args.pbf_sha256.lower():
        raise ValueError('PBF SHA-256 mismatch')
    work.mkdir(parents=True)
    shutil.copy2(pbf, work / 'network.osm.pbf')
    owner = uuid.uuid4().hex
    state = {'owner': owner, 'container': 'stct-osrm-' + owner[:12], 'image': IMAGE,
             'pbfSha256': digest, 'datasetDate': args.dataset_date, 'datasetFile': pbf.name,
             'profile': 'car.lua', 'algorithm': 'MLD', 'status': 'PREPARING',
             'createdAt': datetime.now(timezone.utc).isoformat(), 'quality': 'ESTIMATED_ROAD'}
    statefile = work / 'stct-osrm.json'
    atomic_json(statefile, state)
    common = ['run', '--rm', '--name', state['container'], '--label', OWNER + '=' + owner,
              '--mount', f'type=bind,source={work},target=/data', IMAGE]
    stages = [ ['osrm-extract', '-p', '/opt/car.lua', '/data/network.osm.pbf', '--threads', str(args.threads)],
               ['osrm-partition', '/data/network.osrm', '--threads', str(args.threads)],
               ['osrm-customize', '/data/network.osrm', '--threads', str(args.threads)] ]
    try:
        for command in stages:
            state['stage'] = command[0]; atomic_json(statefile, state)
            with (work / (command[0] + '.log')).open('w', encoding='utf-8') as log:
                print('Running', command[0], '— log:', log.name, flush=True)
                docker(*common, *command, stdout=log, stderr=subprocess.STDOUT, timeout=args.stage_timeout)
        state['status'] = 'PREPARED'
        # Routing graph file fingerprints are available without exposing customer data.
        state['artifacts'] = {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)}
                              for p in work.glob('network.osrm*') if p.is_file()}
        if not state['artifacts']:
            raise ValueError('No routing artifacts produced')
    except BaseException:
        state['status'] = 'FAILED_OR_CANCELLED'
        # A cancelled docker client can leave its container running; stop only our exact owned one.
        try:
            owned(state)
            docker('stop', '--time', '10', state['container'], capture_output=True, timeout=20)
        except (subprocess.SubprocessError, ValueError, KeyError):
            pass
        raise
    finally:
        atomic_json(statefile, state)
    print('Prepared:', statefile)


def download(args):
    # Only public map extracts, never routing queries or customer coordinates.
    address = urllib.parse.urlsplit(args.url)
    if address.scheme != 'https' or address.netloc != 'download.geofabrik.de' or not address.path.startswith('/asia/') or not address.path.endswith('.osm.pbf') or address.query or address.fragment:
        raise ValueError('Use an HTTPS Asia .osm.pbf extract from download.geofabrik.de')
    destination = args.download_to
    if destination is None:
        raise ValueError('--download-to is required')
    partial = destination.with_suffix(destination.suffix + '.partial')
    if destination.exists() or partial.exists():
        raise ValueError('Download target/partial already exists; choose another output filename')
    with urllib.request.urlopen(args.url + '.md5', timeout=30) as response:
        expected = response.read(4096).decode('ascii').split()[0].lower()
    if not re.fullmatch('[0-9a-f]{32}', expected):
        raise ValueError('Publisher checksum malformed')
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.md5()
    start = time.monotonic(); count = 0
    with urllib.request.urlopen(args.url, timeout=60) as response, partial.open('xb') as stream:
        modified = response.headers.get('Last-Modified')
        for block in iter(lambda: response.read(1024 * 1024), b''):
            if time.monotonic() - start > args.stage_timeout:
                raise TimeoutError('Download budget exceeded; partial retained')
            stream.write(block); digest.update(block); count += len(block)
            if count % (64 * 1024 * 1024) == 0: print('Downloaded MiB:', count // (1024 * 1024), flush=True)
    if digest.hexdigest() != expected:
        raise ValueError('Publisher checksum mismatch; partial retained, not used')
    os.replace(partial, destination)
    atomic_json(destination.with_suffix('.download.json'), {'url':args.url,'publisherMD5':expected,'sha256':sha(destination),'bytes':count,'lastModified':modified,'downloadedAt':datetime.now(timezone.utc).isoformat()})
    print('Downloaded and verified:', destination)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'download', 'prepare', 'start', 'status', 'stop'])
    parser.add_argument('--data', type=Path, default=Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'STCT' / 'osrm-china')
    parser.add_argument('--pbf', type=Path)
    parser.add_argument('--url', default='https://download.geofabrik.de/asia/china-latest.osm.pbf')
    parser.add_argument('--download-to', type=Path)
    parser.add_argument('--pbf-sha256')
    parser.add_argument('--dataset-date')
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--stage-timeout', type=int, default=21600)
    parser.add_argument('--port', type=int, default=5001)
    args = parser.parse_args(argv)
    if args.action == 'doctor':
        return doctor()
    if args.threads < 1 or args.stage_timeout < 1:
        raise ValueError('Threads and timeout must be positive')
    if args.action == 'download':
        return download(args)
    if args.action == 'prepare':
        if not args.pbf: raise ValueError('--pbf is required')
        return prepare(args)
    state = json.loads((args.data / 'stct-osrm.json').read_text(encoding='utf-8'))
    if args.action == 'status':
        info = owned(state)
        print(json.dumps({'state': info['State'], 'ports': info['NetworkSettings']['Ports'], 'dataset': state}, indent=2))
    elif args.action == 'stop':
        info = owned(state)
        docker('stop', '--time', '10', info['Id'], timeout=30)
        print('Stopped owned OSRM only; dataset retained')
    elif args.action == 'start':
        if state.get('image') != IMAGE:
            raise ValueError('Prepared image does not match this pinned tool version')
        if state['status'] != 'PREPARED' or not state.get('artifacts'):
            raise ValueError('Dataset was not prepared successfully')
        free_port(args.port)
        for name, fingerprint in state['artifacts'].items():
            if Path(name).name != name or sha(args.data / name) != fingerprint['sha256']:
                raise ValueError('Routing artifact changed: ' + name)
        docker('run', '-d', '--rm', '--name', state['container'], '--label', OWNER + '=' + state['owner'],
               '--publish', f'127.0.0.1:{args.port}:5000', '--mount',
               f'type=bind,source={args.data.resolve()},target=/data,readonly', state['image'],
               'osrm-routed', '--algorithm', 'mld', '--max-table-size', '100', '/data/network.osrm')
        print(f'Container started at http://127.0.0.1:{args.port}; use status and a sample matrix to verify readiness')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, KeyError) as error:
        print('BLOCKED:', error, file=sys.stderr)
        sys.exit(1)
