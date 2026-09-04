#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Capsule = require("../scenario-capsule-v15.js");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
if (!inputPath || !outputPath) fail("Usage: build_capsule_zip_v15.js /path/input.stct.json /path/output.stct-capsule.zip");
if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) fail("Capsule input file does not exist.");
if (fs.existsSync(outputPath)) fail("Capsule output already exists; refusing to overwrite.");

const source = fs.readFileSync(inputPath, "utf8");
const validation = Capsule.validateCapsuleStructure(source);
if (validation.status !== "PASS") fail(`${validation.error.code}: ${validation.error.message}`);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stct-capsule-v15-"));
const folderName = "stct-scenario-capsule";
const staging = path.join(temporaryRoot, folderName);
try {
  fs.mkdirSync(staging, { recursive: true });
  const capsulePath = path.join(staging, "scenario.stct.json");
  const metadataPath = path.join(staging, "CAPSULE_MANIFEST.json");
  fs.writeFileSync(capsulePath, Capsule.serializeCapsule(validation.capsule));
  fs.writeFileSync(metadataPath, `${JSON.stringify({
    schemaVersion: Capsule.SCHEMA_VERSION,
    capsuleHash: validation.capsule.capsuleHash,
    dataClassification: validation.capsule.dataClassification,
    files: ["scenario.stct.json"],
    externalResources: false,
    autoApply: false,
  }, null, 2)}\n`);
  const entries = ["CAPSULE_MANIFEST.json", "scenario.stct.json"];
  fs.writeFileSync(path.join(staging, "SHA256SUMS.txt"), `${entries.map((name) => `${sha256(path.join(staging, name))}  ./${name}`).join("\n")}\n`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const zip = spawnSync("zip", ["-q", "-r", outputPath, folderName], { cwd: temporaryRoot, encoding: "utf8" });
  if (zip.status !== 0) fail(zip.stderr || "zip command failed.");
  process.stdout.write(`${JSON.stringify({ status: "PASS", outputPath, capsuleHash: validation.capsule.capsuleHash, manifestEntries: entries.length }, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
