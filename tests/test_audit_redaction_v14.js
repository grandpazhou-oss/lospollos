#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const source = fs.mkdtempSync(path.join(os.tmpdir(), "lospollos-v1.4-audit-source-"));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "stct-redacted-parent-"));
const bundle = path.join(output, "bundle");
const protectedFile = path.join(source, "evidence.txt");
const localUser = os.userInfo().username;
const protectedContent = `project=${root}\nevidence=${source}\nurl=file://${root}/index.html\nuser=${localUser}\nhome=/home/${localUser}/work\nmarkers=/Users/ /home/ file:///Users\nruntime=/private/var/folders/aa/bb/T/stct-run/evidence.json\ntemp=/tmp/stct-v14-check/output.txt\n`;
fs.writeFileSync(protectedFile, protectedContent, "utf8");
fs.writeFileSync(path.join(source, "safe.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x67, 0x7a, 0x00, 0xff]));
fs.writeFileSync(path.join(source, "change.patch"), "--- /Users/gz/old\n+++ /tmp/new\n", "utf8");
fs.writeFileSync(path.join(source, "change.sha256"), "abc  /Users/gz/change.patch\n", "utf8");
fs.writeFileSync(path.join(source, "excluded.xlsx"), "not-a-real-workbook /Users/gz", "utf8");
fs.mkdirSync(path.join(source, "source-baseline"));
fs.writeFileSync(path.join(source, "source-baseline", "secret.txt"), "do not copy", "utf8");

const run = spawnSync(process.execPath, [path.join(root, "scripts", "build_audit_bundle_v14.js"), source, bundle], { encoding: "utf8" });
assert.strictEqual(run.status, 0, run.stderr || run.stdout);
assert.strictEqual(fs.readFileSync(protectedFile, "utf8"), protectedContent);
assert(!fs.existsSync(path.join(bundle, "excluded.xlsx")));
assert(!fs.existsSync(path.join(bundle, "source-baseline")));
assert(fs.existsSync(path.join(bundle, "safe.png")));
assert(fs.existsSync(path.join(bundle, "change.patch")));
assert(fs.existsSync(path.join(bundle, "change.sha256")));
const redacted = fs.readFileSync(path.join(bundle, "evidence.txt"), "utf8");
for (const marker of ["/Users/", "/home/", "/tmp/", "/private/var/folders/", "file:///Users", `user=${localUser}`]) assert(!redacted.includes(marker), marker);
for (const marker of ["<PROJECT_ROOT>", "<EVIDENCE_ROOT>", "file://<PROJECT_ROOT>", "<LOCAL_USER>", "<RUNTIME_ROOT>", "<TEMP_ROOT>"]) assert(redacted.includes(marker), marker);
for (const required of ["PATH_REDACTION_MAP.md", "README-REPLAY.md", "SHA256SUMS.txt"]) assert(fs.existsSync(path.join(bundle, required)), required);
const manifest = fs.readFileSync(path.join(bundle, "SHA256SUMS.txt"), "utf8");
assert(!manifest.includes("SHA256SUMS.txt"));
assert([...manifest.matchAll(/  (.+)$/gm)].every((match) => match[1].startsWith("./")));

const leakSource = fs.mkdtempSync(path.join(os.tmpdir(), "lospollos-v1.4-audit-binary-leak-"));
const leakBundle = path.join(output, "leak-bundle");
fs.writeFileSync(path.join(leakSource, "leak.png"), Buffer.from("PNG /Users/gz/private"));
const leakRun = spawnSync(process.execPath, [path.join(root, "scripts", "build_audit_bundle_v14.js"), leakSource, leakBundle], { encoding: "utf8" });
assert.notStrictEqual(leakRun.status, 0);
assert.match(leakRun.stderr, /Redaction scan failed for leak\.png/);

process.stdout.write(`${JSON.stringify({ status: "PASS", sourcePreserved: true, pathScan: "PASS", manifest: "PASS", output: bundle }, null, 2)}\n`);
fs.rmSync(source, { recursive: true, force: true });
fs.rmSync(leakSource, { recursive: true, force: true });
fs.rmSync(output, { recursive: true, force: true });
