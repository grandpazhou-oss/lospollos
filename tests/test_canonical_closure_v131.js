#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
global.window = { crypto: globalThis.crypto };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
const canonical = window.STCTCanonical;
canonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "shared", "canonical-hash-fixtures-v131.json"), "utf8"));

const clone = (value) => JSON.parse(JSON.stringify(value));
const reverseObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]));
  return value;
};

async function evaluate(row) {
  try {
    const identity = await canonical.scenarioIdentity(row.scenario);
    const request = await canonical.requestIdentity(identity.inputHash, row.requestOptions);
    const plan = await canonical.planIdentity(identity.inputHash, row.plan);
    return {
      expectedCanonicalUtf8Hex: Buffer.from(identity.inputBytes, "utf8").toString("hex"),
      expectedCanonicalText: identity.inputBytes,
      expectedContentHash: identity.contentHash,
      expectedInputHash: identity.inputHash,
      expectedRequestHash: request.requestHash,
      expectedPlanHash: plan.planHash,
      expectedErrorCode: null,
    };
  } catch (error) {
    return { expectedErrorCode: error.code || error.name };
  }
}

async function main() {
  assert.strictEqual(fixture.caseCount, 30);
  const results = [];
  for (const row of fixture.cases) {
    const actual = await evaluate(row);
    assert.strictEqual(actual.expectedErrorCode, row.expected.expectedErrorCode, `${row.id}: error code`);
    if (!actual.expectedErrorCode) {
      for (const field of ["expectedCanonicalUtf8Hex", "expectedCanonicalText", "expectedContentHash", "expectedInputHash", "expectedRequestHash", "expectedPlanHash"]) {
        assert.strictEqual(actual[field], row.expected[field], `${row.id}: ${field}`);
      }
    }
    results.push({ id: row.id, status: "PASS", errorCode: actual.expectedErrorCode });
  }

  const base = fixture.cases.find((row) => row.id === "22-request-options");
  const expected = await canonical.scenarioIdentity(base.scenario);
  for (let index = 0; index < 20; index += 1) {
    const shuffled = reverseObjectKeys(clone(base.scenario));
    if (index % 2) shuffled.orders.reverse();
    if (index % 3) shuffled.vehicles.reverse();
    const actual = await canonical.scenarioIdentity(shuffled);
    assert.strictEqual(actual.inputHash, expected.inputHash, `deterministic shuffle ${index + 1}`);
  }

  assert.strictEqual(canonical.importDate("2026/5/1", "adapter.date"), "2026-05-01");
  assert.strictEqual(canonical.importTime("1:02", "adapter.time"), "01:02");
  assert.throws(() => canonical.date("2026/5/1", "canonical.date"), (error) => error.code === "CANONICALIZATION_ERROR");
  assert.throws(() => canonical.time("1:02", "canonical.time"), (error) => error.code === "CANONICALIZATION_ERROR");
  assert.throws(() => canonical.text(true, { required: true, field: "identifier" }), (error) => error.code === "CANONICAL_TYPE_ERROR");
  assert.throws(() => canonical.requestEnvelope(expected.inputHash, { ...base.requestOptions, unknown: true }), (error) => error.code === "UNKNOWN_REQUEST_OPTION");

  process.stdout.write(`${JSON.stringify({ status: "PASS", runtime: "javascript", fixtures: results.length, deterministicShuffles: 20, adapterBoundaryChecks: 6, results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
