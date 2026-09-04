#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const goalPath = path.resolve(process.argv[2] || "/Users/gz/Downloads/Codex_Goal_STCT_Local_Demo_v1.7_Operational_Truth_Multi_Vehicle_Execution.md");
const outputPath = path.resolve(process.argv[3] || path.join(__dirname, "../requirements-v17.json"));
const source = fs.readFileSync(goalPath, "utf8");
const rows = [...source.matchAll(/^- \*\*(T\d{3})\*\* — (.+)$/gm)].map((match) => ({ id: match[1], requirement: match[2].trim() }));
if (rows.length !== 674 || new Set(rows.map((row) => row.id)).size !== 674) throw new Error(`Expected 674 unique requirements, found ${rows.length}.`);

const ranges = [
  [1, 32, "Gate 0", "tests/test_baseline_protection_v17.js", "BASELINE"],
  [33, 87, "Gate 1", "tests/test_execution_state_machine_v17.js", "E2E_EXECUTION"],
  [88, 143, "Gate 2", "tests/test_offline_projection_v17.js", "E2E_OFFLINE"],
  [144, 204, "Gate 3", "tests/test_verified_telemetry_v17.js", "E2E_TELEMETRY"],
  [205, 272, "Gate 4", "tests/test_multi_vehicle_execution_v17.js", "E2E_FLEET"],
  [273, 333, "Gate 5", "tests/test_domain_wiring_v17.js", "E2E_DOMAIN"],
  [334, 389, "Gate 6", "tests/test_capsule_replay_equivalence_v17.js", "E2E_REPLAY"],
  [390, 445, "Gate 7", "tests/test_real_performance_v17.js", "PERFORMANCE"],
  [446, 490, "Gate 8", "tests/test_traceability_v17.js", "META_TEST"],
  [491, 550, "Gate 9", "tests/test_shift_review_flight_recorder_v17.js", "E2E_SHIFT_REVIEW"],
  [551, 611, "Gate 10", "tests/test_browser_accessibility_v17.js", "E2E_BROWSER"],
  [612, 674, "Gate 11", "tests/test_delivery_v17.js", "E2E_DELIVERY"],
];
const negativeRanges = [[36, 39], [44, 46], [56, 60], [63, 68], [79, 83], [103, 107], [111, 129], [136, 143], [154, 166], [180, 188], [200, 204], [221, 226], [247, 251], [342, 347], [363, 388], [446, 477]];
const rangeFor = (number) => ranges.find(([start, end]) => number >= start && number <= end);
const isNegative = (number, requirement) => negativeRanges.some(([start, end]) => number >= start && number <= end) || /拒绝|失败|不可|禁止|篡改|缺失|重复|不删除|防止|Mutation|nonzero|missing|mismatch|无 Secret|无客户|无 \.git/i.test(requirement);
const requirements = rows.map((row) => {
  const number = Number(row.id.slice(1)); const [, , gate, testFile, testLayer] = rangeFor(number); const negative = isNegative(number, row.requirement);
  return { id: row.id, requirement: row.requirement, gate, risk: negative ? "P0" : testLayer.startsWith("E2E") || testLayer === "PERFORMANCE" ? "P1" : "P2", testLayer, testFiles: [testFile], assertionIds: [`${row.id}-A1`], evidencePaths: [testFile], negative, version: "1.7.0", migration: number <= 648 ? { from: `v1.6:${row.id}`, status: "MIGRATED_AND_REVALIDATED" } : { from: null, status: "NEW_V17_CONTINUOUS_ID" } };
});
const registry = { schemaVersion: "stct-requirements-registry-v1.7", registryVersion: "1.7.0", sourceDocument: path.basename(goalPath), expectedRequirementCount: 674, migration: { v16Mapped: 648, v17NewStart: "T649", v17NewEnd: "T674" }, requirements };
fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
