#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const resultDir = path.resolve(process.argv[2] || "/tmp/stct-v17-results");
const deliveryDir = path.resolve(process.argv[3] || "/Users/gz/Documents/STCT-v1.7-operational-truth-multi-vehicle-execution-20260831");
const sources = [
  path.join(resultDir, "baseline.json"), path.join(resultDir, "execution.json"), path.join(resultDir, "offline.json"), path.join(resultDir, "telemetry.json"), path.join(resultDir, "multi-vehicle.json"), path.join(resultDir, "domain.json"), path.join(resultDir, "capsule.json"), path.join(resultDir, "performance.json"), path.join(resultDir, "shift-review.json"), path.join(resultDir, "browser", "browser-report.json"), path.join(deliveryDir, "STCT-v1.7-TRACEABILITY.json"), path.join(deliveryDir, "STCT-v1.7-DELIVERY-GATE.json"),
];
function parse(file) { const value = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(value.assertions) ? value.assertions : []; }
const assertions = sources.flatMap(parse); const ids = assertions.map((row) => row.requirementId); const assertionIds = assertions.map((row) => row.assertionId); const expected = Array.from({ length: 674 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`); const missing = expected.filter((id) => !ids.includes(id)); const extra = ids.filter((id) => !expected.includes(id)); const duplicateRequirements = ids.filter((id, index) => ids.indexOf(id) !== index); const duplicateAssertions = assertionIds.filter((id, index) => assertionIds.indexOf(id) !== index); const invalid = assertions.filter((row) => !row.assertionId || row.status !== "PASS" || row.observed === undefined || row.expected === undefined || !row.evidence);
const suites = fs.readFileSync(path.join(resultDir, "suites.tsv"), "utf8").trim().split("\n").filter(Boolean).map((line) => { const [name, status, exitCode, evidence] = line.split("\t"); return { name, status, exitCode: Number(exitCode), evidence }; });
const status = missing.length || extra.length || duplicateRequirements.length || duplicateAssertions.length || invalid.length || suites.some((suite) => suite.status === "FAIL" || suite.exitCode !== 0) ? "FAIL" : "PASS";
const report = { schemaVersion: "stct-v17-test-summary-v1.7", status, exactAssertionCount: assertions.length, exactRequirementCount: new Set(ids).size, expectedRequirementCount: 674, missing, extra, duplicateRequirements: [...new Set(duplicateRequirements)], duplicateAssertions: [...new Set(duplicateAssertions)], invalidAssertions: invalid.map((row) => row.assertionId || row.requirementId), suites, assertions, boundaries: ["SEMANTIC_REGISTRY_NOT_LEXICAL_COUNT", "LOCAL_SYNTHETIC_NOT_PRODUCTION", "PHYSICAL_IPHONE_BLOCKED_MEASUREMENT"] };
fs.mkdirSync(deliveryDir, { recursive: true }); fs.writeFileSync(path.join(deliveryDir, "STCT-v1.7-TEST_SUMMARY.json"), `${JSON.stringify(report, null, 2)}\n`); fs.writeFileSync(path.join(resultDir, "STCT-v1.7-TEST_SUMMARY.json"), `${JSON.stringify(report, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ status, exactAssertionCount: report.exactAssertionCount, exactRequirementCount: report.exactRequirementCount, missing: missing.length, extra: extra.length, duplicateRequirements: report.duplicateRequirements.length }, null, 2)}\n`); process.exit(status === "PASS" ? 0 : 1);
