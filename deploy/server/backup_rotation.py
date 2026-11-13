#!/usr/bin/env python3
"""Run from deployment directory; retain seven daily and four weekly verified sets."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import backup

NAME = re.compile(r"^backup-(\d{8}T\d{6}Z)-[0-9a-f]{8}$")

def retained(names):
    days, weeks, keep = set(), set(), set()
    for name in sorted(names, reverse=True):
        match = NAME.fullmatch(name)
        if not match:
            continue
        date = datetime.strptime(match[1], "%Y%m%dT%H%M%SZ")
        day, week = date.date(), date.isocalendar()[:2]
        daily = day not in days and len(days) < 7
        weekly = week not in weeks and len(weeks) < 4
        if daily or weekly:
            keep.add(name)
        days.add(day)
        weeks.add(week)
    return keep

def verified_sets(root):
    found = []
    for path in root.iterdir():
        if not NAME.fullmatch(path.name):
            continue
        if path.is_symlink() or not path.is_dir():
            raise RuntimeError("Backup set is not a regular directory")
        # Incomplete or damaged sets are retained for investigation, never pruned.
        try:
            backup.verify(path)
            found.append(path.name)
        except (OSError, ValueError, KeyError, RuntimeError):
            continue
    return found

def prune(root, names, keep):
    root = root.resolve(strict=True)
    for name in names:
        if name in keep:
            continue
        if not NAME.fullmatch(name):
            raise RuntimeError("Invalid managed backup name")
        target = root / name
        if target.is_symlink() or target.resolve(strict=True).parent != root:
            raise RuntimeError("Backup cleanup escaped managed root")
        backup.verify(target)
        shutil.rmtree(target)

def write_status(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o644)  # Sanitized operational state, never backup content.
    os.replace(temporary, path)

def main():
    import fcntl
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--project', required=True)
    parser.add_argument('--db-uuid', required=True)
    parser.add_argument('--files-uuid', required=True)
    parser.add_argument('--status', type=Path)
    parser.add_argument('--initialize', action='store_true')
    args = parser.parse_args()
    if args.root.is_symlink():
        raise RuntimeError('Backup root must not be a symbolic link')
    root = args.root.resolve(strict=True)
    marker = root / '.neuink-backup-set'
    if args.initialize:
        if any(root.iterdir()):
            raise RuntimeError('Initialize only an empty managed backup directory')
        marker.write_text(args.project, encoding='utf-8')
        return
    if marker.is_symlink() or marker.read_text(encoding='utf-8') != args.project:
        raise RuntimeError('Backup root is not initialized for this deployment')
    with (root / '.rotation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        compose = ['docker', 'compose', '-p', args.project]
        now = datetime.now(timezone.utc)
        status = {'last_attempt': now.isoformat(), 'state': 'running'}
        path = args.status or root / 'status.json'
        if path.is_symlink() or not path.parent.is_dir():
            raise RuntimeError('Status requires an existing regular parent directory')
        if path.exists():
            status['last_success'] = json.loads(path.read_text(encoding='utf-8')).get('last_success')
        write_status(path, status)
        try:
            config = backup.configuration(compose, args.db_uuid, args.files_uuid)
            backup.outside_storage(root, config)
            destination = root / ('backup-' + now.strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(4))
            backup.backup(compose, config, destination)
            names = verified_sets(root)
            prune(root, names, retained(names))
            status.update(state='succeeded', last_success=datetime.now(timezone.utc).isoformat())
        except Exception:
            status['state'] = 'failed'
            raise
        finally:
            write_status(path, status)

if __name__ == '__main__':
    main()
