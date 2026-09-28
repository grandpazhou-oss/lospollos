#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const suites = [];

function run(file) {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  const parsed = JSON.parse(result.stdout);
  suites.push({ file, status: parsed.status, checks: parsed.checks, assertions: parsed.assertions || [] });
  return parsed;
}

const p2Integrity = run("test_p2_integrity_closure_v19.js");
const p1Router = run("test_workspace_router_v19.js");
const p1Shell = run("test_platform_shell_v19.js");
const p1Lifecycle = run("test_route_lifecycle_v19.js");
const command = run("test_command_workspace_v19.js");
const officialIds = Array.from({ length: 62 }, (_, index) => `T${String(index + 183).padStart(4, "0")}`);
const rows = new Map(command.assertions.map((row) => [row.requirementId, row]));
if (!officialIds.every((id) => rows.get(id)?.status === "PASS")) throw new Error("P3 official T0183-T0244 must pass 62/62.");

const report = {
  schemaVersion: "stct-v1.9-p3-test-summary-v1",
  status: "PASS",
  gate: "Platform Gate P3",
  p2IntegrityClosure: `${p2Integrity.checks}/${p2Integrity.checks} PASS`,
  p1FocusedRegression: `${p1Router.checks + p1Shell.checks + p1Lifecycle.checks}/${p1Router.checks + p1Shell.checks + p1Lifecycle.checks} PASS`,
  p3Official: { range: "T0183-T0244", passed: command.requiredPassed, total: command.totalRequired },
  suites: suites.map(({ file, status, checks }) => ({ file, status, checks })),
  assertions: command.assertions,
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex !== -1 && process.argv[outputIndex + 1]) fs.writeFileSync(process.argv[outputIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
