"""Build-time only: assemble a pinned, relocatable Windows research component.

The shipped app extracts this archive; end users never run pip or need Python.
Run with Python 3.12 on Windows. --from-environment reuses a version-checked build
environment; normal builds install the same lock into the standalone interpreter.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[3]
RESOURCES = ROOT / "apps/desktop/resources/research"
LOCK = json.loads((RESOURCES / "component-lock.json").read_text())
OUTPUT = ROOT / "apps/desktop/src-tauri/resources/research-component"
CACHE = ROOT / "target/research-component-build"


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def download(url, checksum, name):
    path = CACHE / name
    if not path.exists() or digest(path) != checksum:
        request = urllib.request.Request(url, headers={"User-Agent": "NeuInk-component-builder"})
        with urllib.request.urlopen(request, timeout=120) as response, path.open("wb") as output:
            shutil.copyfileobj(response, output)
    if digest(path) != checksum:
        raise RuntimeError("Source checksum mismatch: " + name)
    return path


def verify_dependencies(site):
    expected = dict(line.strip().split("==") for line in (RESOURCES / "requirements.txt").read_text().splitlines() if line.strip())
    expected.update({"deerflow-harness": LOCK["engine_version"], "deerflow-extension-api": "0.2.9"})
    normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
    actual = {}
    for distribution in importlib.metadata.distributions(path=[str(site)]):
        name = normalize(distribution.metadata["Name"])
        if name in actual:
            raise RuntimeError("Duplicate build dependency: " + name)
        actual[name] = distribution.version
    for name, version in expected.items():
        if actual.get(normalize(name)) != version:
            raise RuntimeError("Build dependency mismatch: " + name)
    # Reused developer environments must not silently ship unrelated packages.
    # Bootstrap packaging tools are supplied by the standalone interpreter.
    unexpected = set(actual) - {normalize(name) for name in expected} - {"pip", "setuptools", "wheel"}
    if unexpected:
        raise RuntimeError("Unpinned build dependencies; use a clean environment: " + ", ".join(sorted(unexpected)))


def build(environment=None):
    if sys.platform != "win32" or sys.version_info[:2] != (3, 12):
        raise RuntimeError("Build this Windows component with Python 3.12; this is not an end-user prerequisite.")
    CACHE.mkdir(parents=True, exist_ok=True)
    source_zip = download(LOCK["source_url"], LOCK["source_sha256"], "deerflow-source.zip")
    python_tar = download(LOCK["python_url"], LOCK["python_sha256"], "python.tar.gz")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="assembly-", dir=CACHE) as temporary:
        work = Path(temporary)
        with zipfile.ZipFile(source_zip) as archive:
            upstream = work / "upstream"
            for entry in archive.infolist():
                relative = entry.filename.partition("/")[2]
                if entry.is_dir() or not (relative == "LICENSE" or relative.startswith("backend/packages/")):
                    continue
                target = upstream / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
        package = work / "component"
        package.mkdir()
        with tarfile.open(python_tar) as archive:
            archive.extractall(package, filter="data")
        python = package / "python/python.exe"
        site = package / "python/Lib/site-packages"
        if environment:
            from_site = Path(environment).resolve() / "Lib/site-packages"
            verify_dependencies(from_site)
            # Do not overlay two pip/dependency versions: stale modules can survive.
            if site.exists():
                if not site.resolve().is_relative_to(package.resolve()):
                    raise RuntimeError("Assembly path escaped temporary package")
                shutil.rmtree(site)
            shutil.copytree(from_site, site, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "direct_url.json"))
        else:
            subprocess.run([str(python), "-I", "-m", "pip", "install", "--disable-pip-version-check",
                            "--no-input", "--no-compile", "-r", str(RESOURCES / "requirements.txt"),
                            str(upstream / "backend/packages/extension-api"),
                            str(upstream / "backend/packages/harness")], check=True)
        verify_dependencies(site)
        # Original project/runtime/dependency license files remain in the package.
        licenses = package / "licenses"
        licenses.mkdir()
        shutil.copyfile(upstream / "LICENSE", licenses / "DeerFlow-LICENSE")
        packages = sorted(({"name": d.metadata["Name"], "version": d.version,
                            "license": d.metadata.get("License-Expression") or d.metadata.get("License", "See distribution metadata")}
                           for d in importlib.metadata.distributions(path=[str(site)])), key=lambda d: d["name"])
        (licenses / "distributions.json").write_text(json.dumps(packages, ensure_ascii=False, indent=2), encoding="utf-8")
        (package / "source-lock.json").write_text(json.dumps(LOCK, indent=2), encoding="utf-8")
        # Ignore machine-wide Python, user site packages and inherited PYTHONPATH.
        subprocess.run([str(python), "-I", str(RESOURCES / "runner.py")], input='{"action":"check"}\n',
                       text=True, encoding="utf-8", check=True, cwd=work,
                       env={**os.environ, "PYTHONNOUSERSITE": "1", "PYTHONPATH": ""})
        archive_path = OUTPUT / "component.zip"
        pending = work / "component.zip"
        files = {}
        with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(package.rglob("*")):
                if path.is_file() and "__pycache__" not in path.parts and path.name != "direct_url.json":
                    name = path.relative_to(package).as_posix()
                    files[name] = digest(path)
                    archive.write(path, name)
        manifest = {**LOCK, "sha256": digest(pending), "size": pending.stat().st_size,
                    "unpacked_size": sum(p.stat().st_size for p in package.rglob("*") if p.is_file()), "files": files}
        os.replace(pending, archive_path)
        staged_manifest = work / "manifest.json"
        staged_manifest.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(staged_manifest, OUTPUT / "manifest.json")
        print(json.dumps({"component": LOCK["component_id"], "files": len(files), "bytes": manifest["size"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-environment")
    build(parser.parse_args().from_environment)
