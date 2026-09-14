const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const SCRIPT_DIRECTORY = "skills/shared/custom/custom-cli-tools/scripts";
const TIMEOUT_MS = 120000;

function findTextImprover(workspaceFolders, documentUri, trusted) {
  if (!trusted || documentUri.scheme !== "file") return null;
  for (const { uri } of workspaceFolders || []) {
    if (uri.scheme !== "file") continue;
    const directory = path.join(uri.fsPath, SCRIPT_DIRECTORY);
    try {
      if (fs.statSync(path.join(directory, "apps")).isFile() &&
          fs.statSync(path.join(directory, "text-improver/main.py")).isFile()) {
        return { script: path.join(directory, "apps"), cwd: uri.fsPath };
      }
    } catch {}
  }
  return null;
}

function runTextImprover(tool, filePath, { signal, timeout = TIMEOUT_MS, execute = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execute("python3", [
      tool.script, "text-improver", filePath,
      "--provider", "codex",
      "--timeout", String(timeout / 1000),
    ], {
      cwd: tool.cwd, encoding: "utf8", timeout, killSignal: "SIGKILL", signal,
      maxBuffer: 1024 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = error.name === "AbortError" ? "Text improvement cancelled."
          : error.killed ? `Text improvement timed out after ${timeout / 1000} seconds.`
          : String(stderr || error.message).trim().slice(0, 1000);
        reject(new Error(detail));
      } else if (!stdout.trim()) reject(new Error("Text improver returned an empty response."));
      else resolve(stdout);
    });
  });
}

module.exports = { findTextImprover, runTextImprover };
