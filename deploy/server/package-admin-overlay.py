#!/usr/bin/env python3
"""Preserve a pinned deployed runtime while applying the tested admin change.

The deployed runtime has additional parsing/transport modules absent from the
alpha baseline. Do not replace its full jar with the baseline build.
"""
import argparse
import hashlib
import zipfile
from pathlib import Path


def package(base: Path, candidate: Path, output: Path, expected: str):
    if hashlib.sha256(base.read_bytes()).hexdigest() != expected:
        raise ValueError('Deployed base jar hash changed')
    if output.exists():
        raise ValueError('Refusing to overwrite an existing output')
    classes = {'AuthService.class', 'AdminService.class', 'AdminWeb.class', 'AuthController.class'}
    with zipfile.ZipFile(base) as old, zipfile.ZipFile(candidate) as new:
        selected = {name for name in new.namelist() if
                    name in {'BOOT-INF/classes/org/neuink/server/' + c for c in classes}
                    or name.startswith('BOOT-INF/classes/static/admin/')
                    or name in {'BOOT-INF/classes/db/migration/V10__login_observability.sql', 'BOOT-INF/classes/db/migration/V11__session_connection_metadata.sql'}}
        if not all('BOOT-INF/classes/org/neuink/server/' + c in selected for c in classes):
            raise ValueError('Missing admin class')
        with zipfile.ZipFile(output, 'x') as result:
            for entry in old.infolist():
                result.writestr(entry, new.read(entry.filename) if entry.filename in selected else old.read(entry.filename))
            for name in selected - set(old.namelist()):
                result.writestr(new.getinfo(name), new.read(name))
    with zipfile.ZipFile(base) as old, zipfile.ZipFile(output) as result:
        for name in old.namelist():
            if name not in selected and old.read(name) != result.read(name):
                raise ValueError('Unrelated runtime entry changed: ' + name)
    print('Admin overlay created; unrelated runtime entries preserved byte-for-byte')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['base', 'candidate', 'output']:
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--base-sha256', required=True)
    args = parser.parse_args()
    package(args.base, args.candidate, args.output, args.base_sha256)
