import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('overlay', Path(__file__).with_name('package-admin-overlay.py'))
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class AdminOverlayTest(unittest.TestCase):
    def test_preserves_unrelated_runtime_and_adds_only_admin_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, candidate, output = (root / name for name in ['base.jar', 'candidate.jar', 'output.jar'])
            classes = ['AuthService', 'AdminService', 'AdminWeb', 'AuthController']
            with zipfile.ZipFile(base, 'w') as jar:
                for name in classes:
                    jar.writestr('BOOT-INF/classes/org/neuink/server/' + name + '.class', b'old')
                jar.writestr('BOOT-INF/lib/parser.jar', b'existing parsing runtime')
                jar.writestr('BOOT-INF/classes/db/migration/V9__parse_queue.sql', b'existing schema')
            with zipfile.ZipFile(candidate, 'w') as jar:
                for name in classes:
                    jar.writestr('BOOT-INF/classes/org/neuink/server/' + name + '.class', b'new')
                jar.writestr('BOOT-INF/lib/parser.jar', b'must not replace old dependency')
                jar.writestr('BOOT-INF/classes/db/migration/V10__login_observability.sql', b'new schema')
            digest = hashlib.sha256(base.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                overlay.package(base, candidate, output, '0' * 64)
            self.assertFalse(output.exists())
            overlay.package(base, candidate, output, digest)
            with zipfile.ZipFile(output) as jar:
                self.assertEqual(jar.read('BOOT-INF/lib/parser.jar'), b'existing parsing runtime')
                self.assertEqual(jar.read('BOOT-INF/classes/db/migration/V9__parse_queue.sql'), b'existing schema')
                self.assertEqual(jar.read('BOOT-INF/classes/org/neuink/server/AdminWeb.class'), b'new')
            with self.assertRaises(ValueError):
                overlay.package(base, candidate, output, digest)


if __name__ == '__main__':
    unittest.main()
