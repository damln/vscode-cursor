"""Install or uninstall only explicitly selected bundled extensions."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


class ExtensionManager:
    def __init__(self, root: Path, code: str = "code", profile: str | None = None):
        self.root = root.resolve()
        self.command = [code] + (["--profile", profile] if profile else [])
        manifest = json.loads((self.root / "extensions.lock.json").read_text())
        self.entries = {item["id"].removeprefix("damln."): item for item in manifest["extensions"] if "package" in item}

    def commands(self, action: str, names: list[str]) -> list[list[str]]:
        commands = []
        for name in dict.fromkeys(names):
            if name not in self.entries:
                raise ValueError(f"Unknown extension: {name}")
            entry = self.entries[name]
            if action == "uninstall":
                commands.append([*self.command, "--uninstall-extension", entry["id"]])
                continue
            package = (self.root / entry["package"]).resolve()
            if not package.is_relative_to(self.root / "dist"):
                raise ValueError("Package must be inside dist")
            if hashlib.sha256(package.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError(f"Checksum mismatch: {package.name}")
            commands.append([*self.command, "--install-extension", str(package)])
        return commands


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["list", "install", "uninstall"])
    parser.add_argument("extensions", nargs="*")
    parser.add_argument("--all", action="store_true", help="Select the five bundled extensions")
    parser.add_argument("--code", default="code", help="Editor CLI executable, e.g. code or cursor")
    parser.add_argument("--profile", help="Optional editor profile name")
    args = parser.parse_args()
    manager = ExtensionManager(Path(__file__).resolve().parents[1], args.code, args.profile)
    if args.action == "list":
        for name, entry in manager.entries.items():
            print(f"{name}: {entry['id']} {entry['version']}")
        return 0
    if args.all == bool(args.extensions):
        parser.error("Choose extension names OR --all explicitly")
    names = list(manager.entries) if args.all else args.extensions
    try:
        commands = manager.commands(args.action, names)
        if args.action == "uninstall":
            installed = subprocess.run(
                [*manager.command, "--list-extensions"], check=True, capture_output=True, text=True
            ).stdout.lower().splitlines()
            commands = [command for command in commands if command[-1].lower() in installed]
        for command in commands:
            subprocess.run(command, check=True)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Error: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
