#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.join(os.tmpdir(), `lospollos-v1.4-audit-redacted-${Date.now()}`);
const projectRoot = path.resolve(__dirname, "..");
const localUser = os.userInfo().username;
const localHome = os.homedir();
const textExtensions = new Set([".csv", ".diff", ".html", ".js", ".json", ".log", ".md", ".patch", ".py", ".sh", ".sha256", ".sql", ".svg", ".toml", ".tsv", ".txt", ".xml", ".yaml", ".yml"]);
const binaryExtensions = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const excludedExtensions = new Set([".gz", ".tar", ".xls", ".xlsx", ".zip"]);
const excludedDirectories = new Set([".git", "node_modules", "source-baseline"]);

if (!sourceRoot || !fs.statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("Usage: node scripts/build_audit_bundle_v14.js <evidence-dir> [output-dir]\n");
  process.exit(2);
}
if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) {
  throw new Error("Output directory must be outside the evidence source.");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redact(content) {
  let result = content;
  const replacements = [
    [new RegExp(`file://${escapeRegex(projectRoot)}`, "g"), "file://<PROJECT_ROOT>"],
    [new RegExp(`file://${escapeRegex(sourceRoot)}`, "g"), "file://<EVIDENCE_ROOT>"],
    [new RegExp(escapeRegex(projectRoot), "g"), "<PROJECT_ROOT>"],
    [new RegExp(escapeRegex(sourceRoot), "g"), "<EVIDENCE_ROOT>"],
    [new RegExp(escapeRegex(localHome), "g"), "<USER_HOME>"],
    [/file:\/\/\/Users\/[^/\s"'<>]+/g, "file://<USER_HOME>"],
    [/\/Users\/[^/\s"'<>]+/g, "<USER_HOME>"],
    [/\/home\/[^/\s"'<>]+/g, "<USER_HOME>"],
    [/file:\/\/\/Users/g, "file://<USER_HOME>"],
    [/\/Users\//g, "<USER_HOME>/"],
    [/\/home\//g, "<USER_HOME>/"],
    [/\/tmp\/lospollos-v1\.4-[^\s"'<>]*/g, "<EVIDENCE_ROOT>"],
    [/\/(?:private\/)?var\/folders\/[^\s"'<>]*/g, "<RUNTIME_ROOT>"],
    [/\/tmp\/[^\s"'<>]*/g, "<TEMP_ROOT>"],
  ];
  replacements.forEach(([pattern, replacement]) => { result = result.replace(pattern, replacement); });
  if (localUser) result = result.replace(new RegExp(`\\b${escapeRegex(localUser)}\\b`, "g"), "<LOCAL_USER>");
  return result;
}

function safeSegment(segment) {
  return localUser && segment === localUser ? "LOCAL_USER" : segment;
}

function copyTree(directory, relative = "") {
  fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
    .forEach((entry) => {
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) return;
      const sourcePath = path.join(directory, entry.name);
      const relativePath = path.join(relative, safeSegment(entry.name));
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
      if (textExtensions.has(extension)) {
        fs.writeFileSync(destinationPath, redact(fs.readFileSync(sourcePath, "utf8")), "utf8");
      } else {
        fs.copyFileSync(sourcePath, destinationPath);
      }
    });
}

function listFiles(directory, relative = "") {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const childRelative = path.join(relative, entry.name);
    const childPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(childPath, childRelative));
    else if (entry.isFile()) files.push(childRelative.split(path.sep).join("/"));
  });
  return files.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
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
- Local user home path -> \`<USER_HOME>\`
- Local username token -> \`<LOCAL_USER>\`
- Local project file URL -> \`file://<PROJECT_ROOT>/...\`
- macOS per-user runtime directory -> \`<RUNTIME_ROOT>\`
- Other temporary paths -> \`<TEMP_ROOT>\`

The original evidence directory is not modified. Binary spreadsheets and archive files are deliberately excluded from this shareable audit copy.
`, "utf8");
fs.writeFileSync(path.join(outputRoot, "README-REPLAY.md"), `# Audit Evidence Replay

This directory is a redacted copy of local test evidence. It is not the authoritative source directory.

Verify integrity from inside this directory:

\`\`\`bash
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

Expected result: every listed relative path reports \`OK\`. The manifest excludes itself.

## Evidence map

- \`baseline/\`: frozen branch, worktree, environment, ports, original workbook hash, and F13 before evidence.
- \`diff/\`: full baseline-to-final patch, tracked Git diff, status, file inventory, and SHA-256.
- \`tests/{static,fallback,release,browser}/test-summary.json\`: four-state runner results.
- \`tests/dist-runtime/\`: random-extraction release and no-OR-Tools fallback smoke evidence.
- \`browser/evidence.json\`: desktop, mobile, no-WebGL, reduced-motion, i18n, interaction, engine, and console evidence.
- \`screenshots/\`: latest 16 browser acceptance screenshots.
- \`concepts/\`: selected desktop/mobile concepts and design contract.
- \`visual-ledger/VISUAL_MISMATCH_LEDGER.md\`: concept-to-render review and fixes.
- \`performance/\`: optimizer and Experience performance measurements.
- \`scenarios/\`: fully synthetic scenario and cross-language canonical fixtures only.

## Source replay

From a matching source checkout with Python, Node, Chrome, and OR-Tools 9.15.6755:

\`\`\`bash
tests/run_all_v14.sh --mode static
tests/run_all_v14.sh --mode release
tests/run_all_v14.sh --mode fallback
STCT_BROWSER_EVIDENCE=browser/evidence.json \\
STCT_EXPERIENCE_PERFORMANCE_EVIDENCE=performance/experience-performance.json \\
  tests/run_all_v14.sh --mode browser
\`\`\`

The audit copy does not contain source code, dependencies, the original customer workbook, or the clean distribution ZIP. The outer archive SHA-256 is distributed as a separate sidecar to avoid a self-referential hash.
`, "utf8");

const pathForbidden = [/\/Users\//, /\/home\//, /\/tmp\//, /\/(?:private\/)?var\/folders\//, /file:\/\/\/Users/];
const textForbidden = [...pathForbidden, new RegExp(`\\b${escapeRegex(localUser)}\\b`)];
const contentFiles = listFiles(outputRoot);
for (const relativePath of contentFiles) {
  const buffer = fs.readFileSync(path.join(outputRoot, relativePath));
  const isText = textExtensions.has(path.extname(relativePath).toLowerCase());
  const content = buffer.toString(isText ? "utf8" : "latin1");
  const match = (isText ? textForbidden : pathForbidden).find((pattern) => pattern.test(content));
  if (match) throw new Error(`Redaction scan failed for ${relativePath}: ${match}`);
}

const manifestFiles = listFiles(outputRoot).filter((relativePath) => relativePath !== "SHA256SUMS.txt");
const manifest = manifestFiles.map((relativePath) => `${sha256(path.join(outputRoot, relativePath))}  ./${relativePath}`).join("\n");
fs.writeFileSync(path.join(outputRoot, "SHA256SUMS.txt"), `${manifest}\n`, "utf8");
manifestFiles.forEach((relativePath) => {
  const expected = manifest.split("\n").find((line) => line.endsWith(`  ./${relativePath}`)).slice(0, 64);
  if (sha256(path.join(outputRoot, relativePath)) !== expected) throw new Error(`Manifest verification failed: ${relativePath}`);
});

process.stdout.write(`AUDIT_BUNDLE=${outputRoot}\nFILE_COUNT=${manifestFiles.length + 1}\nPATH_SCAN=PASS\nMANIFEST_STATUS=PASS\n`);
