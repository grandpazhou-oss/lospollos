#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const files = [
  "test_platform_shell_v19.js",
  "test_workspace_router_v19.js",
  "test_workspace_deep_links_v19.js",
  "test_legacy_routes_v19.js",
  "test_route_lifecycle_v19.js",
];
const rows = [];
const suites = [];

for (const file of files) {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  const parsed = JSON.parse(result.stdout);
  suites.push({ file, status: parsed.status, checks: parsed.checks });
  rows.push(...parsed.assertions);
}

const required = Array.from({ length: 62 }, (_, index) => `T${String(index + 45).padStart(4, "0")}`);
const byRequirement = new Map(rows.filter((row) => /^T\d{4}$/.test(row.requirementId)).map((row) => [row.requirementId, row]));
const missing = required.filter((requirementId) => !byRequirement.has(requirementId));
const failed = required.filter((requirementId) => byRequirement.has(requirementId) && byRequirement.get(requirementId).status !== "PASS");
assert.strictEqual(missing.length, 0, `Missing P1 requirements: ${missing.join(", ")}`);
assert.strictEqual(failed.length, 0, `Failed P1 requirements: ${failed.join(", ")}`);

const summary = {
  schemaVersion: "stct-v1.9-p1-test-summary-v1",
  status: "PASS",
  gate: "Platform Gate P1",
  requiredRange: "T0045-T0106",
  requiredCount: required.length,
  requiredPassed: required.length,
  additionalAdversarialPassed: rows.filter((row) => row.requirementId.startsWith("ADV-") && row.status === "PASS").length,
  suites,
  assertions: rows,
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1 && process.argv[outputIndex + 1]) fs.writeFileSync(process.argv[outputIndex + 1], `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
