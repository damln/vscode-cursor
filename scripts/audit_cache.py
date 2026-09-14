from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


class DependencyAuditCache:
    def __init__(self, vscode_root: Path) -> None:
        self.vscode_root = vscode_root.resolve()
        self.path = self.vscode_root / "release/security-audits.json"

    @staticmethod
    def lockfile_sha256(lockfile: Path) -> str:
        return hashlib.sha256(lockfile.read_bytes()).hexdigest()

    def load(self) -> dict:
        return json.loads(self.path.read_text(encoding="utf-8"))

    def is_verified(self, name: str, lockfile: Path) -> bool:
        entry = self.load().get("audits", {}).get(name, {})
        return (
            entry.get("lockfileSha256") == self.lockfile_sha256(lockfile)
            and entry.get("result") == "no-known-vulnerabilities"
        )

    def record_verified(self, name: str, lockfile: Path) -> None:
        data = self.load()
        data.setdefault("audits", {})[name] = {
            "lockfileSha256": self.lockfile_sha256(lockfile),
            "result": "no-known-vulnerabilities",
            "auditedAt": datetime.now(timezone.utc).date().isoformat(),
        }
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        temporary.replace(self.path)
