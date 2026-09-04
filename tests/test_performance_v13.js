#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");
global.window = { crypto: globalThis.crypto };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
vm.runInThisContext(fs.readFileSync(path.join(root, "verifier.js"), "utf8"), { filename: "verifier.js" });
const contract = window.STCTCanonical.getContract();
const baseUrl = process.env.OPTIMIZER_URL || "http://127.0.0.1:19131";
const searchConfiguration = { firstSolutionStrategy: "parallel-cheapest-insertion", localSearchMetaheuristic: "guided-local-search", randomSeed: 13, logSearch: false, servicePolicy: "priority-score-then-assigned-count-then-business-objective" };
const objectives = ["vehicles", "distance", "utilization", "cost", "carbon", "balanced_seed"];

function scenarioSource(count) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", `single-day-${count}.json`), "utf8"));
  const date = fixture.planningDate;
  return {
    planningMode: "SINGLE_DAY",
    planningDate: date,
    depot: { id: "SYNTH-DEPOT", name: "Synthetic Depot", address: "Synthetic", lon: 121.28, lat: 31.08 },
    orders: fixture.orders.map((order) => {
      const priority = window.STCTCanonical.priority(order.priority);
      return { ...order, code: order.id, name: order.id, address: "Synthetic", priority: priority.normalized, priorityWeight: priority.weight, prioritySource: priority.source, orderType: "", requiredVehicleType: "" };
    }),
    vehicles: Array.from({ length: 7 }, (_, index) => ({ id: `SYNTH-V${index + 1}`, name: `Synthetic Vehicle ${index + 1}`, type: "van", availableDate: date, maxVolume: 10, maxWeight: 100, start: "09:00", end: "18:00", fixedCost: 120, perKmCost: 4.8, perMinuteCost: 0.35, perStopCost: 8, emissionFactor: 0.192, sourceVehicleId: `SYNTH-V${index + 1}`, isVirtual: false, enabled: true })),
    constraints: { singleTrip: true, maxWaitingMinutes: 90, workStart: "09:00", workEnd: "18:00", maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000, maxStops: 500, maxRouteMinutes: 540, shiftExtensionMinutes: 0 },
    assumptions: { roadDistanceFactor: 1.35, averageSpeedKmh: 35, defaultServiceMin: 2, costModelVersion: contract.models.costModelVersion, emissionModelVersion: contract.models.emissionModelVersion, priorityMappingVersion: contract.priorityMapping.version, missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: contract.time.missingTimeWindowPolicy, overnightPolicy: contract.time.overnightPolicy, distanceModel: contract.distance.model, roadMetersRounding: contract.distance.roadMetersRounding, travelMinutesRounding: contract.distance.travelMinutesRounding, costMinuteBasis: contract.time.costMinuteBasis, defaultEmissionFactor: 0.192, lowUtilizationThreshold: contract.utilization.lowRouteThresholdPercent, balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10 },
  };
}

async function identityWithTiming(source) {
  const canonicalStarted = performance.now();
  const scenario = window.STCTCanonical.canonicalScenario(source);
  const inputBytes = window.STCTCanonical.canonicalString(scenario);
  const canonicalMs = performance.now() - canonicalStarted;
  const hashStarted = performance.now();
  const inputHash = await window.STCTCanonical.sha256(inputBytes);
  const contentHash = await window.STCTCanonical.sha256(window.STCTCanonical.canonicalString({ canonicalVersion: contract.canonicalVersion, depot: scenario.depot, orders: scenario.orders, vehicles: scenario.vehicles }));
  const hashMs = performance.now() - hashStarted;
  return { scenario, inputBytes, inputHash, contentHash, canonicalMs, hashMs };
}

async function requestPlan(identity, objective, requestId) {
  const requestIdentity = await window.STCTCanonical.requestIdentity(identity.inputHash, { objective, timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration });
  const request = { version: "v1.4-trust-closure-mission-control", contractVersion: contract.contractVersion, canonicalVersion: contract.canonicalVersion, requestId, requestSequence: 1, scenarioId: `SCN-${identity.inputHash.slice(7, 23).toUpperCase()}`, canonicalScenario: identity.scenario, claimedContentHash: identity.contentHash, claimedInputHash: identity.inputHash, claimedRequestHash: requestIdentity.requestHash, objective, timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration };
  const response = await fetch(`${baseUrl}/optimize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  assert.strictEqual(response.status, 200, `${requestId}: HTTP ${response.status}`);
  const envelope = await response.json();
  const verifyStarted = performance.now();
  const verification = await window.STCTVerifier.verify(envelope.plan, { ...identity.scenario, scenarioId: request.scenarioId, contentHash: identity.contentHash, inputHash: identity.inputHash });
  const verifierMs = performance.now() - verifyStarted;
  assert.strictEqual(verification.status, "PASS", `${requestId}: ${JSON.stringify(verification.hardViolations)}`);
  return {
    plan: envelope.plan,
    row: {
      objective,
      requestHash: requestIdentity.requestHash,
      planHash: envelope.planHash,
      matrixMs: envelope.plan.meta.solveStats.matrixBuildMs,
      solverMs: envelope.plan.meta.solveStats.solveMs,
      totalMs: envelope.plan.meta.solveStats.totalMs,
      verifierMs: Number(verifierMs.toFixed(3)),
      assigned: verification.recomputedMetrics.assigned,
      servicePriorityScore: verification.recomputedMetrics.servicePriorityScore,
      usedVehicles: verification.recomputedMetrics.usedVehicles,
      estimatedRoadKm: verification.recomputedMetrics.estimatedRoadKm,
      totalCost: verification.recomputedMetrics.totalCost,
      totalCO2: verification.recomputedMetrics.totalCO2,
      utilizationScore: verification.recomputedMetrics.utilizationScore,
      verifier: verification.status,
      solverStatus: envelope.plan.meta.solveStats?.status,
    },
  };
}

async function main() {
  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.strictEqual(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.strictEqual(health.available, true);
  const sizes = [];
  let repeatIdentity;
  let candidateEvidence = null;
  for (const count of [60, 120, 240]) {
    const identity = await identityWithTiming(scenarioSource(count));
    const runs = [];
    const plans = [];
    const sixObjectiveStarted = performance.now();
    for (const objective of objectives) {
      const result = await requestPlan(identity, objective, `PERF-${count}-${objective}`);
      runs.push(result.row);
      plans.push(result.plan);
    }
    const sixObjectiveWallClockMs = performance.now() - sixObjectiveStarted;
    const singleObjectiveTimes = runs.map((row) => Number(row.totalMs)).sort((left, right) => left - right);
    const medianIndex = Math.floor(singleObjectiveTimes.length / 2);
    const singleObjectiveMedianMs = singleObjectiveTimes.length % 2
      ? singleObjectiveTimes[medianIndex]
      : (singleObjectiveTimes[medianIndex - 1] + singleObjectiveTimes[medianIndex]) / 2;
    const renderStarted = performance.now();
    let rendered = "";
    for (let index = 0; index < 100; index += 1) {
      rendered = `<table>${runs.map((row) => `<tr><td>${row.objective}</td><td>${row.assigned}</td><td>${row.estimatedRoadKm}</td><td>${row.totalCost}</td></tr>`).join("")}</table>`;
    }
    const renderMs = (performance.now() - renderStarted) / 100;
    assert(rendered.includes("<table>"));
    sizes.push({
      count,
      dataset: "fully-synthetic",
      planningMode: "SINGLE_DAY",
      timeLimitSeconds: 1,
      execution: "six objectives sequential",
      canonicalMs: Number(identity.canonicalMs.toFixed(3)),
      hashMs: Number(identity.hashMs.toFixed(3)),
      matrixMs: Number(Math.max(...runs.map((row) => Number(row.matrixMs))).toFixed(3)),
      singleObjectiveMaxMs: Number(Math.max(...singleObjectiveTimes).toFixed(3)),
      singleObjectiveMedianMs: Number(singleObjectiveMedianMs.toFixed(3)),
      sixObjectiveSequentialTotalMs: Number(runs.reduce((sum, row) => sum + Number(row.totalMs), 0).toFixed(3)),
      sixObjectiveWallClockMs: Number(sixObjectiveWallClockMs.toFixed(3)),
      verifierMaxMs: Number(Math.max(...runs.map((row) => row.verifierMs)).toFixed(3)),
      renderMs: Number(renderMs.toFixed(3)),
      renderScope: "headless candidate-table HTML construction average over 100 iterations",
      inputHash: identity.inputHash,
      runs,
    });
    if (count === 60) {
      repeatIdentity = identity;
      const scenario = { ...identity.scenario, scenarioId: `SCN-${identity.inputHash.slice(7, 23).toUpperCase()}`, contentHash: identity.contentHash, inputHash: identity.inputHash };
      const ranked = await window.STCTVerifier.rankCandidatePool(plans, scenario);
      candidateEvidence = {
        sourceCandidates: plans.length,
        dedupedCandidates: ranked.candidates.length,
        bestService: ranked.bestService,
        goalLinks: ranked.goalLinks,
        candidates: ranked.candidates.map((plan) => ({
          planHash: plan.planHash,
          requestedObjectives: plan.requestedGoals,
          actualLabels: plan.labels,
          metrics: plan.metrics,
          verifier: plan.verification.status,
          solverStatus: plan.meta.solveStats?.status,
        })),
      };
    }
  }
  const repeats = [];
  for (let index = 0; index < 3; index += 1) repeats.push((await requestPlan(repeatIdentity, "service", `REPEAT-60-${index + 1}`)).row);
  assert.strictEqual(new Set(repeats.map((row) => row.requestHash)).size, 1);
  assert.strictEqual(new Set(repeats.map((row) => row.assigned)).size, 1);
  assert.strictEqual(new Set(repeats.map((row) => row.servicePriorityScore)).size, 1);
  assert(repeats.every((row) => row.verifier === "PASS"));
  const pythonVersion = spawnSync("python3", ["--version"], { encoding: "utf8" });
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    semantics: {
      dataset: "fully-synthetic",
      planningMode: "SINGLE_DAY",
      timeLimitSeconds: 1,
      objectiveExecution: "sequential",
      renderScope: "headless candidate-table HTML construction",
    },
    environment: {
      cpu: os.cpus()[0]?.model || "unknown",
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      python: (pythonVersion.stdout || pythonVersion.stderr || "unknown").trim(),
      ortools: health.actualOrtoolsVersion || health.actualEngineVersion || "unknown",
      optimizerVersion: health.version,
    },
    sizes,
    candidateEvidence,
    repeatability: repeats,
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
