#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const CanonicalDiff = require("../canonical-diff-v15.js");
const { buildFixture, clone } = require("../tests/experience_fixture_v14.js");

const evidenceRoot = path.resolve(process.env.STCT_KNOWN_FAILURE_ROOT || "/tmp/lospollos-v1.5-baseline-20260830_230200/known-failures");
const afterPath = path.join(evidenceRoot, "F14-10", "after-evidence.json");
const manifestPath = path.join(evidenceRoot, "WAVE_B_AFTER_MANIFEST.sha256");

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyManifest(name) {
  const manifest = path.join(evidenceRoot, name);
  const rows = fs.readFileSync(manifest, "utf8").trim().split(/\n+/);
  rows.forEach((row) => {
    const match = row.match(/^([a-f0-9]{64})  \.\/(.+)$/);
    assert(match, `Invalid manifest row in ${name}: ${row}`);
    const file = path.join(evidenceRoot, match[2]);
    assert.strictEqual(sha256File(file), match[1], `Evidence changed since ${name}: ${match[2]}`);
  });
  return rows.length;
}

function capture() {
  assert(!fs.existsSync(afterPath), `Refusing to overwrite existing After evidence: ${afterPath}`);
  assert(!fs.existsSync(manifestPath), `Refusing to overwrite existing After manifest: ${manifestPath}`);
  const phase0EntriesVerified = verifyManifest("EVIDENCE_MANIFEST.sha256");
  const waveAEntriesVerified = verifyManifest("WAVE_A_AFTER_MANIFEST.sha256");
  const fixture = buildFixture({ orderCount: 4, routeCount: 2, planSuffix: "F14-10-AFTER", inputSuffix: "F14-10-A" });
  const beforeScenario = clone(fixture.scenario);
  const afterScenario = clone(fixture.scenario);
  beforeScenario.inputHash = "sha256:input-F14-10-A";
  afterScenario.inputHash = "sha256:input-F14-10-B";
  const order = afterScenario.orders.find((row) => row.id === "ORDER-001");
  assert(order, "ORDER-001 fixture missing");
  order.lon += 0.01;
  order.volume += 1;
  order.twEnd = "16:00";
  order.priorityWeight += 1;
  const result = CanonicalDiff.scenarioDiff(beforeScenario, afterScenario, { synthetic: true });
  const expected = ["lon", "volume", "twEnd", "priorityWeight"];
  const mutations = expected.map((field) => CanonicalDiff.findChange(result, "ORDER", "ORDER-001", field));
  assert(mutations.every(Boolean), `Missing same-ID mutations: ${expected.filter((field, index) => !mutations[index]).join(", ")}`);
  assert.strictEqual(result.orders.added.length, 0);
  assert.strictEqual(result.orders.removed.length, 0);
  assert.strictEqual(result.orders.mutated.length, 1);
  const evidence = {
    evidenceId: "F14-10",
    title: "Scenario Delta misses same-ID order field mutations",
    phase: "Wave B - Explainability and Field-Level Canonical Diff",
    versionUnderTest: "v1.5",
    recordedAt: new Date().toISOString(),
    result: "KNOWN_FAILURE_FIXED",
    tests: ["T099", "T100", "T101", "T102"],
    module: {
      relativePath: "canonical-diff-v15.js",
      sha256: sha256File(path.resolve(__dirname, "..", "canonical-diff-v15.js")),
      version: CanonicalDiff.VERSION,
    },
    orderId: "ORDER-001",
    inputHashA: beforeScenario.inputHash,
    inputHashB: afterScenario.inputHash,
    expectedMutations: expected.map((field) => `orders.ORDER-001.${field}`),
    actualMutations: mutations.map((change) => ({
      entityType: change.entityType,
      entityId: change.entityId,
      field: change.field,
      before: change.before,
      after: change.after,
      displayBefore: change.displayBefore,
      displayAfter: change.displayAfter,
      classification: change.classification,
      changeType: change.changeType,
    })),
    summary: result.summary,
    sameIdRecognizedAsMutation: true,
    addedOrderIds: result.orders.added.map((row) => row.id),
    removedOrderIds: result.orders.removed.map((row) => row.id),
    sourceAuthority: "Canonical Scenario A/B field comparison",
  };
  fs.writeFileSync(afterPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o444 });
  fs.chmodSync(afterPath, 0o444);
  fs.writeFileSync(manifestPath, `${sha256File(afterPath)}  ./F14-10/after-evidence.json\n`, { encoding: "utf8", mode: 0o444 });
  fs.chmodSync(manifestPath, 0o444);
  verifyManifest("EVIDENCE_MANIFEST.sha256");
  verifyManifest("WAVE_A_AFTER_MANIFEST.sha256");
  const waveBEntriesVerified = verifyManifest("WAVE_B_AFTER_MANIFEST.sha256");
  return {
    status: "PASS",
    phase0EntriesVerified,
    waveAEntriesVerified,
    waveBEntriesVerified,
    evidence: path.relative(evidenceRoot, afterPath),
    manifest: path.basename(manifestPath),
  };
}

try {
  process.stdout.write(`${JSON.stringify(capture(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
