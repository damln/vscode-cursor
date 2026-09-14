#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

from audit_cache import DependencyAuditCache
from build_extension import ExtensionPackageBuilder


def load_versions(workspace_root: Path) -> tuple[str, str, str]:
    config = json.loads(
        (workspace_root / "config/versions.json").read_text(encoding="utf-8")
    )
    tool_entries = {entry["name"]: entry for entry in config["tools_version"]}
    tools = {
        name: entry["version_needed"] for name, entry in tool_entries.items()
    }
    node_image = tool_entries["node"].get("docker_image")
    if not isinstance(node_image, str) or "@sha256:" not in node_image:
        raise RuntimeError("tools_version/node must define a digest-pinned docker_image")
    return node_image, tools["corepack"], tools["pnpm"]


def compile_webview(vscode_root: Path) -> None:
    standalone = (vscode_root / "config/versions.json").is_file()
    workspace_root = vscode_root if standalone else vscode_root.parents[1]
    node_image, corepack_version, pnpm_version = load_versions(workspace_root)
    extension_path = "/workspace/extensions/markdown-inline" if standalone else "/workspace/apps/vscode/extensions/markdown-inline"
    audit_cache = DependencyAuditCache(vscode_root)
    lockfile = vscode_root / "extensions/markdown-inline/pnpm-lock.yaml"
    audit_required = not audit_cache.is_verified(
        "markdown-inline-production", lockfile
    )
    commands = [
        f"npm install --global corepack@{corepack_version} >/dev/null",
        f"corepack prepare pnpm@{pnpm_version} --activate >/dev/null",
        "pnpm install --frozen-lockfile",
        "pnpm run check",
        "pnpm test",
        "pnpm run build:webview",
    ]
    if audit_required:
        commands.append("pnpm audit --prod --audit-level high")
    command = " && ".join(commands)
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{workspace_root}:/workspace",
            "-v",
            "/workspace/.pnpm-store",
            "-v",
            f"{extension_path}/node_modules",
            "-w",
            extension_path,
            node_image,
            "sh",
            "-lc",
            command,
        ],
        check=True,
    )
    if audit_required:
        audit_cache.record_verified("markdown-inline-production", lockfile)
    else:
        print("Dependency audit verified by unchanged Markdown Inline lockfile hash.")


def update_lock(vscode_root: Path, package_path: Path, builder: ExtensionPackageBuilder) -> None:
    lock_path = vscode_root / "extensions.lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    extension_id = f"{builder.package['publisher']}.{builder.package['name']}"
    entry = next(item for item in lock["extensions"] if item["id"] == extension_id)
    entry["version"] = builder.package["version"]
    entry["package"] = package_path.relative_to(vscode_root).as_posix()
    entry["sha256"] = hashlib.sha256(package_path.read_bytes()).hexdigest()
    temporary = lock_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    temporary.replace(lock_path)


def main() -> int:
    vscode_root = Path(__file__).resolve().parents[1]
    compile_webview(vscode_root)
    builder = ExtensionPackageBuilder(vscode_root, "markdown-inline")
    destination = vscode_root / "dist" / builder.archive_name()
    builder.build(destination)
    update_lock(vscode_root, destination, builder)
    print(f"Built {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
