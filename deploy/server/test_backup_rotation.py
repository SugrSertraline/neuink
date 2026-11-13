from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import unittest
import test_backup
import backup_rotation as rotation

class RotationValidation(unittest.TestCase):
    def test_keeps_seven_days_and_four_weeks_without_removing_incomplete_sets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = []
            for i in range(50):
                day = datetime(2026, 11, 10) - timedelta(days=i)
                name = 'backup-' + day.strftime('%Y%m%dT%H%M%SZ') + '-00000001'
                path = root / name
                path.mkdir()
                test_backup.BackupValidation().fixture(path)
                names.append(name)
            broken = root / 'backup-20260101T000000Z-00000001'
            broken.mkdir()
            found = rotation.verified_sets(root)
            keep = rotation.retained(found)
            self.assertTrue(set(names[:7]).issubset(keep))
            self.assertEqual(len({datetime.strptime(name[7:23], '%Y%m%dT%H%M%SZ').isocalendar()[:2] for name in keep}), 4)
            rotation.prune(root, found, keep)
            self.assertTrue(broken.exists())
            self.assertEqual(set(path.name for path in root.iterdir()), keep | {broken.name})
    def test_refuses_unmanaged_cleanup_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(RuntimeError):
                rotation.prune(Path(temporary), ['../escape'], set())

if __name__ == '__main__': unittest.main()
