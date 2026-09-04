#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
global.window = { crypto: globalThis.crypto };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
const contract = JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8"));
window.STCTCanonical.configure(contract);
vm.runInThisContext(fs.readFileSync(path.join(root, "verifier.js"), "utf8"), { filename: "verifier.js" });

const canonical = window.STCTCanonical;
const comparator = window.STCTVerifier.serviceComparator;
const clone = (value) => JSON.parse(JSON.stringify(value));

async function main() {
  assert.deepStrictEqual(canonical.priority("HIGH"), { original: "HIGH", normalized: "high", weight: 3, source: "mapped", warning: null });
  assert.deepStrictEqual(canonical.priority(" high "), { original: "high", normalized: "high", weight: 3, source: "mapped", warning: null });
  assert.strictEqual(canonical.priority("urgent").warning, "UNKNOWN_PRIORITY_DEFAULTED_TO_NORMAL");
  assert.strictEqual(canonical.priority("normal", 7).source, "explicit");
  assert.strictEqual(canonical.priority("normal", 7).weight, 7);

  const candidate = (hash, priority, assigned, distance) => ({
    planHash: `sha256:${hash.repeat(64)}`,
    metrics: { servicePriorityScore: priority, assigned, estimatedRoadKm: distance },
  });
  const priorityAdversary = [candidate("b", 102, 102, 1), candidate("a", 103, 1, 1000)].sort(comparator);
  assert.strictEqual(priorityAdversary[0].metrics.servicePriorityScore, 103);
  const assignedAdversary = [candidate("b", 103, 20, 100), candidate("a", 103, 21, 1000)].sort(comparator);
  assert.strictEqual(assignedAdversary[0].metrics.assigned, 21);
  const businessTie = [candidate("b", 103, 21, 100), candidate("a", 103, 21, 10)].sort(comparator);
  assert.strictEqual(businessTie[0].metrics.estimatedRoadKm, 10);
  const stableTie = [candidate("b", 103, 21, 10), candidate("a", 103, 21, 10)].sort(comparator);
  assert(stableTie[0].planHash.endsWith("a".repeat(64)));

  const fixture = JSON.parse(fs.readFileSync(path.join(root, "shared", "canonical-hash-fixtures.json"), "utf8")).cases[0].scenario;
  const before = await canonical.scenarioIdentity(fixture);
  const changed = clone(fixture);
  changed.orders[0].priorityWeight = 4;
  changed.orders[0].prioritySource = "explicit";
  const after = await canonical.scenarioIdentity(changed);
  assert.notStrictEqual(before.inputHash, after.inputHash);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    tests: 10,
    mapping: { high: 3, medium: 2, normal: 1 },
    comparator: "priorityScore desc -> assigned desc -> business -> planHash",
    priorityWeightChangesInputHash: true,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
