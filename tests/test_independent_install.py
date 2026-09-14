import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts/manage_extensions.py"
if not SOURCE.exists():
    SOURCE = ROOT / "release/manage_extensions.py"
spec = importlib.util.spec_from_file_location("manage_extensions", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IndependentInstallTests(unittest.TestCase):
    def test_only_selected_extensions_and_profile_are_passed_to_cli(self):
        manager = module.ExtensionManager(ROOT, "cursor", "Writing")
        commands = manager.commands("uninstall", ["jump", "file-actions", "jump"])
        self.assertEqual(commands, [
            ["cursor", "--profile", "Writing", "--uninstall-extension", "damln.jump"],
            ["cursor", "--profile", "Writing", "--uninstall-extension", "damln.file-actions"],
        ])
        self.assertRaises(ValueError, manager.commands, "uninstall", ["unrelated"])

    def test_current_packages_have_verified_checksums(self):
        manager = module.ExtensionManager(ROOT)
        commands = manager.commands("install", list(manager.entries))
        self.assertEqual(5, len(commands))
        self.assertTrue(all(command[:2] == ["code", "--install-extension"] for command in commands))

    def test_tampered_or_escaping_package_is_rejected_before_install(self):
        manager = module.ExtensionManager(ROOT)
        manager.entries["jump"] = dict(manager.entries["jump"], sha256="0" * 64)
        self.assertRaisesRegex(ValueError, "Checksum mismatch", manager.commands, "install", ["jump"])
        manager.entries["jump"]["package"] = "../outside.vsix"
        self.assertRaisesRegex(ValueError, "inside dist", manager.commands, "install", ["jump"])

    def test_no_cross_extension_dependencies_or_configuration_defaults(self):
        for path in (ROOT / "extensions").glob("*/package.json"):
            package = json.loads(path.read_text())
            self.assertFalse(package.get("extensionDependencies"), path)
            self.assertFalse(package.get("extensionPack"), path)
            self.assertFalse(package["contributes"].get("configurationDefaults"), path)
        theme = json.loads((ROOT / "extensions/minimal-theme/package.json").read_text())
        self.assertNotIn("main", theme)
        self.assertNotIn("activationEvents", theme)

    def test_uninstall_all_skips_missing_packages_and_preserves_unrelated_extensions(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(stdout="damln.jump\nother.extension\n")
        with patch.object(module.subprocess, "run", side_effect=run), patch.object(module, "__file__", str(ROOT / "scripts/manage_extensions.py")), patch("sys.argv", ["manage_extensions.py", "uninstall", "--all"]):
            self.assertEqual(0, module.main())
        self.assertEqual(calls, [["code", "--list-extensions"], ["code", "--uninstall-extension", "damln.jump"]])


if __name__ == "__main__":
    unittest.main()
