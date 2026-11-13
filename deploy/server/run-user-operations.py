#!/usr/bin/env python3
"""Run a configured deployment operation as its unprivileged owner.

The config holds paths/UUIDs only. Keep it and this script on the home disk,
so boot retries can wait for the data disks without writing into mountpoints.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time


def run(config, operation):
    deployment = Path(config['deployment'])
    if not deployment.is_dir():
        raise RuntimeError('Deployment disk is not mounted')
    start = ['python3', str(deployment / 'start-mounted.py'), '--project', config['project'],
             '--db-mount', config['db_mount'], '--db-uuid', config['db_uuid'],
             '--attachment-mount', config['attachment_mount'], '--attachment-uuid', config['files_uuid']]
    # Validate every mount before a backup, certificate check or startup.
    subprocess.run(start + (['--check-only'] if operation == 'backup' else []), cwd=deployment, check=True)
    if operation == 'backup':
        subprocess.run(['python3', str(deployment / 'backup_rotation.py'), config['backups'],
                        '--project', config['project'], '--db-uuid', config['db_uuid'],
                        '--files-uuid', config['files_uuid'], '--status', config['status']], cwd=deployment, check=True)
    # Certificate expiry is explicit operational evidence, without printing keys.
    certificate = deployment / 'tls/server.crt'
    expiry = subprocess.run(['openssl','x509','-checkend',str(30*86400),'-noout','-in',str(certificate)],capture_output=True)
    if expiry.returncode:
        raise RuntimeError('TLS certificate expires within 30 days or cannot be inspected')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config',type=Path)
    parser.add_argument('operation',choices=['start','backup'])
    args=parser.parse_args()
    config=json.loads(args.config.read_text())
    attempts=30 if args.operation=='start' else 1
    for attempt in range(attempts):
        try:
            run(config,args.operation)
            print('Deployment operation succeeded',flush=True)
            return
        except (OSError,RuntimeError,subprocess.CalledProcessError):
            if attempt+1==attempts:
                raise RuntimeError('Deployment operation failed; inspect private operation log') from None
            time.sleep(60)

if __name__=='__main__':
    main()
