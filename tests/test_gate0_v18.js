#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const child = require("child_process");

const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || "/tmp/lospollos-v1.8-overnight-20260904_012216");
const repo = path.resolve(__dirname, "..");
const baselineDir = path.join(runDir, "baseline");
const acceptanceDir = path.join(runDir, "evidence/v17-acceptance-2");
const assertions = [];
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const parse = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const command = (args, cwd = repo) => child.spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
function check(requirementId, condition, observed, expected) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative: false, evidence: "tests/test_gate0_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}

const checkpoint = parse(path.join(runDir, "checkpoints/0004-pass-0-completed.json"));
const sourceManifest = parse(path.join(baselineDir, "source-manifest.json"));
const excel = parse(path.join(baselineDir, "original-excel-inventory.json"));
const v17Artifacts = parse(path.join(baselineDir, "v17-artifact-inventory.json"));
const environment = parse(path.join(baselineDir, "environment.json"));
const summary = parse(path.join(acceptanceDir, "delivery/tests/STCT-v1.7-TEST_SUMMARY.json"));
const mutation = parse(path.join(acceptanceDir, "delivery/adversarial/STCT-v1.7-MUTATION-SUMMARY.json"));
const delivery = parse(path.join(acceptanceDir, "delivery/delivery/STCT-v1.7-DELIVERY-GATE.json"));
const performance = parse(path.join(acceptanceDir, "delivery/performance/STCT-v1.7-PERFORMANCE.json"));
const browser = parse(path.join(acceptanceDir, "delivery/browser/browser-report.json"));
const suites = fs.readFileSync(path.join(acceptanceDir, "results/suites.tsv"), "utf8").trim().split("\n").map((line) => line.split("\t"));
const currentSuites = fs.readFileSync(path.join(acceptanceDir, "results/current-suites.tsv"), "utf8").trim().split("\n").map((line) => line.split("\t"));
const gitBaseline = fs.readFileSync(path.join(baselineDir, "git-baseline.txt"), "utf8");
const ports = fs.readFileSync(path.join(baselineDir, "ports-before.txt"), "utf8");
const portsDocument = parse(path.join(baselineDir, "ports-before.json"));
const v17Reconstruction = parse(path.join(acceptanceDir, "source-reconstruction.json"));
const protectedProcesses = checkpoint.protectedProcesses || [];
const protectedProcessChecks = protectedProcesses.map((row) => ({
  pid: row.pid,
  alive: command(["kill", "-0", String(row.pid)]).status === 0,
  ports: row.ports || [],
  listeners: command(["lsof", "-nP", "-a", "-p", String(row.pid), "-iTCP", "-sTCP:LISTEN"]).stdout,
}));

check("T0001", checkpoint.branch === "feature/ai-dispatch" && /^[a-f0-9]{40}$/.test(checkpoint.head) && gitBaseline.startsWith("## "), { branch: checkpoint.branch, head: checkpoint.head }, "recorded");
check("T0002", /\?\?| M /.test(gitBaseline), "tracked and untracked recorded", true);
check("T0003", fs.statSync(path.join(baselineDir, "git-diff.binary.patch")).size > 20, "binary diff bytes", ">20");
check("T0004", sourceManifest.fileCount === sourceManifest.entries.length && sourceManifest.fileCount >= 274 && sourceManifest.entries.every((row) => /^[a-f0-9]{64}$/.test(row.sha256)), sourceManifest.fileCount, ">=274 recovered pre-v1.8 files");
check("T0005", excel.files.length === 11 && excel.files.every((row) => row.exists && sha(row.path) === row.sha256), excel.files.length, "11 unchanged Excel hashes");
check("T0006", v17Artifacts.files[0].sha256 === "c13e23e6fbc5af8e4f363139602f4d27f8aa67d206cd52f05d981fee5b6c3ae6" && sha(v17Artifacts.files[0].path) === v17Artifacts.files[0].sha256, v17Artifacts.files[0], "v1.7 Dist unchanged");
check("T0007", v17Artifacts.files[1].sha256 === "bc879541290f1c47dd2c7c4dbeeb3785bd37dfbedad631409f0fb179635175fd" && sha(v17Artifacts.files[1].path) === v17Artifacts.files[1].sha256, v17Artifacts.files[1], "v1.7 Audit unchanged");
check("T0008", /^v\d/.test(environment.node) && /^\d/.test(environment.python) && /^\d/.test(environment.ortools), environment, "runtime versions recorded");
check("T0009", environment.platform.includes("macOS") && environment.machine === "arm64", environment, "OS and architecture recorded");
check("T0010", ports.includes("CAPTURED_LISTENERS") && Array.isArray(portsDocument.listeners) && fs.statSync(path.join(baselineDir, "processes-before.txt")).size > 100, { listeners: portsDocument.listeners.length, processBytes: fs.statSync(path.join(baselineDir, "processes-before.txt")).size }, "ports/processes captured even when no protected listener exists");
check("T0011", protectedProcessChecks.every((row) => row.alive && row.ports.every((port) => row.listeners.includes(`:${port} (LISTEN)`))), protectedProcessChecks, "all dynamically captured protected services remain alive on their recorded ports");
check("T0012", fs.existsSync(path.join(baselineDir, "source-baseline/index.html")), "source baseline", "exists");
const manifestCheck = command(["shasum", "-a", "256", "--status", "-c", path.join(baselineDir, "SHA256SUMS.txt")], path.join(baselineDir, "source-baseline"));
check("T0013", manifestCheck.status === 0, manifestCheck.status, 0);
check("T0014", v17Reconstruction.status === "PASS" && v17Reconstruction.paths >= 1, v17Reconstruction, "v1.7 delivery reconstructed in a fresh repository-external path");
check("T0015", suites.length >= 14 && suites.every((row) => row[1] === "PASS" && row[2] === "0") && currentSuites.length >= 8 && currentSuites.every((row) => row[1] === "PASS" && row[2] === "0"), { preserved: suites.map((row) => [row[0], row[1]]), current: currentSuites.map((row) => [row[0], row[1]]) }, "preserved v1.7 gate plus >=8 current logic suites PASS");
for (const [id, suite] of [["T0016", "execution"], ["T0017", "offline"], ["T0018", "telemetry"], ["T0019", "multi-vehicle"], ["T0020", "capsule"], ["T0021", "domain"], ["T0022", "performance"]]) check(id, suites.some((row) => row[0] === suite && row[1] === "PASS"), suite, "PASS");
check("T0023", summary.status === "PASS" && summary.exactAssertionCount === 674 && !summary.missing.length && !summary.extra.length, summary.exactAssertionCount, "674 semantic assertions");
check("T0024", mutation.status === "PASS" && mutation.mutations.length === 6 && mutation.mutations.every((row) => row.status === "KILLED"), mutation.mutations.map((row) => row.status), "6 KILLED");
check("T0025", browser.status === "PASS" && browser.assertions.length === 61, browser.assertions.length, 61);
check("T0026", delivery.status === "PASS" && delivery.assertions.length === 63, delivery.assertions.length, 63);
check("T0027", performance.status === "PASS" && performance.rates.executionStep !== performance.rates.browserRafCallbacks, performance.rates, "classified rates, not one FPS claim");
check("T0028", performance.rates.executionStep > 0, performance.rates.executionStep, ">0 event reducer throughput");
check("T0029", performance.rates.applicationUpdates > 0, performance.rates.applicationUpdates, ">0 application update rate");
check("T0030", performance.rates.mapLayerUpdate > 0 && performance.rates.actualSetDataCalls > 0, { map: performance.rates.mapLayerUpdate, setData: performance.rates.actualSetDataCalls }, ">0 separate map rates");
check("T0031", performance.rates.timelineRenders > 0, performance.rates.timelineRenders, ">0 visible render rate");
check("T0032", performance.rates.browserRafCallbacks > 0, performance.rates.browserRafCallbacks, ">0 RAF callback rate");
check("T0033", summary.assertions.some((row) => row.requirementId === "T610" && JSON.stringify(row.observed).includes("BLOCKED_MEASUREMENT")), "physical iPhone boundary retained", "BLOCKED_MEASUREMENT");
check("T0034", v17Artifacts.files.every((row) => sha(row.path) === row.sha256), "v1.7 artifacts", "read-only hashes unchanged");
check("T0035", fs.readFileSync(path.join(acceptanceDir, "delivery/STCT-v1.7-FINAL_REPORT.md"), "utf8").includes("local demo, not production-ready"), "known risks", "recorded");
check("T0036", checkpoint.phase === "PASS_0_COMPLETED", checkpoint.phase, "source reproducibility gate passed before v1.8");
check("T0037", fs.existsSync(path.join(repo, "V17_COMPONENT_INVENTORY.md")), "concept capabilities", "recorded");
check("T0038", fs.existsSync(path.join(repo, "V17_VISUAL_DESIGN_CONTRACT.md")), "visual contract", "exists");
check("T0039", fs.existsSync(path.join(repo, "OPEN_SOURCE_INSPIRATION_V17.md")), "open-source inspiration", "exists");
check("T0040", JSON.stringify(checkpoint.protectedPorts) === JSON.stringify(portsDocument.protectedPorts) && command(["lsof", "-nP", "-iTCP:19472", "-sTCP:LISTEN"]).status !== 0, { protected: checkpoint.protectedPorts, ownedPortClosed: 19472 }, "dynamic protected-port ownership recorded and owned port closed");

process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`);
