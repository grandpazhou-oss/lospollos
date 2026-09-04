#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Redaction = require("../audit-redaction-v15.js");

const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.join(os.tmpdir(), `lospollos-v1.6-audit-${Date.now()}`);
const projectRoot = path.resolve(__dirname, "..");
const textExtensions = new Set([".csv", ".diff", ".html", ".js", ".json", ".log", ".md", ".patch", ".py", ".sh", ".sha256", ".sql", ".svg", ".toml", ".tsv", ".txt", ".xml", ".yaml", ".yml"]);
const binaryExtensions = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const excludedExtensions = new Set([".gz", ".tar", ".xls", ".xlsx", ".zip"]);
const excludedDirectories = new Set([".git", ".claude", "node_modules", "source-baseline", "__pycache__"]);
const context = { projectRoot, evidenceRoot: sourceRoot, localHome: os.homedir() };

if (!sourceRoot || !fs.statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("Usage: node scripts/build_audit_bundle_v16.js <evidence-stage> [output-dir]\n");
  process.exit(2);
}
if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("Output directory must be outside the evidence stage.");

function copyTree(directory, relative = "") {
  fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))).forEach((entry) => {
    if (entry.isSymbolicLink() || (entry.isDirectory() && excludedDirectories.has(entry.name))) return;
    const sourcePath = path.join(directory, entry.name);
    const relativePath = path.join(relative, entry.name);
    const destinationPath = path.join(outputRoot, relativePath);
    if (entry.isDirectory()) { fs.mkdirSync(destinationPath, { recursive: true }); copyTree(sourcePath, relativePath); return; }
    if (!entry.isFile()) return;
    const extension = path.extname(entry.name).toLowerCase();
    if (excludedExtensions.has(extension) || (!textExtensions.has(extension) && !binaryExtensions.has(extension))) return;
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (textExtensions.has(extension)) fs.writeFileSync(destinationPath, Redaction.redactText(fs.readFileSync(sourcePath, "utf8"), context), "utf8");
    else fs.copyFileSync(sourcePath, destinationPath);
  });
}
function listFiles(directory, relative = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))).flatMap((entry) => {
    const childRelative = path.join(relative, entry.name); const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(childPath, childRelative);
    return entry.isFile() ? [childRelative.split(path.sep).join("/")] : [];
  });
}
function sha256(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function scanSecrets(content) { return /(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/.test(content); }

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
copyTree(sourceRoot);
fs.writeFileSync(path.join(outputRoot, "PATH_REDACTION_MAP.md"), `# Path Redaction Map\n\n- Project checkout -> \`<PROJECT_ROOT>\`\n- Evidence stage -> \`<EVIDENCE_ROOT>\`\n- User home -> \`<USER_HOME>\`\n- Local identity -> \`<LOCAL_USER>\`\n- Runtime directory -> \`<RUNTIME_ROOT>\`\n- Temporary directory -> \`<TEMP_ROOT>\`\n\nThe source stage is not modified. Workbooks and archives are excluded.\n`, "utf8");

for (const relativePath of listFiles(outputRoot)) {
  const filePath = path.join(outputRoot, relativePath); const extension = path.extname(relativePath).toLowerCase(); const buffer = fs.readFileSync(filePath);
  if (textExtensions.has(extension)) {
    const content = buffer.toString("utf8"); const scan = Redaction.scanText(content, context);
    if (scan.status !== "PASS") throw new Error(`Path redaction scan failed for ${relativePath}: ${JSON.stringify(scan)}`);
    if (scanSecrets(content)) throw new Error(`Secret scan failed for ${relativePath}`);
  } else {
    const content = buffer.toString("latin1"); const match = Redaction.PATH_FORBIDDEN.find((pattern) => pattern.test(content));
    if (match || scanSecrets(content)) throw new Error(`Binary scan failed for ${relativePath}`);
  }
}

const manifestFiles = listFiles(outputRoot).filter((relativePath) => relativePath !== "SHA256SUMS.txt");
const manifest = manifestFiles.map((relativePath) => `${sha256(path.join(outputRoot, relativePath))}  ./${relativePath}`).join("\n");
fs.writeFileSync(path.join(outputRoot, "SHA256SUMS.txt"), `${manifest}\n`, "utf8");
manifestFiles.forEach((relativePath) => {
  const expected = manifest.split("\n").find((line) => line.endsWith(`  ./${relativePath}`)).slice(0, 64);
  if (sha256(path.join(outputRoot, relativePath)) !== expected) throw new Error(`Manifest verification failed: ${relativePath}`);
});
process.stdout.write(`AUDIT_BUNDLE=${outputRoot}\nFILE_COUNT=${manifestFiles.length + 1}\nPATH_SCAN=PASS\nSECRET_SCAN=PASS\nMANIFEST_STATUS=PASS\n`);
