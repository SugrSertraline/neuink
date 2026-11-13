#!/usr/bin/env python3
"""Start an explicit-bind deployment only after verifying its storage mounts."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def output(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        # Compose output can contain expanded credentials; never echo it here.
        raise RuntimeError("Deployment configuration or mount inspection failed")
    return result.stdout.strip()


def verify_mount(directory, expected_uuid, database=False):
    path = Path(directory)
    if not path.is_absolute() or not path.is_dir():
        raise RuntimeError("The configured mount directory is missing")
    actual = output(["findmnt", "-rn", "-o", "UUID", "--mountpoint", str(path)])
    if actual.lower() != expected_uuid.lower():
        raise RuntimeError("Storage mount UUID does not match; startup refused")
    if database and output(["findmnt", "-rn", "-o", "FSTYPE", "--mountpoint", str(path)]) != "ext4":
        raise RuntimeError("This deployment requires an ext4 database mount")
    return path.resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--db-mount", required=True)
    parser.add_argument("--db-uuid", required=True)
    parser.add_argument("--attachment-mount", required=True)
    parser.add_argument("--attachment-uuid", required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    db = verify_mount(args.db_mount, args.db_uuid, database=True)
    attachments = verify_mount(args.attachment_mount, args.attachment_uuid)
    command = ["docker", "compose", "-p", args.project]
    config = json.loads(output(command + ["config", "--format", "json"]))
    for name, target, root, uuid in (
        ("db", "/var/lib/postgresql/data", db, args.db_uuid),
        ("app", "/data", attachments, args.attachment_uuid),
    ):
        service = config["services"][name]
        if service.get("restart", "no") != "no":
            raise RuntimeError("Container auto-restart would bypass the host mount checks")
        mounts = [v for v in service["volumes"] if v["target"] == target]
        # Compose omits false fields from its normalized JSON. A true value is
        # unsafe; the source must independently exist and match the mount below.
        if len(mounts) != 1 or mounts[0]["type"] != "bind" or mounts[0].get("bind", {}).get("create_host_path", False):
            raise RuntimeError("Storage must use an existing explicit bind directory")
        path = Path(mounts[0]["source"]).resolve(strict=True)
        if not path.is_dir() or path == root or root not in path.parents:
            raise RuntimeError("Storage directory is outside its dedicated mount")
        actual = output(["findmnt", "-rn", "-o", "UUID", "--target", str(path)])
        if actual.lower() != uuid.lower():
            raise RuntimeError("Storage directory resolves to a different filesystem")
    print("Storage mount checks passed", flush=True)
    if not args.check_only:
        subprocess.run(command + ["up", "-d", "--wait", "--wait-timeout", "120"], check=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print("Deployment stopped: " + (str(error) if isinstance(error, RuntimeError) else "configuration or startup failed"), file=sys.stderr)
        sys.exit(1)
