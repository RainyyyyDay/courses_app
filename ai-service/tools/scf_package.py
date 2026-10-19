"""Offline, deterministic ZIP builder/checker. Python standard library only.

No install, network, dotenv loading, cloud SDK, or source-directory recursion.
Unix mode in the archive is checked on Windows too; it is not a Linux runtime test.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import stat
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    'scf_bootstrap', 'package.json', 'package-lock.json',
    'config/classification.json', 'src/scf-server.js', 'src/scf-config.js',
    'src/config.js', 'src/app.js', 'src/diagnostics.js',
    'src/contracts/classification.js', 'src/providers/index.js',
    'src/providers/mock.js', 'src/providers/deepseek.js',
)
MANIFEST = 'scf-package-manifest.json'
BLOCKED = {'.git', 'test', 'tests', '__tests__', 'fixtures', 'examples', 'integration',
           'coverage', 'data', 'uploads', 'back', 'fronted', '.github', '__pycache__'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def allowed(name):
    parts = PurePosixPath(name).parts
    require(parts and PurePosixPath(name).as_posix() == name and not name.startswith('/') and '\\' not in name and
            all(p not in ('.', '..') for p in parts), 'Unsafe archive path')
    require(not any(p.lower() in BLOCKED or p.lower().startswith('.env') for p in parts),
            'Forbidden archive entry')
    leaf = parts[-1].lower()
    require(not any(word in leaf for word in ('credential', 'secret', 'token')),
            'Credential-like archive entry')
    require(Path(leaf).suffix not in ('.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key', '.pfx', '.node'),
            'Forbidden archive extension')
    return name in FILES or name == MANIFEST or (
        name.startswith('node_modules/') and
        (leaf.endswith(('.js', '.json')) or leaf.startswith(('license', 'licence', 'copying'))))


def check_bootstrap(data):
    require(data.startswith(b'#!/bin/bash\n') and b'\r' not in data and data.endswith(b'\n'),
            'Bootstrap must use LF, no BOM, shebang and final newline')
    require(data == b'#!/bin/bash\nset -eu\ncd /var/user\nexec /var/lang/node24/bin/node src/scf-server.js\n',
            'Unexpected bootstrap command')


def locked_packages(lock, package):
    require(lock.get('lockfileVersion') == 3, 'Expected lockfile v3')
    require(package.get('dependencies') == lock['packages']['']['dependencies'], 'Root dependencies differ from lock')
    result = {}
    for name, item in lock['packages'].items():
        if not name:
            continue
        require(name.startswith('node_modules/') and not item.get('dev') and
                not item.get('hasInstallScript') and not item.get('link'), 'Unsupported production dependency')
        result[name] = item['version']
    return result


def read_plain(file):
    require(not any(p.is_symlink() for p in (file, *file.parents)) and file.is_file(),
            'Required file missing or symlinked')
    return file.read_bytes()


def collect(root):
    result = {name: read_plain(root / name) for name in FILES}
    lock = json.loads(result['package-lock.json'])
    packages = locked_packages(lock, json.loads(result['package.json']))
    for folder, version in sorted(packages.items()):
        dep = root / folder
        # Never traverse symlinked roots/parents, nested dependencies are separate lock entries.
        require(all(not parent.is_symlink() for parent in (dep, *dep.parents) if parent != root.parent),
                'Symlinked dependency path')
        require(json.loads(read_plain(dep / 'package.json')).get('version') == version,
                'Installed dependency version differs from lock')
        for current, dirs, files in os.walk(dep, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d.lower() not in BLOCKED and
                             d != 'node_modules' and not d.startswith('.'))
            require(not any((Path(current) / d).is_symlink() for d in dirs), 'Symlinked dependency directory')
            for leaf in sorted(files):
                file = Path(current) / leaf
                name = file.relative_to(root).as_posix()
                # Ignore non-runtime/sensitive names BEFORE reading their contents.
                try:
                    include = allowed(name)
                except ValueError:
                    continue
                if include:
                    result[name] = read_plain(file)
    check_bootstrap(result['scf_bootstrap'])
    return result


def build(root, output):
    contents = collect(root)
    contents[MANIFEST] = json.dumps({
        'format': 1,
        'files': {n: hashlib.sha256(b).hexdigest() for n, b in sorted(contents.items())}
    }, sort_keys=True, separators=(',', ':')).encode() + b'\n'
    # Refuse overwrite: build output must be a new explicitly named file.
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(contents.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | (0o755 if name == 'scf_bootstrap' else 0o644)) << 16
            archive.writestr(entry, data)
    verify(output)


def verify(file):
    with zipfile.ZipFile(file) as archive:
        entries = archive.infolist()
        names = [e.filename for e in entries]
        require(len(names) == len(set(names)), 'Duplicate ZIP entries')
        require(set(FILES + (MANIFEST,)).issubset(names), 'Required files missing or not at ZIP root')
        require(all(allowed(n) for n in names), 'Entry outside runtime whitelist')
        require(sum(e.file_size for e in entries) < 64 * 1024 * 1024, 'Unexpected package size')
        for entry in entries:
            expected = 0o755 if entry.filename == 'scf_bootstrap' else 0o644
            require(entry.create_system == 3 and entry.external_attr >> 16 == stat.S_IFREG | expected,
                    'Invalid Unix file type or permissions')
        manifest = json.loads(archive.read(MANIFEST))
        require(manifest.get('format') == 1 and set(manifest['files']) == set(names) - {MANIFEST},
                'Manifest inventory mismatch')
        for name, digest in manifest['files'].items():
            require(hashlib.sha256(archive.read(name)).hexdigest() == digest, 'Package hash mismatch')
        check_bootstrap(archive.read('scf_bootstrap'))
        packages = locked_packages(json.loads(archive.read('package-lock.json')),
                                   json.loads(archive.read('package.json')))
        for folder, version in packages.items():
            require(json.loads(archive.read(folder + '/package.json')).get('version') == version,
                    'Packaged dependency version mismatch')
        for name in names:
            if name.startswith('node_modules/'):
                require(any(name.startswith(folder + '/') for folder in packages), 'Unlocked dependency')
    return len(names)


def smoke(file):
    """Run packaged JS with a clean environment. Does NOT execute Linux bootstrap."""
    verify(file)
    node = shutil.which('node')
    require(node is not None, 'Node 24 is required')
    with tempfile.TemporaryDirectory(prefix='scf-package-smoke-') as directory:
        with zipfile.ZipFile(file) as archive:
            archive.extractall(directory)
        env = {name: os.environ[name] for name in ('SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP')
               if name in os.environ}
        env.update({'AI_PROVIDER': 'mock', 'NODE_ENV': 'production'})
        child = subprocess.Popen([node, 'src/scf-server.js'], cwd=directory, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while True:
                require(child.poll() is None, 'Packaged process failed to start')
                connection = http.client.HTTPConnection('127.0.0.1', 9000, timeout=1)
                try:
                    connection.request('GET', '/health')
                    response = connection.getresponse()
                    body = json.loads(response.read())
                    require(response.status == 200 and body.get('mode') == 'scf-preparation' and
                            body.get('business_enabled') is False and body.get('provider') == 'mock',
                            'Unexpected packaged health response')
                    break
                except (OSError, http.client.HTTPException):
                    require(time.monotonic() < deadline, 'Packaged process did not become ready')
                    time.sleep(0.1)
                finally:
                    connection.close()
            # Ensure port 9000 belongs to this process, not a pre-existing service.
            time.sleep(0.1)
            require(child.poll() is None, 'Packaged process did not own the listening port')
            connection = http.client.HTTPConnection('127.0.0.1', 9000, timeout=2)
            try:
                connection.request('POST', '/api/ai/classify', '{}', {
                    'Content-Type': 'application/json', 'X-User-ID': 'forged', 'Authorization': 'Bearer forged'})
                response = connection.getresponse()
                require(response.status == 503 and json.loads(response.read()) ==
                        {'error': 'AI_AUTH_NOT_CONFIGURED'}, 'Packaged API must stay closed')
            finally:
                connection.close()
        finally:
            child.terminate()
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'verify', 'smoke'])
    parser.add_argument('zip', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'build':
            build(ROOT, args.zip)
        if args.command == 'smoke':
            smoke(args.zip)
            print('Packaged JS health and API-denial smoke test passed on this OS (not Linux bootstrap).')
        count = verify(args.zip)
        print(f'ZIP structure, hashes, whitelist and Unix modes verified: {count} files')
        print('Linux bootstrap execution and SCF runtime verification are still required.')
    except Exception:
        print('SCF package operation failed; check whitelist, dependencies, bootstrap and output path.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
