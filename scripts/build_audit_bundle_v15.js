#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Redaction = require("../audit-redaction-v15.js");

const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.join(os.tmpdir(), `lospollos-v1.5-audit-redacted-${Date.now()}`);
const projectRoot = path.resolve(__dirname, "..");
const textExtensions = new Set([".csv", ".diff", ".html", ".js", ".json", ".log", ".md", ".patch", ".py", ".sh", ".sha256", ".sql", ".svg", ".toml", ".tsv", ".txt", ".xml", ".yaml", ".yml"]);
const binaryExtensions = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const excludedExtensions = new Set([".gz", ".tar", ".xls", ".xlsx", ".zip"]);
const excludedDirectories = new Set([".git", ".claude", "node_modules", "source-baseline"]);
const context = { projectRoot, evidenceRoot: sourceRoot, localHome: os.homedir() };

if (!sourceRoot || !fs.statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("Usage: node scripts/build_audit_bundle_v15.js <evidence-dir> [output-dir]\n");
  process.exit(2);
}
if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("Output directory must be outside the evidence source.");

function copyTree(directory, relative = "") {
  fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
    .forEach((entry) => {
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) return;
      const sourcePath = path.join(directory, entry.name);
      const relativePath = path.join(relative, entry.name);
      const destinationPath = path.join(outputRoot, relativePath);
      if (entry.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        copyTree(sourcePath, relativePath);
        return;
      }
      if (!entry.isFile()) return;
      const extension = path.extname(entry.name).toLowerCase();
      if (excludedExtensions.has(extension)) return;
      if (!textExtensions.has(extension) && !binaryExtensions.has(extension)) return;
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      if (textExtensions.has(extension)) fs.writeFileSync(destinationPath, Redaction.redactText(fs.readFileSync(sourcePath, "utf8"), context), "utf8");
      else fs.copyFileSync(sourcePath, destinationPath);
    });
}

function listFiles(directory, relative = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
    .flatMap((entry) => {
      const childRelative = path.join(relative, entry.name);
      const childPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(childPath, childRelative);
      return entry.isFile() ? [childRelative.split(path.sep).join("/")] : [];
    });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
copyTree(sourceRoot);

fs.writeFileSync(path.join(outputRoot, "PATH_REDACTION_MAP.md"), `# Path Redaction Map

- Project checkout absolute path -> \`<PROJECT_ROOT>\`
- Evidence-source absolute path -> \`<EVIDENCE_ROOT>\`
- User home path -> \`<USER_HOME>\`
- Identity fields such as user, username, owner, and account -> \`<LOCAL_USER>\`
- macOS per-user runtime directory -> \`<RUNTIME_ROOT>\`
- Other temporary paths -> \`<TEMP_ROOT>\`

Identity-field redaction is content-based and does not depend on the current OS username. The source directory is not modified. Workbooks and archives are excluded.
`, "utf8");
fs.writeFileSync(path.join(outputRoot, "README-REPLAY.md"), `# STCT v1.5 Audit Evidence Replay

This is a redacted evidence copy, not the authoritative source directory.

Verify from inside the directory:

\`\`\`bash
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

The manifest uses relative paths and excludes itself. Source code, dependencies, customer workbooks, and delivery archives are not included by this builder.
`, "utf8");

for (const relativePath of listFiles(outputRoot)) {
  const filePath = path.join(outputRoot, relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  if (textExtensions.has(extension)) {
    const scan = Redaction.scanText(buffer.toString("utf8"));
    if (scan.status !== "PASS") throw new Error(`Redaction scan failed for ${relativePath}: ${JSON.stringify(scan)}`);
  } else {
    const content = buffer.toString("latin1");
    const match = Redaction.PATH_FORBIDDEN.find((pattern) => pattern.test(content));
    if (match) throw new Error(`Binary redaction scan failed for ${relativePath}: ${match}`);
  }
}

const manifestFiles = listFiles(outputRoot).filter((relativePath) => relativePath !== "SHA256SUMS.txt");
const manifest = manifestFiles.map((relativePath) => `${sha256(path.join(outputRoot, relativePath))}  ./${relativePath}`).join("\n");
fs.writeFileSync(path.join(outputRoot, "SHA256SUMS.txt"), `${manifest}\n`, "utf8");
manifestFiles.forEach((relativePath) => {
  const expected = manifest.split("\n").find((line) => line.endsWith(`  ./${relativePath}`)).slice(0, 64);
  if (sha256(path.join(outputRoot, relativePath)) !== expected) throw new Error(`Manifest verification failed: ${relativePath}`);
});

process.stdout.write(`AUDIT_BUNDLE=${outputRoot}\nFILE_COUNT=${manifestFiles.length + 1}\nPATH_SCAN=PASS\nIDENTITY_SCAN=PASS\nMANIFEST_STATUS=PASS\n`);
