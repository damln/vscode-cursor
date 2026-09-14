#!/usr/bin/env python3

import argparse
import json
import xml.sax.saxutils
import zipfile
from pathlib import Path

TIMESTAMP = (1980, 1, 1, 0, 0, 0)


class ExtensionPackageBuilder:
    def __init__(self, root: Path, extension_name: str):
        self.root = root.resolve()
        self.extension_root = (self.root / "extensions" / extension_name).resolve()
        if self.extension_root.parent != (self.root / "extensions").resolve():
            raise RuntimeError("extension name must be a direct child of extensions")
        self.package = json.loads(
            (self.extension_root / "package.json").read_text(encoding="utf-8")
        )

    def archive_name(self) -> str:
        return (
            f"{self.package['publisher']}.{self.package['name']}-"
            f"{self.package['version']}.vsix"
        )

    def manifest(self) -> str:
        escape = xml.sax.saxutils.escape
        categories = ",".join(self.package.get("categories", []))
        extension_kind = ",".join(self.package.get("extensionKind", []))
        dependencies = ",".join(self.package.get("extensionDependencies", []))
        return f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{escape(self.package['name'])}" Version="{escape(self.package['version'])}" Publisher="{escape(self.package['publisher'])}" />
    <DisplayName>{escape(self.package['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(self.package['description'])}</Description>
    <Categories>{escape(categories)}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(self.package['engines']['vscode'])}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="{escape(dependencies)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="{escape(extension_kind)}" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
'''

    @staticmethod
    def content_types() -> str:
        return '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".css" ContentType="text/css"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".json" ContentType="application/json"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
'''

    @staticmethod
    def write_entry(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
        info = zipfile.ZipInfo(name, TIMESTAMP)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, content)

    def package_files(self) -> list[tuple[Path, str]]:
        files = [(self.extension_root / "package.json", "package.json")]
        for value in self.package.get("files", []):
            source = (self.extension_root / value).resolve()
            if self.extension_root not in source.parents or not source.is_file():
                raise RuntimeError(f"invalid package file: {value}")
            files.append((source, Path(value).as_posix()))
        return files

    def build(self, destination: Path) -> Path:
        destination = destination.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(
            destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            self.write_entry(
                archive, "extension.vsixmanifest", self.manifest().encode("utf-8")
            )
            self.write_entry(
                archive, "[Content_Types].xml", self.content_types().encode("utf-8")
            )
            for source, relative in self.package_files():
                self.write_entry(archive, f"extension/{relative}", source.read_bytes())
        return destination


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Build a local VS Code extension.")
    parser.add_argument(
        "extension",
        choices=(
            "minimal-theme",
            "file-actions",
            "markdown-inline",
            "html-preview",
        ),
    )
    parser.add_argument("--output")
    args = parser.parse_args()
    builder = ExtensionPackageBuilder(root, args.extension)
    destination = (
        Path(args.output) if args.output else root / "dist" / builder.archive_name()
    )
    print(f"Built {builder.build(destination)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
