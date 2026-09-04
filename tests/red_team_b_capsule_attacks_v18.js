#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  assert(index >= 0 && process.argv[index + 1], `Missing ${name}`);
  return process.argv[index + 1];
}

const root = path.resolve(valueAfter("--root"));
const capsulePath = path.resolve(valueAfter("--capsule"));
const checkpointPath = path.resolve(valueAfter("--checkpoint"));
const load = (name) => require(path.join(root, name));
const Contract = load("network-contract-v18.js");
const Network = load("network-solver-v18.js");
const Execution = load("network-execution-v18.js");
const Energy = load("energy-intelligence-v18.js");
const Secure = load("secure-import-v18.js");
const clone = (value) => structuredClone(value);

function uncertaintyHash(value) {
  const projection = clone(value);
  delete projection.ensembleHash;
  return Contract.hashArtifact(projection);
}

function verify(capsule) {
  return Secure.verifyDeepCapsule(capsule, {
    networkScenario: (value) => {
      try {
        Contract.normalizeScenario(value);
        return { status: "PASS" };
      } catch (error) {
        return { status: "FAIL", issue: error.code || error.message };
      }
    },
    networkPlan: (value, sections) => Network.verifyNetworkPlan(sections.networkScenario, value),
    energy: (value) => Energy.verifyEnergy(value.fixture, value.plan),
    uncertainty: (value) => ({ status: uncertaintyHash(value) === value.ensembleHash ? "PASS" : "FAIL" }),
    executionCapsule: (value) => ({ status: Execution.replay(value).status === "EQUIVALENT" ? "PASS" : "FAIL" }),
  });
}

function reseal(capsule, sectionName) {
  if (sectionName) capsule.sectionHashes[sectionName] = Contract.hashArtifact(capsule.sections[sectionName]);
  capsule.capsuleHash = Contract.hashArtifact(Secure.deepProjection(capsule));
  return capsule;
}

function attack(name, mutate, expectedCodes) {
  const candidate = clone(original);
  mutate(candidate);
  const result = verify(candidate);
  const codes = result.issues.map((issue) => issue.code);
  const detected = result.status === "REJECTED" && expectedCodes.some((code) => codes.includes(code));
  assert(detected, `${name} was not detected: ${JSON.stringify(result)}`);
  return { name, status: "DETECTED", expectedCodes, observedCodes: codes };
}

const original = JSON.parse(fs.readFileSync(capsulePath, "utf8"));
assert.strictEqual(verify(original).status, "PASS", "Canonical Capsule must pass before attacks");

const attacks = [
  attack("section payload changed without reseal", (value) => {
    value.sections.networkPlan.metrics.totalCost += 1;
  }, ["CAPSULE_SECTION_HASH_MISMATCH", "CAPSULE_OUTER_HASH_MISMATCH"]),
  attack("network plan changed and outer identities resealed", (value) => {
    value.sections.networkPlan.metrics.totalCost += 1;
    reseal(value, "networkPlan");
  }, ["CAPSULE_SECTION_SEMANTIC_INVALID"]),
  attack("nested execution identity replaced and outer identities resealed", (value) => {
    value.sections.executionCapsule.capsuleHash = Contract.hashArtifact("forged-execution-history");
    reseal(value, "executionCapsule");
  }, ["CAPSULE_SECTION_SEMANTIC_INVALID"]),
];

const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
const corruptedCheckpoint = clone(checkpoint);
corruptedCheckpoint.source.orders[0].demand.volume += 1;
const checkpointProjection = clone(corruptedCheckpoint);
delete checkpointProjection.checkpointHash;
const checkpointCorruptionDetected = Contract.hashArtifact(checkpointProjection) !== corruptedCheckpoint.checkpointHash;
assert(checkpointCorruptionDetected, "Checkpoint corruption was not detected");

process.stdout.write(JSON.stringify({
  schemaVersion: "stct-v1.8-red-team-b-attacks-v1",
  status: "PASS",
  capsuleBaseline: "PASS",
  attacks,
  checkpointCorruption: {
    status: "DETECTED",
    savedCycle: checkpoint.savedCycle,
    expectedCheckpointHash: checkpoint.checkpointHash,
  },
  publicRoutingOrOptimizerCalls: 0,
}, null, 2) + "\n");
