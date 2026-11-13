import json
from pathlib import Path
import tempfile
import unittest
import backup


class BackupValidation(unittest.TestCase):
    def fixture(self, root):
        (root / "files").mkdir()
        (root / "files" / "data").write_bytes(b"example attachment")
        (root / "database.dump").write_bytes(b"example database")
        manifest = {"version": 1, "database_sha256": backup.digest(root / "database.dump"),
                    "files": backup.inventory(root / "files"), "app_image": "test", "db_image": "test"}
        (root / "manifest.json").write_text(json.dumps(manifest))
        return manifest

    def test_valid_backup_and_tampered_attachment(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            backup.verify(root)
            (root / "files" / "data").write_bytes(b"changed")
            with self.assertRaises(RuntimeError):
                backup.verify(root)

    def test_tls_private_material_is_verified_without_printing_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.fixture(root)
            (root / "tls").mkdir()
            (root / "tls" / "server.key").write_bytes(b"isolated test only")
            manifest.update(version=2, tls=backup.inventory(root / "tls"))
            (root / "manifest.json").write_text(json.dumps(manifest))
            backup.verify(root)
            (root / "tls" / "server.key").write_bytes(b"changed")
            with self.assertRaises(RuntimeError):
                backup.verify(root)

    def test_database_corruption_and_traversal_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.fixture(root)
            (root / "database.dump").write_bytes(b"changed")
            with self.assertRaises(RuntimeError):
                backup.verify(root)
            manifest["files"]["../escape"] = "x"
            (root / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaises(RuntimeError):
                backup.verify(root)

    def test_backup_cannot_be_nested_inside_active_storage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = {"db": root / "db", "app": root / "files"}
            for path in (root, root / "files", root / "files" / "backup"):
                with self.assertRaises(RuntimeError):
                    backup.outside_storage(path, config)
            backup.outside_storage(root / "backups" / "one", config)


if __name__ == "__main__":
    unittest.main()
