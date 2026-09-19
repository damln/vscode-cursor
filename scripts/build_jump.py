#!/usr/bin/env python3

import argparse
import subprocess
import xml.sax.saxutils
from pathlib import Path

from audit_cache import DependencyAuditCache
from build_extension import ExtensionPackageBuilder, build_to_output


class JumpPackageBuilder(ExtensionPackageBuilder):
    def __init__(self, root):
        super().__init__(Path(root), "jump")

    def prepare(self):
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

    @staticmethod
    def content_types():
        return '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="gif" ContentType="image/gif"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="json" ContentType="application/json"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="png" ContentType="image/png"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>
'''

    def package_files(self):
        files = [
            (self.extension_root / "package.json", "package.json"),
            (self.extension_root / "README.md", "README.md"),
            (self.extension_root / "LICENSE", "LICENSE.txt"),
        ]
        for path in sorted((self.extension_root / "images").iterdir()):
            if path.is_file():
                files.append((path, path.relative_to(self.extension_root).as_posix()))
        for path in sorted((self.extension_root / "out").rglob("*.js")):
            if "test" not in path.parts:
                files.append((path, path.relative_to(self.extension_root).as_posix()))
        return files


def main():
    parser = argparse.ArgumentParser(description="Build the Damln Jump extension VSIX.")
    parser.add_argument("--output")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    return build_to_output(JumpPackageBuilder(root), args.output)


if __name__ == "__main__":
    raise SystemExit(main())
