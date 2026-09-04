#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const baseline = process.argv[2] ? path.resolve(process.argv[2]) : "";
const delivery = process.argv[3] ? path.resolve(process.argv[3]) : "";
const output = process.argv[4] ? path.resolve(process.argv[4]) : "";
if (!baseline || !delivery || !fs.existsSync(baseline) || !fs.existsSync(delivery)) {
  process.stderr.write("Usage: node tests/test_gate0_v16.js <v16-baseline> <v151-delivery> [output.json]\n"); process.exit(2);
}
const repo = path.resolve(__dirname, ".."); const checks = [];
function check(id, condition, detail = "") { assert(condition, `${id}${detail ? `: ${detail}` : ""}`); checks.push(id); }
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function verifyRows(file) { return fs.readFileSync(file, "utf8").split("\n").filter((row) => /^[a-f0-9]{64}  \//.test(row)).every((row) => fs.existsSync(row.slice(66)) && sha(row.slice(66)) === row.slice(0, 64)); }
function manifest(directory) { return fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").trim().split("\n").every((row) => { const match = row.match(/^([a-f0-9]{64})  \.\/(.+)$/); return match && match[2] !== "SHA256SUMS.txt" && sha(path.join(directory, match[2])) === match[1]; }); }
const regression = path.join(baseline, "v151-regression"); const git = fs.readFileSync(path.join(baseline, "git-baseline.txt"), "utf8");
check("T001", /branch=feature\/ai-dispatch/.test(git) && /head=500122e/.test(git) && /\[status-short\]/.test(git) && fs.statSync(path.join(baseline, "worktree.diff")).isFile());
check("T002", /\[tracked-files\]/.test(git) && /\[untracked-files\]/.test(git));
check("T003", fs.readFileSync(path.join(baseline, "original-excel-sha256.txt"), "utf8").trim().split("\n").length === 11);
const environment = JSON.parse(fs.readFileSync(path.join(baseline, "environment.json"), "utf8"));
check("T004", Boolean(environment.node && environment.python3 && environment.ortoolsPython && environment.swVers && environment.arch));
const ports = JSON.parse(fs.readFileSync(path.join(baseline, "ports-before.json"), "utf8")); check("T005", [8766, 8788, 19095].every((port) => ports.listeners.some((row) => row.endpoint.endsWith(`:${port}`))));
check("T006", fs.statSync(path.join(baseline, "source-baseline")).isDirectory());
check("T007", verifyRows(path.join(baseline, "SHA256SUMS.txt")));
check("T008", /PASS/.test(fs.readFileSync(path.join(regression, "pareto-integrity.txt"), "utf8")));
check("T009", /PASS/.test(fs.readFileSync(path.join(regression, "integrity-hash.txt"), "utf8")));
check("T010", /PASS/.test(fs.readFileSync(path.join(regression, "derived-scenario.txt"), "utf8")));
check("T011", /PASS/.test(fs.readFileSync(path.join(regression, "capsule-deep.txt"), "utf8")));
check("T012", /PASS/.test(fs.readFileSync(path.join(regression, "recovery-matrix.txt"), "utf8")));
const performance = JSON.parse(fs.readFileSync(path.join(regression, "browser", "performance-v16-gate0-assertion.json"), "utf8")); check("T013", performance.status === "PASS" && performance.actual <= 5);
const release = JSON.parse(fs.readFileSync(path.join(regression, "release-28", "test-summary.json"), "utf8")); check("T014", release.status === "PASS" && release.counts.PASS === 28 && release.counts.FAIL === 0);
check("T015", /PASS/.test(fs.readFileSync(path.join(regression, "release-28", "fallback-e2e.txt"), "utf8")));
const distBrowser = JSON.parse(fs.readFileSync(path.join(regression, "dist-runtime", "evidence", "release", "browser.json"), "utf8"));
check("T016", distBrowser.status === "PASS" && distBrowser.viewports.desktop === "PASS"); check("T017", distBrowser.viewports.mobilePortrait === "PASS"); check("T018", distBrowser.viewports.mobileLandscape === "PASS");
const i18n = JSON.parse(fs.readFileSync(path.join(regression, "browser", "i18n.json"), "utf8")); check("T019", i18n.status === "PASS" && ["zh", "en", "ja"].every((language) => i18n.languages[language]));
check("T020", distBrowser.screenshots.some((name) => name.includes("no-webgl"))); check("T021", distBrowser.screenshots.some((name) => name.includes("reduced-motion")));
check("T022", manifest(path.join(delivery, "STCT-v1.5.1-clean-dist")));
check("T023", manifest(path.join(delivery, "STCT-v1.5.1-audit-redacted")));
check("T024", verifyRows(path.join(baseline, "v151-delivery-sha256-before.txt")));
check("T025", fs.readdirSync(path.join(baseline, "concepts")).filter((name) => name.endsWith(".png")).length === 8 && fs.existsSync(path.join(repo, "V16_VISUAL_DESIGN_CONTRACT.md")));
const result = { status: "PASS", checks: checks.length, ids: checks, releaseSuites: release.counts.PASS, baselineLongTasks240: performance.actual };
if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8"); }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
