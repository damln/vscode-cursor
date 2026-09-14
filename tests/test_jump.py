import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_jump import JumpPackageBuilder


class DamlnJumpTests(unittest.TestCase):
    def setUp(self):
        self.extension_root = ROOT / "extensions/jump"
        self.package = json.loads(
            (self.extension_root / "package.json").read_text(encoding="utf-8")
        )

    def test_owns_extension_without_changing_command_ids(self):
        self.assertEqual("damln", self.package["publisher"])
        self.assertEqual("jump", self.package["name"])
        commands = {
            command["command"]
            for command in self.package["contributes"]["commands"]
        }
        self.assertEqual(
            {
                "jump-extension.jump-to-the-start-of-a-word",
                "jump-extension.jump-to-the-end-of-a-word",
                "jump-extension.select-to-the-start-of-a-word",
                "jump-extension.select-to-the-end-of-a-word",
                "jump-extension.exit",
            },
            commands,
        )

    def test_preserves_mit_license(self):
        license_text = (self.extension_root / "LICENSE").read_text(encoding="utf-8")
        self.assertIn("Copyright (c) 2021-Present Wenfang Du", license_text)
        self.assertIn("The above copyright notice and this permission notice", license_text)

    def test_uses_only_damln_branding_in_public_metadata(self):
        readme = (self.extension_root / "README.md").read_text(encoding="utf-8")
        self.assertIn("# Damln Jump", readme)
        self.assertEqual("https://github.com/damln/vscode-cursor.git", self.package["repository"]["url"])
        self.assertEqual("images/icon.png", self.package["icon"])
        self.assertTrue((self.extension_root / "assets/icon.svg").is_file())

    def test_builds_installable_vsix(self):
        builder = JumpPackageBuilder(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            output = builder.build(Path(directory) / builder.archive_name())
            with zipfile.ZipFile(output) as archive:
                manifest = json.loads(archive.read("extension/package.json"))
                self.assertEqual("damln", manifest["publisher"])
                self.assertEqual("jump", manifest["name"])
                self.assertIn("extension/out/extension.js", archive.namelist())
                self.assertIn("extension/LICENSE.txt", archive.namelist())


if __name__ == "__main__":
    unittest.main()
