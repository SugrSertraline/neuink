"""No downloads, model calls or modifications to installed environments."""
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("component_builder", Path(__file__).with_name("build-research-component.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class DependencyTests(unittest.TestCase):
    def verify(self, extras=(), version="1.0"):
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory)
            (resources / "requirements.txt").write_text("example.package==1.0\n")
            packages = [("example_package", version), ("deerflow-harness", builder.LOCK["engine_version"]),
                        ("deerflow-extension-api", "0.2.9"), ("pip", "25.0"), *extras]
            distributions = [types.SimpleNamespace(metadata={"Name": name}, version=value) for name, value in packages]
            with patch.object(builder, "RESOURCES", resources), patch.object(builder.importlib.metadata, "distributions", return_value=distributions):
                builder.verify_dependencies(resources)

    def test_clean_locked_environment_accepts_normalized_names(self):
        self.verify()

    def test_unrelated_packages_cannot_enter_archive(self):
        with self.assertRaisesRegex(RuntimeError, "Unpinned.*unused-package"):
            self.verify([("unused-package", "1.0")])

    def test_stale_duplicate_and_wrong_versions_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            self.verify([("example-package", "0.9")])
        with self.assertRaisesRegex(RuntimeError, "mismatch"):
            self.verify(version="0.9")


if __name__ == "__main__":
    unittest.main()
