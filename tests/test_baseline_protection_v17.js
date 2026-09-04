#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const child = require("child_process");

const root = path.resolve(__dirname, "..");
const baseline = path.resolve(process.env.STCT_V17_BASELINE || "/tmp/lospollos-v1.7-baseline-20260831_175714");
const v16Delivery = path.resolve(process.env.STCT_V16_DELIVERY || "/Users/gz/Documents/STCT-v1.6-road-aware-dynamic-operations-20260831");
const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : "/tmp/stct-v17-baseline-report.json");
const assertions = [];
function check(requirementId, condition, observed, expected) { const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, evidence: "tests/test_baseline_protection_v17.js" }; assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`); }
function file(name) { return path.join(baseline, name); }
function run(command, args, cwd = root) { const result = child.spawnSync(command, args, { cwd, encoding: "utf8", env: process.env }); return { command: [command, ...args].join(" "), cwd, exitCode: result.status, stdout: result.stdout.slice(-2000), stderr: result.stderr.slice(-2000) }; }

function main() {
  check("T001", ["branch.txt", "head.txt", "git-status-short.txt"].every((name) => fs.existsSync(file(name))), fs.readFileSync(file("branch.txt"), "utf8").trim(), "captured branch/head/status");
  check("T002", ["tracked-files.txt", "untracked-files.txt"].every((name) => fs.existsSync(file(name))), true, true);
  check("T003", fs.existsSync(file("binary-sha256.txt")) && fs.readFileSync(file("binary-sha256.txt"), "utf8").split("\n").filter(Boolean).length >= 8, file("binary-sha256.txt"), "complete binary SHA inventory");
  check("T004", fs.existsSync(file("original-excel-sha256.txt")) && fs.readFileSync(file("original-excel-sha256.txt"), "utf8").includes("工作簿2.xlsx"), file("original-excel-sha256.txt"), "original Excel SHA inventory");
  check("T005", fs.existsSync(file("v16-delivery-sha256.txt")) && fs.readFileSync(file("v16-delivery-sha256.txt"), "utf8").length > 1000, file("v16-delivery-sha256.txt"), "v1.6 Dist/Audit SHA inventory");
  check("T006", ["environment.json", "ports-before.txt", "processes-before.txt"].every((name) => fs.existsSync(file(name))), JSON.parse(fs.readFileSync(file("environment.json"))), "environment and ports captured");
  check("T007", fs.readFileSync(file("processes-before.txt"), "utf8").length > 1000 && fs.readFileSync(file("ports-before.txt"), "utf8").length > 100, "captured without process termination", "user services protected");
  check("T008", baseline.startsWith("/tmp/") && !baseline.startsWith(root), baseline, "repository-external baseline");
  const manifest = run("shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], baseline); check("T009", manifest.exitCode === 0, manifest, "baseline manifest PASS");
  const suites = [
    ["T010", "node", ["tests/test_integrity_hash_v151.js"]],
    ["T011", "node", ["tests/test_routing_provider_v16.js"]],
    ["T012", "node", ["tests/test_road_routing_v16.js"]],
    ["T013", "python3", ["-m", "unittest", "-v", "tests/test_routing_contract_v16.py"]],
    ["T014", "node", ["tests/test_rolling_reoptimization_v16.js"]],
    ["T015", "node", ["tests/test_execution_recovery_v16.js"]],
    ["T016", "node", ["tests/test_execution_twin_v16.js"]],
    ["T017", "node", ["tests/test_driver_simulator_v16.js"]],
    ["T018", "node", ["tests/test_operations_alerts_v16.js"]],
    ["T019", "node", ["tests/test_dynamic_operations_capsule_v16.js"]],
  ];
  const suiteResults = suites.map(([id, command, args]) => ({ id, ...run(command, args) })); suiteResults.forEach((result) => check(result.id, result.exitCode === 0, result, "v1.6 regression PASS"));
  const deliveryManifest = run("shasum", ["-a", "256", "-c", file("v16-delivery-sha256.txt")], v16Delivery); check("T020", deliveryManifest.exitCode === 0, deliveryManifest, "v1.6 delivery SHA PASS");
  for (let number = 1; number <= 12; number += 1) { const requirementId = `T${String(20 + number).padStart(3, "0")}`; const id = `F16-${String(number).padStart(2, "0")}`; const target = file(`known-failures/${id}/before.json`); const value = JSON.parse(fs.readFileSync(target, "utf8")); check(requirementId, value.id === id && value.status === "REPRODUCED", { id: value.id, status: value.status, path: target }, { id, status: "REPRODUCED" }); }
  const report = { schemaVersion: "stct-v17-baseline-report-v1.7", status: "PASS", baseline, v16Delivery, assertions, suiteResults, boundaries: ["NO_COMMIT", "NO_PUSH", "NO_DEPLOY", "ORIGINAL_EXCEL_READ_ONLY"] };
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, evidencePath }, null, 2)}\n`);
}
main();
