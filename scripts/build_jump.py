#!/usr/bin/env python3

import argparse
import json
import subprocess
import xml.sax.saxutils
import zipfile
from pathlib import Path

from audit_cache import DependencyAuditCache


class JumpPackageBuilder:
    TIMESTAMP = (1980, 1, 1, 0, 0, 0)

    def __init__(self, root):
        self.root = Path(root).resolve()
        self.extension_root = self.root / "extensions/jump"
        self.package = json.loads((self.extension_root / "package.json").read_text(encoding="utf-8"))

    def archive_name(self):
        return (
            f"{self.package['publisher']}.{self.package['name']}-"
            f"{self.package['version']}.vsix"
        )

    def compile(self):
        subprocess.run(
            ["npm", "ci", "--ignore-scripts", "--no-audit"],
            cwd=self.extension_root,
            check=True,
        )
        audit_cache = DependencyAuditCache(self.root)
        lockfile = self.extension_root / "package-lock.json"
        if audit_cache.is_verified("jump-production", lockfile):
            print("Dependency audit verified by unchanged Jump package-lock hash.")
        else:
            subprocess.run(
                ["npm", "audit", "--omit=dev", "--audit-level=high"],
                cwd=self.extension_root,
                check=True,
            )
            audit_cache.record_verified("jump-production", lockfile)
        subprocess.run(["npm", "run", "compile"], cwd=self.extension_root, check=True)

    def manifest(self):
        escape = xml.sax.saxutils.escape
        keywords = ",".join(self.package.get("keywords", []))
        categories = ",".join(self.package.get("categories", []))
        return f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{escape(self.package['name'])}" Version="{escape(self.package['version'])}" Publisher="{escape(self.package['publisher'])}" />
    <DisplayName>{escape(self.package['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(self.package['description'])}</Description>
    <Tags>{escape(keywords)},keybindings</Tags>
    <Categories>{escape(categories)}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(self.package['engines']['vscode'])}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/images/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/images/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
'''

    def content_types(self):
        return '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="gif" ContentType="image/gif"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="json" ContentType="application/json"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="png" ContentType="image/png"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>
'''

    def write_entry(self, archive, name, content):
        info = zipfile.ZipInfo(name, self.TIMESTAMP)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, content)

    def extension_files(self):
        files = {
            "package.json": self.extension_root / "package.json",
            "README.md": self.extension_root / "README.md",
            "LICENSE.txt": self.extension_root / "LICENSE",
        }
        for path in sorted((self.extension_root / "images").iterdir()):
            if path.is_file():
                files[path.relative_to(self.extension_root).as_posix()] = path
        for path in sorted((self.extension_root / "out").rglob("*.js")):
            if "test" not in path.parts:
                files[path.relative_to(self.extension_root).as_posix()] = path
        return files

    def build(self, destination):
        self.compile()
        destination = Path(destination).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            self.write_entry(archive, "extension.vsixmanifest", self.manifest().encode("utf-8"))
            self.write_entry(archive, "[Content_Types].xml", self.content_types().encode("utf-8"))
            for relative_path, source in self.extension_files().items():
                self.write_entry(archive, f"extension/{relative_path}", source.read_bytes())
        return destination


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Build the Damln Jump extension VSIX.")
    parser.add_argument("--output")
    args = parser.parse_args()

    builder = JumpPackageBuilder(root)
    destination = Path(args.output) if args.output else root / "dist" / builder.archive_name()
    output = builder.build(destination)
    print(f"Built {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
