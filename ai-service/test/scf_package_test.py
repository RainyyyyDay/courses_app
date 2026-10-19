import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('scf_package', Path(__file__).resolve().parents[1] / 'tools/scf_package.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='scf-package-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.good = self.root / 'good.zip'
        pack.build(pack.ROOT, self.good)

    def mutate(self, changes=None, remove=None, wrong_mode=False):
        target = self.root / 'bad.zip'
        with zipfile.ZipFile(self.good) as src, zipfile.ZipFile(target, 'w') as dst:
            for entry in src.infolist():
                if entry.filename == remove:
                    continue
                if wrong_mode and entry.filename == 'scf_bootstrap':
                    entry.external_attr = 0o100644 << 16
                dst.writestr(entry, (changes or {}).get(entry.filename, src.read(entry.filename)))
            for name, data in (changes or {}).items():
                if name not in src.namelist():
                    dst.writestr(name, data)
        return target

    def test_repeatable_and_production_dependencies_present(self):
        second = self.root / 'second.zip'
        pack.build(pack.ROOT, second)
        self.assertEqual(self.good.read_bytes(), second.read_bytes())
        self.assertGreater(pack.verify(self.good), 100)
        with zipfile.ZipFile(self.good) as archive:
            self.assertEqual(archive.getinfo('scf_bootstrap').external_attr >> 16, 0o100755)
            self.assertIn('node_modules/express/lib/application.js', archive.namelist())

    def test_forbidden_names_and_paths_are_rejected(self):
        for name in ['.env', 'src/.env.production', 'credentials.json', 'back/server.js',
                     '../escape.js', 'node_modules/express/test/private.js', 'local.db']:
            try:
                result = pack.allowed(name)
            except ValueError:
                result = False
            self.assertFalse(result, name)

    def test_env_entry_rejected_before_contents_are_read(self):
        bad = self.mutate({'.env': b'synthetic fixture'})
        original = zipfile.ZipFile.read
        def guarded(archive, name, *args, **kwargs):
            if name == '.env':
                self.fail('must not read env entry')
            return original(archive, name, *args, **kwargs)
        from unittest.mock import patch
        with patch.object(zipfile.ZipFile, 'read', guarded):
            with self.assertRaises(ValueError):
                pack.verify(bad)

    def test_missing_file_rejected(self):
        with self.assertRaises(ValueError):
            pack.verify(self.mutate(remove='src/scf-server.js'))

    def test_wrong_unix_permissions_rejected(self):
        with self.assertRaises(ValueError):
            pack.verify(self.mutate(wrong_mode=True))

    def test_tampered_source_rejected(self):
        with self.assertRaises(ValueError):
            pack.verify(self.mutate({'src/scf-server.js': b'tampered'}))

    def test_bad_bootstrap_encoding_and_commands_rejected(self):
        original = (pack.ROOT / 'scf_bootstrap').read_bytes()
        for bad in [original.replace(b'\n', b'\r\n'), b'\xef\xbb\xbf' + original,
                    original.rstrip(b'\n'), original.replace(b'node24', b'node22')]:
            with self.assertRaises(ValueError):
                pack.check_bootstrap(bad)

    def test_existing_output_is_not_overwritten(self):
        with self.assertRaises(FileExistsError):
            pack.build(pack.ROOT, self.good)

    def test_packaged_js_smoke_with_clean_environment(self):
        pack.smoke(self.good)


if __name__ == '__main__':
    unittest.main()
