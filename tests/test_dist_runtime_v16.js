#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const sourceRoot = path.resolve(__dirname, "..");
const distRoot = process.argv[2] ? path.resolve(process.argv[2]) : "";
const browserEvidence = process.argv[3] ? path.resolve(process.argv[3]) : "";
const outputPath = process.argv[4] ? path.resolve(process.argv[4]) : "";
if (!distRoot || !fs.statSync(distRoot, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write("Usage: node tests/test_dist_runtime_v16.js <extracted-dist-root> [browser-evidence.json]\n");
  process.exit(2);
}

const checks = [];
function check(id, condition, detail = "") { assert(condition, `${id}${detail ? `: ${detail}` : ""}`); checks.push(id); }
function runTest(relativePath) {
  const result = spawnSync(process.execPath, [relativePath], { cwd: distRoot, encoding: "utf8", env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  assert.strictEqual(result.status, 0, `${relativePath}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function copy(relativePath) {
  const destination = path.join(distRoot, relativePath); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(sourceRoot, relativePath), destination);
}

try {
  const manifest = fs.readFileSync(path.join(distRoot, "SHA256SUMS.txt"), "utf8").trim().split("\n");
  check("T614", manifest.length > 0 && manifest.every((line) => /^[a-f0-9]{64}  \.\//.test(line)));
  check("T615", !manifest.some((line) => line.endsWith("./SHA256SUMS.txt")));
  const names = fs.readdirSync(distRoot, { recursive: true }).map(String);
  check("T609", !names.some((name) => /(^|\/)\.git(\/|$)/.test(name)));
  check("T610", !names.some((name) => /7-eleven|laiyifen|工作簿/i.test(name)));
  check("T611", !names.some((name) => /audit/i.test(name)));

  [
    "tests/test_routing_provider_v16.js",
    "tests/test_road_routing_v16.js",
    "tests/test_rolling_reoptimization_v16.js",
    "tests/test_execution_twin_v16.js",
    "tests/test_execution_recovery_v16.js",
    "tests/test_fallback_v16.js",
    "tests/fixtures/rolling-v16-fixture.js",
  ].forEach(copy);
  const provider = runTest("tests/test_routing_provider_v16.js");
  check("T617", /"status": "PASS"/.test(provider));
  const road = runTest("tests/test_road_routing_v16.js");
  check("T619", /"status": "PASS"/.test(road));
  const full = runTest("tests/test_rolling_reoptimization_v16.js");
  check("T617-full", /"status": "PASS"/.test(full));
  const execution = runTest("tests/test_execution_twin_v16.js");
  check("T620", /"status": "PASS"/.test(execution));
  const recovery = runTest("tests/test_execution_recovery_v16.js");
  check("T621", /"status": "PASS"/.test(recovery));
  const fallback = runTest("tests/test_fallback_v16.js");
  check("T618", /"fullReoptimization": "SKIPPED_DEPENDENCY"/.test(fallback) && /"externalCoordinateRequests": 0/.test(fallback));
  if (browserEvidence) {
    const evidence = JSON.parse(fs.readFileSync(browserEvidence, "utf8"));
    check("T617-browser", evidence.status === "PASS" && evidence.checks.length === 61);
  }
  const result = { status: "PASS", checks: checks.length, ids: checks, distRoot };
  if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"); }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
} finally {
  fs.rmSync(path.join(distRoot, "tests"), { recursive: true, force: true });
  fs.rmSync(path.join(distRoot, "optimizer", "__pycache__"), { recursive: true, force: true });
}
