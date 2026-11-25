#!/usr/bin/env python3
"""Offline consistent backup and restore into an explicitly empty deployment.

Run from a configured compose deployment directory. Never overwrites a database.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys


def run(command, *, stdin=None, stdout=subprocess.PIPE):
    result = subprocess.run(command, stdin=stdin, stdout=stdout, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Deployment command failed; existing backup/data retained")
    return (result.stdout or b"").decode().strip() if stdout == subprocess.PIPE else ""


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def inventory(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError("Backup files root must be a real directory")
    files = {}
    for root, directories, names in os.walk(directory, followlinks=False):
        for name in directories + names:
            path = Path(root) / name
            if path.is_symlink():
                raise RuntimeError("Symbolic links are not accepted in server backup storage")
        for name in names:
            path = Path(root) / name
            if not path.is_file():
                raise RuntimeError("Only regular backup files are supported")
            files[path.relative_to(directory).as_posix()] = digest(path)
    return files


def verify(directory):
    if directory.is_symlink():
        raise RuntimeError("Backup root must not be a symbolic link")
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") not in (1, 2) or not isinstance(manifest.get("files"), dict):
        raise RuntimeError("Unsupported backup manifest")
    for name in manifest["files"]:
        parts = PurePosixPath(name)
        if parts.is_absolute() or ".." in parts.parts or "\\" in name or ":" in name:
            raise RuntimeError("Invalid backup path")
    if (directory / "database.dump").is_symlink() or digest(directory / "database.dump") != manifest["database_sha256"]:
        raise RuntimeError("Database backup checksum mismatch")
    if inventory(directory / "files") != manifest["files"]:
        raise RuntimeError("Attachment backup checksum mismatch")
    if manifest.get("tls") is not None and inventory(directory / "tls") != manifest["tls"]:
        raise RuntimeError("TLS backup checksum mismatch")
    return manifest


def configuration(compose, db_uuid, files_uuid):
    if not db_uuid or not files_uuid:
        raise RuntimeError("Expected database and attachment filesystem UUIDs are required")
    config = json.loads(run(compose + ["config", "--format", "json"]))
    result = {}
    for name, target in (("db", "/var/lib/postgresql/data"), ("app", "/data")):
        service = config["services"][name]
        mounts = [v for v in service.get("volumes", []) if v["target"] == target]
        if len(mounts) != 1 or mounts[0]["type"] != "bind":
            raise RuntimeError("Backup tool requires the explicit-bind deployment")
        path = Path(mounts[0]["source"])
        if not path.is_absolute() or not path.is_dir() or path.is_symlink():
            raise RuntimeError("Storage directory must already exist and must not be a symlink")
        result[name] = path.resolve()
        expected = db_uuid if name == "db" else files_uuid
        actual = run(["findmnt", "-rn", "-o", "UUID", "--target", str(result[name])])
        if actual.lower() != expected.lower():
            raise RuntimeError("Storage mount UUID mismatch")
        if name == "db" and run(["findmnt", "-rn", "-o", "FSTYPE", "--target", str(result[name])]) != "ext4":
            raise RuntimeError("Database storage must be ext4")
        result[name + "_image"] = run(["docker", "image", "inspect", "--format", "{{.Id}}", service["image"]])
    if result["db"] == result["app"] or result["db"] in result["app"].parents or result["app"] in result["db"].parents:
        raise RuntimeError("Database and attachments must use separate directories")
    tls = [v for v in config["services"]["app"].get("volumes", []) if v["target"] == "/tls"]
    if tls:
        if len(tls) != 1 or tls[0]["type"] != "bind":
            raise RuntimeError("TLS backup requires explicit bind storage")
        path = Path(tls[0]["source"])
        inventory(path)
        result["tls"] = path.resolve()
    return result


def outside_storage(path, config):
    resolved = path.resolve()
    for key in ("db", "app", "tls"):
        if key not in config:
            continue
        root = config[key]
        if resolved == root or root in resolved.parents or resolved in root.parents:
            raise RuntimeError("Backup destination overlaps active storage")


def backup(compose, config, destination):
    outside_storage(destination, config)
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    was_running = bool(run(compose + ["ps", "--status", "running", "-q", "app"]))
    try:
        if was_running:
            run(compose + ["stop", "--timeout", "30", "app"])
        # Validate file types before copying. No other administrative writers may run.
        inventory(config["app"])
        with (destination / "database.dump").open("xb") as output:
            run(compose + ["exec", "-T", "db", "pg_dump", "-U", "neuink", "-d", "neuink", "-Fc"], stdout=output)
            output.flush()
            os.fsync(output.fileno())
        shutil.copytree(config["app"], destination / "files")
        manifest = {"version": 2, "database_sha256": digest(destination / "database.dump"),
                    "files": inventory(destination / "files"), "app_image": config["app_image"], "db_image": config["db_image"]}
        if "tls" in config:
            shutil.copytree(config["tls"], destination / "tls")
            manifest["tls"] = inventory(destination / "tls")
        with (destination / "manifest.tmp").open("x", encoding="utf-8") as output:
            json.dump(manifest, output, ensure_ascii=False, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        (destination / "manifest.tmp").rename(destination / "manifest.json")
        verify(destination)
    finally:
        if was_running:
            run(compose + ["up", "-d", "app"])


def restore(compose, config, source):
    outside_storage(source, config)
    manifest = verify(source)
    if run(compose + ["ps", "--all", "-q"]):
        raise RuntimeError("Restore requires a new compose project without existing containers")
    for key in ("db", "app"):
        if any(config[key].iterdir()):
            raise RuntimeError("Restore refused: target storage is not empty")
        if config[key + "_image"] != manifest[key + "_image"]:
            raise RuntimeError("Restore must use the exact backed-up application/database images")
    if manifest.get("tls") is not None:
        if "tls" not in config or any(config["tls"].iterdir()):
            raise RuntimeError("TLS restore requires an explicitly empty TLS directory")
        shutil.copytree(source / "tls", config["tls"], dirs_exist_ok=True)
    shutil.copytree(source / "files", config["app"], dirs_exist_ok=True)
    run(compose + ["up", "-d", "--wait", "--wait-timeout", "120", "db"])
    with (source / "database.dump").open("rb") as dump:
        run(compose + ["exec", "-T", "db", "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "-U", "neuink", "-d", "neuink"], stdin=dump)
    # Old backup revisions must never be mistaken for the current server timeline.
    epoch = secrets.token_hex(32)
    statement = "UPDATE server_identity SET epoch='" + epoch + "'; UPDATE sessions SET revoked=TRUE;"
    run(compose + ["exec", "-T", "db", "psql", "-U", "neuink", "-d", "neuink", "-v", "ON_ERROR_STOP=1", "-c", statement])
    run(compose + ["up", "-d", "app"])


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "verify", "restore"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--project", default="neuink-sync")
    parser.add_argument("--db-uuid")
    parser.add_argument("--files-uuid")
    args = parser.parse_args()
    if args.action == "verify":
        verify(args.directory)
    else:
        compose = ["docker", "compose", "-p", args.project]
        config = configuration(compose, args.db_uuid, args.files_uuid)
        if args.action == "backup":
            backup(compose, config, args.directory)
        else:
            restore(compose, config, args.directory)
    print("Backup operation completed and verified")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError):
        print("Backup operation failed; existing data was not replaced. Inspect configuration and backup integrity.", file=sys.stderr)
        sys.exit(1)
