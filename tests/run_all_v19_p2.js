#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const suites = [];

function run(file) {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  const parsed = JSON.parse(result.stdout);
  suites.push({ file, status: parsed.status, checks: parsed.checks, assertions: parsed.assertions });
  return parsed;
}

const p1 = run("run_all_v19_p1.js");
const official = run("test_platform_navigation_v19.js");
const supplemental = run("test_platform_navigation_adversarial_v19.js");
const officialIds = Array.from({ length: 76 }, (_, index) => `T${String(index + 107).padStart(4, "0")}`);
const supplementalIds = Array.from({ length: 154 }, (_, index) => `P2X-${String(index + 1).padStart(3, "0")}`);
const officialRows = new Map(official.assertions.map((row) => [row.requirementId, row]));
const supplementalRows = new Map(supplemental.assertions.map((row) => [row.requirementId, row]));

assert.strictEqual(p1.requiredPassed, 62, "P1 T0045-T0106 regression must remain 62/62");
assert.strictEqual(p1.additionalAdversarialPassed, 15, "P1 adversarial regression must remain 15/15");
assert(officialIds.every((id) => officialRows.get(id)?.status === "PASS"), "P2 official requirements must be 76/76");
assert(supplementalIds.every((id) => supplementalRows.get(id)?.status === "PASS"), "P2X-001-P2X-154 must pass before protection closure");

const summary = {
  schemaVersion: "stct-v1.9-p2-test-summary-v1",
  status: "PASS_PENDING_PROTECTION_CLOSURE",
  gate: "Platform Gate P2",
  p1Regression: { official: "62/62 PASS", adversarial: "15/15 PASS" },
  p2Official: { range: "T0107-T0182", passed: 76, total: 76 },
  p2SupplementalCore: { range: "P2X-001-P2X-154", passed: 154, total: 154 },
  p2ProtectionClosure: { range: "P2X-155-P2X-174", status: "PENDING_EXTERNAL_EVIDENCE_CLOSURE" },
  suites: suites.map(({ file, status, checks }) => ({ file, status, checks })),
  assertions: [...official.assertions, ...supplemental.assertions].filter((row) => /^(?:T\d{4}|P2X-\d{3})$/.test(row.requirementId)),
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1 && process.argv[outputIndex + 1]) fs.writeFileSync(process.argv[outputIndex + 1], `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
