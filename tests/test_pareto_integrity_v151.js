#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Pareto = require("../pareto-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function candidate(base, suffix) {
  const value = clone(base);
  value.planId = `PLAN-V151-${suffix}`;
  value.planHash = `sha256:v151-${suffix.toLowerCase()}`;
  value.verification.status = "PASS";
  value.verification.recomputedMetrics = {
    ...value.verification.recomputedMetrics,
    servicePriorityScore: 12,
    assigned: 12,
    blocked: 0,
    totalCost: 100,
    changeCount: 2,
  };
  return value;
}

function remove(candidateValue, field) {
  delete candidateValue.verification.recomputedMetrics[field];
}

function exclude(candidateValue, dimensions) {
  const report = Pareto.observedFrontier([candidateValue], { dimensions });
  assert.strictEqual(report.candidateCount, 0, candidateValue.planId);
  return report.excluded[0];
}

const fixture = buildFixture({ orderCount: 12, routeCount: 4, planSuffix: "P151", inputSuffix: "P151" });
const cases = [
  ["missing-total-cost", "totalCost", "MISSING_RECOMPUTED_METRIC", (row) => remove(row, "totalCost")],
  ["null-total-cost", "totalCost", "MISSING_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = null; }],
  ["string-total-cost", "totalCost", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = "100"; }],
  ["nan-total-cost", "totalCost", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = NaN; }],
  ["infinity-total-cost", "totalCost", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = Infinity; }],
  ["negative-infinity-total-cost", "totalCost", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = -Infinity; }],
  ["boolean-total-cost", "totalCost", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = false; }],
  ["object-total-cost", "totalCost", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.totalCost = { value: 100 }; }],
  ["missing-priority", "servicePriorityScore", "MISSING_RECOMPUTED_METRIC", (row) => remove(row, "servicePriorityScore")],
  ["null-priority", "servicePriorityScore", "MISSING_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.servicePriorityScore = null; }],
  ["string-priority", "servicePriorityScore", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.servicePriorityScore = "12"; }],
  ["nan-priority", "servicePriorityScore", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.servicePriorityScore = NaN; }],
  ["missing-assigned", "assigned", "MISSING_RECOMPUTED_METRIC", (row) => remove(row, "assigned")],
  ["null-assigned", "assigned", "MISSING_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.assigned = null; }],
  ["string-assigned", "assigned", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.assigned = "12"; }],
  ["missing-blocked", "blocked", "MISSING_RECOMPUTED_METRIC", (row) => remove(row, "blocked")],
  ["null-blocked", "blocked", "MISSING_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.blocked = null; }],
  ["infinity-blocked", "blocked", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.blocked = Infinity; }],
  ["missing-change-count", "changeCount", "MISSING_RECOMPUTED_METRIC", (row) => remove(row, "changeCount")],
  ["meta-change-count", "changeCount", "MISSING_RECOMPUTED_METRIC", (row) => { remove(row, "changeCount"); row.meta = { changeCount: 2 }; }],
  ["candidate-change-count", "changeCount", "MISSING_RECOMPUTED_METRIC", (row) => { remove(row, "changeCount"); row.changeCount = 2; }],
  ["unverified-diff-change-count", "changeCount", "MISSING_RECOMPUTED_METRIC", (row) => { remove(row, "changeCount"); row.verification.verifiedPlanDiff = { status: "FAIL", changeCount: 2 }; }],
  ["string-change-count", "changeCount", "NON_FINITE_RECOMPUTED_METRIC", (row) => { row.verification.recomputedMetrics.changeCount = "2"; }],
];

cases.forEach(([name, field, reasonCode, mutate], index) => {
  const row = candidate(fixture.plan, String(index + 1).padStart(2, "0"));
  mutate(row);
  const result = exclude(row, [field === "servicePriorityScore" || field === "assigned" || field === "blocked" ? "totalCost" : field]);
  assert.strictEqual(result.reasonCode, reasonCode, name);
  assert.strictEqual(result.field, field, name);
});

const verifiedDiff = candidate(fixture.plan, "VERIFIED-DIFF");
remove(verifiedDiff, "changeCount");
verifiedDiff.verification.verifiedPlanDiff = { status: "PASS", recomputedMetrics: { changeCount: 3 } };
const accepted = Pareto.observedFrontier([verifiedDiff], { dimensions: ["changeCount"] });
assert.strictEqual(accepted.candidateCount, 1);
assert.strictEqual(accepted.groups[0].points[0].values.changeCount, 3);

const verifierFail = candidate(fixture.plan, "VERIFIER-FAIL");
verifierFail.verification.status = "FAIL";
assert.strictEqual(exclude(verifierFail, ["totalCost"]).reasonCode, "VERIFIER_NOT_PASS");

process.stdout.write(`${JSON.stringify({ status: "PASS", adversarialFixtures: cases.length, verifiedDiffAccepted: true }, null, 2)}\n`);
