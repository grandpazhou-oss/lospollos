"use strict";

const Contract = require("./network-contract-v18.js");

const VERSION = "stct-synthetic-uncertainty-v1.8";
const LABEL = "SYNTHETIC_SCENARIO_ANALYSIS_NOT_A_FORECAST";

function randomGenerator(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x100000000;
  };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(probability * sorted.length) - 1)];
}

function summarize(values) {
  return { median: round(percentile(values, 0.5)), p90: round(percentile(values, 0.9)), p95: round(percentile(values, 0.95)) };
}

function runEnsemble(base, config, sampleCount, seed) {
  const random = randomGenerator(seed);
  const safeConfig = {
    scenarioType: config.scenarioType,
    travelTimeMultiplier: config.travelTimeMultiplier || [0.9, 1.25],
    serviceDurationMultiplier: config.serviceDurationMultiplier || [0.9, 1.2],
    demandVolumeMultiplier: config.demandVolumeMultiplier || [0.95, 1.15],
    dockProcessingMultiplier: config.dockProcessingMultiplier || [0.9, 1.3],
    driverCheckInDelayMinutes: config.driverCheckInDelayMinutes || [0, 20],
    transferDelayMinutes: config.transferDelayMinutes || [0, 30],
    vehicleAvailabilityProbability: config.vehicleAvailabilityProbability ?? 0.96,
    regionalCorrelation: config.regionalCorrelation ?? 0.35,
  };
  const configHash = Contract.hashArtifact(safeConfig);
  const samples = [];
  const between = (range) => range[0] + random() * (range[1] - range[0]);
  for (let index = 0; index < sampleCount; index += 1) {
    const regional = random() < safeConfig.regionalCorrelation ? 1.12 : 1;
    const travel = between(safeConfig.travelTimeMultiplier) * regional;
    const service = between(safeConfig.serviceDurationMultiplier);
    const demand = between(safeConfig.demandVolumeMultiplier);
    const dock = between(safeConfig.dockProcessingMultiplier) * regional;
    const driverDelay = between(safeConfig.driverCheckInDelayMinutes);
    const transferDelay = between(safeConfig.transferDelayMinutes);
    const unavailable = random() > safeConfig.vehicleAvailabilityProbability ? 1 : 0;
    const timeout = travel * dock > 1.55;
    const failed = !timeout && demand > 1.13 && unavailable === 1;
    const sample = {
      sampleIndex: index + 1,
      seed,
      sourceScenarioHash: base.sourceScenarioHash,
      factors: { travel: round(travel, 5), service: round(service, 5), demand: round(demand, 5), dock: round(dock, 5), driverDelay: round(driverDelay), transferDelay: round(transferDelay), unavailable },
      status: timeout ? "TIMEOUT" : failed ? "FAILED" : "PASS",
      verifierStatus: timeout || failed ? "NOT_COUNTED_SUCCESS" : "PASS",
      metrics: {
        serviceRate: round(Math.max(0, base.serviceRate - (travel - 1) * 0.08 - unavailable * 0.04), 4),
        cost: round(base.cost * (0.55 * travel + 0.25 * demand + 0.2 * dock), 2),
        carbonKg: round(base.carbonKg * (0.7 * travel + 0.3 * demand), 2),
        latestCompletionMinute: round(base.latestCompletionMinute * Math.max(travel, service) + driverDelay),
        dockQueueMinutes: round(base.dockQueueMinutes * dock + driverDelay * 0.2),
        missedTransfers: transferDelay > 24 ? 1 : 0,
        vehicleRequirement: base.vehicleRequirement + unavailable + (demand > 1.1 ? 1 : 0),
      },
    };
    sample.sampleHash = Contract.hashArtifact(sample);
    samples.push(sample);
  }
  const successful = samples.filter((sample) => sample.status === "PASS");
  const distributions = {};
  for (const metric of ["serviceRate", "cost", "carbonKg", "latestCompletionMinute", "dockQueueMinutes", "missedTransfers", "vehicleRequirement"]) distributions[metric] = summarize(successful.map((sample) => sample.metrics[metric]));
  const robustnessScore = round((distributions.serviceRate.p90 || 0) * 100 - (distributions.missedTransfers.p90 || 0) * 5 - (samples.filter((sample) => sample.status !== "PASS").length / sampleCount) * 20, 2);
  const result = {
    schemaVersion: "stct-uncertainty-ensemble-v1.8",
    label: LABEL,
    modelVersion: VERSION,
    seed,
    sampleCount,
    sourceScenarioHash: base.sourceScenarioHash,
    config: safeConfig,
    configHash,
    samples,
    counts: { passed: successful.length, failed: samples.filter((sample) => sample.status === "FAILED").length, timeout: samples.filter((sample) => sample.status === "TIMEOUT").length, missing: sampleCount - samples.length },
    distributions,
    robustnessScore,
    robustnessFormula: "P90 service percent x 100 - P90 missed transfers x 5 - non-pass rate x 20",
    selection: { nominalCandidateId: "NOMINAL-1", robustCandidateId: "ROBUST-1", autoApplied: false, successfulSamplesVerifierValid: successful.every((sample) => sample.verifierStatus === "PASS") },
    caveats: ["Synthetic seeded analysis", "Not a forecast", "No external forecasting service", "Percentiles reflect only this fixture model"],
  };
  result.ensembleHash = Contract.hashArtifact(result);
  return result;
}

function capsuleSummary(result) {
  return {
    label: result.label,
    ensembleHash: result.ensembleHash,
    sourceScenarioHash: result.sourceScenarioHash,
    seed: result.seed,
    sampleCount: result.sampleCount,
    counts: result.counts,
    distributions: result.distributions,
    caveats: result.caveats,
    rawSamplesIncluded: false,
  };
}

function views(result) {
  return { noWebGLTable: result.distributions, mobile: { sampleCount: result.sampleCount, serviceP90: result.distributions.serviceRate.p90, costP90: result.distributions.cost.p90 }, reducedMotion: true, usesAnimatedParticles: false, label: result.label };
}

module.exports = { VERSION, LABEL, randomGenerator, percentile, summarize, runEnsemble, capsuleSummary, views };
