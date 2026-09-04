#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Contract = require("../network-contract-v18.js");

const repo = path.resolve(__dirname, "..");
const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || path.join(os.tmpdir(), "stct-v18-overnight"));
const registryPath = process.env.STCT_V18_REGISTRY || path.join(runDir, "STCT_v1.8_OVERNIGHT_Requirement_Registry.json");
const sourceFile = "tests/test_overnight_o11_v18.js";
const command = "node tests/test_overnight_o11_v18.js";
const started = process.hrtime.bigint();
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const requirements = registry.overnightRequirements.filter((row) => {
  const number = Number(row.id.slice(4));
  return number >= 1502 && number <= 1548;
});
const outcomes = new Map();
const sourceLines = fs.readFileSync(__filename, "utf8").split("\n");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readRows = (file) => fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const progress = readJson(path.join(runDir, "OVERNIGHT_PROGRESS.json"));
const protectedPids = (progress.protectedProcesses || []).map((row) => row.pid);
const shaFile = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const isSha = (value) => /^sha256:[0-9a-f]{64}$/.test(String(value));
const lineFor = (number) => sourceLines.findIndex((line) => line.includes("record(" + number + ",")) + 1 || 1;
const record = (number, condition, observed, expected) => outcomes.set("OVN-" + number, { condition: Boolean(condition), observed, expected, sourceLine: lineFor(number) });

function checkpointValid(payload) {
  const projection = structuredClone(payload);
  delete projection.checkpointHash;
  return isSha(payload.checkpointHash) && Contract.hashArtifact(projection) === payload.checkpointHash;
}

function resultHashValid(row) {
  return Contract.hashArtifact({
    cycle: row.cycle,
    status: row.status,
    deterministicSeed: row.deterministicSeed,
    workUnits: row.workUnits,
    workloads: row.workloads,
    scenarioHashes: row.scenarioHashes,
    resultHashes: row.resultHashes,
    details: row.details,
    publicCalls: row.publicCalls,
    resources: row.resources,
  }) === row.resultHash;
}

function inventoryValid(relative) {
  const inventory = readJson(path.join(runDir, "baseline", relative));
  const mismatches = inventory.files.filter((row) => !fs.existsSync(row.path) || shaFile(row.path) !== row.sha256);
  return { status: mismatches.length ? "FAIL" : "PASS", checked: inventory.files.length, mismatches };
}

function main() {
  const summary = readJson(path.join(runDir, "STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json"));
  const state = readJson(path.join(runDir, "soak/state.json"));
  const rows = readRows(path.join(runDir, "STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson"));
  const cycles = rows.filter((row) => row.type === "CYCLE");
  const starts = rows.filter((row) => row.type === "PROCESS_START");
  const ends = rows.filter((row) => row.type === "PROCESS_END");
  const stabilityAnchor = readJson(path.join(runDir, "soak/stability-anchor.json"));
  const resumeProbe = readJson(path.join(runDir, "soak/resume-probe.json"));
  const worst = readJson(path.join(runDir, "soak/worst-performance-cycle.json"));
  const failureDir = path.join(runDir, "evidence/o11-failure-preservation-probe");
  const failureSummary = readJson(path.join(failureDir, "STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json"));
  const failureRows = readRows(path.join(failureDir, "STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson")).filter((row) => row.type === "CYCLE");
  const firstFailure = readJson(path.join(failureDir, "first-failure.json"));
  const lastFailure = readJson(path.join(failureDir, "last-failure.json"));
  const interrupted = readJson(path.join(runDir, "evidence/o11-early-interruption-probe/STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json"));
  const originalExcel = inventoryValid("original-excel-inventory.json");
  const v17Artifacts = inventoryValid("v17-artifact-inventory.json");
  const cycleNumbers = cycles.map((row) => row.cycle);
  const expectedCycles = Array.from({ length: cycles.length }, (_, index) => index + 1);
  const stabilityRows = cycles.map((row) => row.details?.stabilityReplay).filter(Boolean);
  const checkpointRows = cycles.map((row) => row.details?.checkpointResume).filter(Boolean);
  const stormRows = cycles.filter((row) => row.workloads.includes("failureStorm"));
  const localeCounts = cycles.reduce((counts, row) => {
    const locale = row.details?.visual?.locale;
    if (locale) counts[locale] = (counts[locale] || 0) + 1;
    return counts;
  }, { zh: 0, en: 0, ja: 0 });
  const baselineKeys = ["listeners", "raf", "layers", "sources", "workers"];
  const failureSuccessors = stormRows.map((row) => cycles.find((candidate) => candidate.cycle === row.cycle + 1));
  const runnerPath = path.join(repo, "tests/run_overnight_soak_v18.sh");

  record(1502, fs.existsSync(runnerPath) && state.lastCompleteCycle === cycles.length && starts.length === 1 && ends.length === 1 && state.status === "PASS", { runner: "tests/run_overnight_soak_v18.sh", lastCompleteCycle: state.lastCompleteCycle, processStarts: starts.length, processEnds: ends.length, resumed: state.resumed }, "resumable runner and durable state");
  record(1503, cycles.every((row) => row.workUnits > 0 && row.workloads.includes("network") && row.durationMs >= 180000), { minWorkUnits: Math.min(...cycles.map((row) => row.workUnits)), minDurationMs: Math.min(...cycles.map((row) => row.durationMs)) }, "real domain work in every cycle");
  record(1504, cycles.every((row) => row.deterministicSeed === 180000 + row.cycle * 10) && new Set(cycles.map((row) => row.deterministicSeed)).size === cycles.length, cycles.slice(0, 3).map((row) => row.deterministicSeed), "deterministic rotating seeds");
  record(1505, JSON.stringify(cycleNumbers) === JSON.stringify(expectedCycles), { first: cycleNumbers[0], last: cycleNumbers.at(-1), count: cycleNumbers.length }, "strictly monotonic cycle numbers");
  record(1506, cycles.every((row) => Date.parse(row.startedAt) <= Date.parse(row.endedAt)) && Date.parse(summary.startedAt) < Date.parse(summary.endedAt), { startedAt: summary.startedAt, endedAt: summary.endedAt }, "wall-clock start and end");
  record(1507, cycles.every((row) => Number.isFinite(row.resources.start.rssBytes) && Number.isFinite(row.resources.start.heapUsedBytes) && Number.isFinite(row.resources.end.cpuUserMicros) && Number.isFinite(row.resources.end.cpuSystemMicros)), cycles[0]?.resources, "CPU and memory recorded");
  record(1508, cycles.every((row) => row.resources.start.openFileDescriptors === null || Number.isFinite(row.resources.start.openFileDescriptors)) && cycles.every((row) => row.resources.end.openFileDescriptors === null || Number.isFinite(row.resources.end.openFileDescriptors)), cycles.slice(0, 2).map((row) => [row.resources.start.openFileDescriptors, row.resources.end.openFileDescriptors]), "file descriptors recorded where available");
  record(1509, cycles.every((row) => Array.isArray(row.resources.end.activePids) && Array.isArray(row.resources.end.ownedPorts)) && Array.isArray(summary.ownedPorts), { activePids: cycles[0]?.resources.end.activePids, ownedPorts: summary.ownedPorts }, "active PIDs and owned ports recorded");
  record(1510, cycles.every((row) => baselineKeys.every((key) => Number.isFinite(row.resources.start[key]) && Number.isFinite(row.resources.end[key]))), cycles[0]?.resources, "listener RAF layer source worker counts recorded");
  record(1511, cycles.every((row) => row.scenarioHashes.length > 0 && row.resultHashes.length > 0 && row.scenarioHashes.every(isSha) && row.resultHashes.every(isSha) && isSha(row.resultHash) && resultHashValid(row)), { cycles: cycles.length, verifiedResultHashes: cycles.filter(resultHashValid).length }, "canonical scenario/result hashes and sealed cycle rows");
  record(1512, cycles.every((row) => ["PASS", "FAIL", "BLOCKED_ENVIRONMENT"].includes(row.status)) && cycles.every((row) => row.status === "PASS") && interrupted.status === "BLOCKED_ENVIRONMENT" && failureRows.every((row) => row.status === "FAIL"), { formal: [...new Set(cycles.map((row) => row.status))], failureProbe: [...new Set(failureRows.map((row) => row.status))], interruption: interrupted.status }, "pass fail blocked states recorded");
  record(1513, firstFailure.failure.cycle === failureSummary.failures.first.cycle && firstFailure.failure.code === failureSummary.failures.first.code && failureRows[0].failure.code === firstFailure.failure.code, { firstFile: firstFailure.failure, summary: failureSummary.failures.first }, "first failure preserved");
  record(1514, lastFailure.failure.cycle === failureSummary.failures.last.cycle && lastFailure.failure.code === failureSummary.failures.last.code && failureRows.at(-1).failure.code === lastFailure.failure.code, { lastFile: lastFailure.failure, summary: failureSummary.failures.last }, "last failure preserved");
  record(1515, worst.cycle === summary.worstPerformanceCycle.cycle && worst.durationMs === Math.max(...cycles.map((row) => row.durationMs)), { cycle: worst.cycle, durationMs: worst.durationMs }, "worst performance cycle retained");
  record(1516, cycles.length === summary.completeCycles && summary.priorCyclesRetained === true && fs.existsSync(path.join(runDir, "soak/preflight-run-1/STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson")), { logCycles: cycles.length, summaryCycles: summary.completeCycles, priorCyclesRetained: summary.priorCyclesRetained }, "all formal and preflight cycles retained");
  record(1517, cycles.length >= 120 && summary.completeCycles >= 120, summary.completeCycles, ">=120 complete cycles");
  record(1518, summary.minimumSeconds >= 21600 && summary.actualDurationSeconds >= 21600, { minimumSeconds: summary.minimumSeconds, actualDurationSeconds: summary.actualDurationSeconds }, ">=6 real hours");
  record(1519, summary.targetSeconds >= 28800, summary.targetSeconds, "8-hour target recorded where environment permits");
  record(1520, summary.counts.orders500 >= 20, summary.counts.orders500, ">=20 500-order cycles");
  record(1521, summary.counts.orders1000 >= 10, summary.counts.orders1000, ">=10 1000-order cycles");
  record(1522, summary.counts.pickupDelivery >= 20, summary.counts.pickupDelivery, ">=20 pickup-delivery cycles");
  record(1523, summary.counts.crossDock >= 20, summary.counts.crossDock, ">=20 cross-dock cycles");
  record(1524, summary.counts.multiTrip >= 20, summary.counts.multiTrip, ">=20 multi-trip cycles");
  record(1525, summary.counts.dockWave >= 20, summary.counts.dockWave, ">=20 dock-wave cycles");
  record(1526, summary.counts.energy >= 10, summary.counts.energy, ">=10 EV energy cycles");
  record(1527, summary.counts.uncertainty >= 10, summary.counts.uncertainty, ">=10 uncertainty cycles");
  record(1528, summary.counts.execution >= 20, summary.counts.execution, ">=20 synthetic shift executions");
  record(1529, summary.counts.incidentRecovery >= 20, summary.counts.incidentRecovery, ">=20 incident recoveries");
  record(1530, summary.counts.capsule >= 20, summary.counts.capsule, ">=20 Capsule export/import replays");
  record(1531, summary.counts.noWebGL >= 10, summary.counts.noWebGL, ">=10 no-WebGL cycles");
  record(1532, summary.counts.reducedMotion >= 10, summary.counts.reducedMotion, ">=10 reduced-motion cycles");
  record(1533, summary.counts.fallback >= 10 && cycles.filter((row) => row.workloads.includes("fallback")).every((row) => row.publicCalls === 0), summary.counts.fallback, ">=10 local fallback cycles");
  record(1534, ["zh", "en", "ja"].every((locale) => localeCounts[locale] >= 10), localeCounts, ">=10 cycles in each locale family");
  record(1535, summary.counts.cleanStartStop >= 10 && cycles.filter((row) => row.workloads.includes("cleanStartStop")).every((row) => row.details.cleanStartStop.leakFree), summary.counts.cleanStartStop, ">=10 clean start/stop cycles");
  record(1536, summary.counts.checkpointResume >= 10 && checkpointRows.length >= 10 && checkpointRows.every((row) => row.verificationStatus === "PASS" && isSha(row.checkpointHash)) && checkpointValid(resumeProbe), { count: checkpointRows.length, finalProbeCycle: resumeProbe.savedCycle, finalProbeValid: checkpointValid(resumeProbe) }, ">=10 real checkpoint reads and plan replays");
  record(1537, summary.publicRoutingOrOptimizerCalls === 0 && cycles.every((row) => row.publicCalls === 0), { summaryCalls: summary.publicRoutingOrOptimizerCalls, cycleCalls: cycles.reduce((sum, row) => sum + row.publicCalls, 0) }, "zero public provider calls");
  record(1538, originalExcel.status === "PASS" && summary.protectedResources.status === "PASS", originalExcel, "original Excel unchanged");
  record(1539, v17Artifacts.status === "PASS" && summary.protectedResources.status === "PASS", v17Artifacts, "protected delivery artifacts unchanged");
  record(1540, stabilityRows.length === cycles.length && stabilityRows.every((row) => row.verificationStatus === "PASS" && row.networkPlanHash === row.repeatedNetworkPlanHash && row.implementationHash === summary.implementationHash), { count: stabilityRows.length, uniquePlanHashes: new Set(stabilityRows.map((row) => row.networkPlanHash)).size, uniqueImplementationHashes: new Set(stabilityRows.map((row) => row.implementationHash)).size }, "verified anchor plan remains valid under unchanged input/version");
  record(1541, stabilityRows.length === cycles.length && new Set(stabilityRows.map((row) => row.networkInputHash)).size === 1 && new Set(stabilityRows.map((row) => row.routingContextHash)).size === 1 && checkpointValid(stabilityAnchor), { networkIdentities: new Set(stabilityRows.map((row) => row.networkInputHash)).size, routingIdentities: new Set(stabilityRows.map((row) => row.routingContextHash)).size, anchorValid: checkpointValid(stabilityAnchor) }, "identical scenario retains canonical identities");
  record(1542, summary.noUnexplainedMonotonicGrowth === true && summary.leakSlopes.rssBytesPerCycle < 1024 * 1024 && summary.leakSlopes.fdPerCycle <= 0.01, summary.leakSlopes, "no unexplained monotonic memory/resource growth");
  record(1543, cycles.every((row) => baselineKeys.every((key) => row.resources.end[key] === row.resources.start[key])) && cycles.filter((row) => row.details.visual).every((row) => row.details.visual.closed.leakFree), { baselines: baselineKeys, visualTeardowns: cycles.filter((row) => row.details.visual).length }, "all virtual rendering resources return to baseline");
  record(1544, cycles.every((row) => row.resources.end.activePids.length === 1 + protectedPids.length && protectedPids.every((pid) => row.resources.end.activePids.includes(pid)) && row.resources.end.ownedPorts.length === 0) && summary.ownedPorts.length === 0, { protectedPids, uniquePidSets: new Set(cycles.map((row) => JSON.stringify(row.resources.end.activePids))).size, ownedPorts: summary.ownedPorts }, "no accumulated temporary services beyond the soak process and dynamically captured protected services");
  record(1545, stormRows.length >= 10 && stormRows.every((row) => row.details.failureStorm.attacks.length === 3 && row.details.failureStorm.attacks.every((attack) => attack.status === "FAIL" && attack.issues.includes(attack.expectedIssue)) && row.details.failureStorm.cleanStatus === "PASS") && failureSuccessors.every((row) => row?.status === "PASS"), { storms: stormRows.length, cleanSuccessors: failureSuccessors.filter((row) => row?.status === "PASS").length }, "failure storms contained and followed by clean cycles");
  record(1546, failureSummary.fail === failureRows.length && firstFailure.failure.cycle === 1 && lastFailure.failure.cycle === failureRows.at(-1).cycle && failureRows.every((row) => row.failure), { failedCycles: failureRows.length, first: firstFailure.failure.cycle, last: lastFailure.failure.cycle }, "failed cycles not overwritten by later state");
  record(1547, ["actualDurationSeconds", "completeCycles", "counts", "failures", "worstPerformanceCycle", "leakSlopes"].every((key) => Object.hasOwn(summary, key)) && summary.status === "PASS", { status: summary.status, fields: Object.keys(summary) }, "complete PASS summary with required metrics");
  record(1548, interrupted.status === "BLOCKED_ENVIRONMENT" && interrupted.minimumSeconds >= 21600 && interrupted.actualDurationSeconds < interrupted.minimumSeconds && interrupted.interruption?.signal === "SIGINT", interrupted, "early real-workload termination is BLOCKED_ENVIRONMENT, never PASS");

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const assertions = requirements.map((requirement) => {
    const outcome = outcomes.get(requirement.id) || { condition: false, observed: "UNMAPPED", expected: requirement.requirement, sourceLine: 1 };
    return {
      assertionId: requirement.id + "-A1", requirementId: requirement.id,
      status: outcome.condition ? "PASS" : "FAIL", observed: outcome.observed, expected: outcome.expected,
      negative: requirement.risk === "P0", testLayer: "LONG_RUNNING_SOAK", sourceFile,
      sourceLine: outcome.sourceLine, command, durationMs: elapsedMs,
      environmentClassification: "LOCAL_SYNTHETIC_REAL_WORKLOAD",
      evidence: "STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson",
    };
  });
  const failures = assertions.filter((row) => row.status !== "PASS");
  const aggregate = {
    schemaVersion: "stct-overnight-o11-test-v1.8",
    status: failures.length ? "FAIL" : "PASS",
    assertionCount: assertions.length,
    completeCycles: cycles.length,
    durationSeconds: summary.actualDurationSeconds,
    counts: summary.counts,
    localeCounts,
    failures,
    missingMappings: assertions.filter((row) => row.observed === "UNMAPPED").map((row) => row.requirementId),
    assertions,
  };
  const destination = path.join(runDir, "evidence/overnight-o11-test.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(aggregate, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ status: aggregate.status, assertionCount: aggregate.assertionCount, completeCycles: aggregate.completeCycles, durationSeconds: aggregate.durationSeconds, localeCounts, failures, missingMappings: aggregate.missingMappings }, null, 2) + "\n");
  process.exitCode = failures.length ? 1 : 0;
}

main();
