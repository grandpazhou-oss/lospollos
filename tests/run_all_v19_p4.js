"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const suites = [
  "tests/run_all_v19_p31.js",
  "tests/test_design_workspace_v19.js",
  "tests/test_design_supplemental_v19.js",
  "tests/test_design_red_team_v19.js",
  "tests/test_design_performance_v19.js",
];
const results = [];
for (const suite of suites) {
  const run = spawnSync(process.execPath, [path.join(root, suite)], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout);
    process.exit(run.status || 1);
  }
  const payload = JSON.parse(run.stdout);
  results.push({ suite, status: payload.status || "PASS", payload });
}
const report = { schemaVersion: "stct-v1.9-p4-test-aggregate", status: results.every((row) => row.status === "PASS") ? "PASS" : "FAIL", suites: results };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
