#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Context = require("../platform-study-context-v8.js");

const supply = (studyId, extra = {}) => ({
  studyKind: "SUPPLY_CHAIN_PERIOD",
  studyId,
  projectId: "PROJECT-1",
  datasetVersion: "DATASET-1",
  classification: "BUSINESS_PRIVATE",
  ...extra,
});

const context = Context.createContext();
const observed = [];
const unsubscribe = context.subscribe((state) => observed.push(state));
assert.equal(context.snapshot().current, null);

const backend = { endpoint: "http://127.0.0.1:9999/facility-optimize-v19", instanceId: "solver-A", buildFingerprint: "a".repeat(64), capabilities: ["SUPPLY_CHAIN_JOBS_V6"] };
context.select(supply("DEMO-A", { inputHash: "sha256:demo", backendIdentity: backend }));
backend.capabilities.push("LATER_MUTATION");
assert.equal(context.snapshot().current.studyId, "DEMO-A");
assert.deepEqual(context.snapshot().current.backendIdentity.capabilities, ["SUPPLY_CHAIN_JOBS_V6"]);
assert.ok(Object.isFrozen(context.snapshot().current) && Object.isFrozen(context.snapshot().current.backendIdentity));

const ucTicket = context.beginSelection();
assert.equal(context.snapshot().current.studyId, "DEMO-A", "pending selection retains visible current object");
const newerTicket = context.beginSelection();
assert.equal(context.completeSelection(ucTicket, supply("OLD-UC")).code, "STUDY_SELECTION_SUPERSEDED");
assert.equal(context.snapshot().current.studyId, "DEMO-A");
assert.equal(context.completeSelection(newerTicket, supply("UC-B", { inputHash: "sha256:uc" })).ok, true);
assert.equal(context.snapshot().current.studyId, "UC-B");
assert.equal(context.snapshot().current.inputHash, "sha256:uc");
assert.equal(context.snapshot().current.current, undefined);
assert.equal(context.snapshot().current.backendIdentity, null);

const pending = context.beginSelection();
context.select({ studyKind: "NETWORK_ORDERS", studyId: "DEMO-A" });
assert.equal(context.completeSelection(pending, supply("LATE-UC")).code, "STUDY_SELECTION_SUPERSEDED");
assert.equal(context.snapshot().current.studyId, "DEMO-A", "direct selection supersedes async open");

const beforeAbort = context.snapshot().current;
const abortTicket = context.beginSelection();
assert.equal(context.abortSelection(abortTicket).ok, true);
assert.equal(context.snapshot().current, beforeAbort);
assert.equal(context.snapshot().pending, false);
assert.equal(context.completeSelection(abortTicket, supply("LATE-UC")).code, "STUDY_SELECTION_SUPERSEDED");

const beforeInvalid = context.snapshot();
assert.throws(() => context.select({ ...supply("BAD"), periodDemand: [{ quantity: 10 }] }), { code: "STUDY_CONTEXT_FIELD_UNSUPPORTED" });
assert.throws(() => context.select(supply("BAD", { backendIdentity: { token: "secret" } })), { code: "STUDY_CONTEXT_BACKEND_FIELD_UNSUPPORTED" });
assert.throws(() => context.select({ studyKind: "UNSUPPORTED", studyId: "BAD" }), { code: "STUDY_CONTEXT_IDENTITY_INVALID" });
assert.equal(context.snapshot(), beforeInvalid, "invalid identity cannot change current object");

// Hardening health/job identity must survive the real cross-page context bridge.
// This used to throw after native solving and prevent results from rendering.
const pinned = { ...backend, buildPolicy: "STRICT_PINNED", expectedBuildFingerprint: "a".repeat(64), buildMatch: true };
context.select(supply("PINNED-SYNTHETIC", { backendIdentity: pinned }));
assert.equal(context.snapshot().current.backendIdentity.buildPolicy, "STRICT_PINNED");
assert.equal(context.snapshot().current.backendIdentity.expectedBuildFingerprint, pinned.expectedBuildFingerprint);
for (const invalid of [{ buildPolicy: "PERMISSIVE" }, { expectedBuildFingerprint: "not-a-pin" }, { expectedBuildFingerprint: true }]) {
  const before = context.snapshot();
  assert.throws(() => context.select(supply("BAD-PIN", { backendIdentity: { ...pinned, ...invalid } })), { code: "STUDY_CONTEXT_BACKEND_INVALID" });
  assert.equal(context.snapshot(), before);
}
context.select(supply("EXPLICIT-COMPATIBLE", { backendIdentity: { ...backend, buildPolicy: "COMPATIBLE_WARN", expectedBuildFingerprint: null } }));
assert.equal(context.snapshot().current.backendIdentity.expectedBuildFingerprint, null);

context.clear();
assert.equal(context.snapshot().current, null);
unsubscribe();
const count = observed.length;
context.select(supply("AFTER-UNSUBSCRIBE"));
assert.equal(observed.length, count);
assert.ok(count >= 7);
console.log(JSON.stringify({ status: "PASS", test: "platform-study-context-v8", lastGeneration: context.snapshot().generation }));
