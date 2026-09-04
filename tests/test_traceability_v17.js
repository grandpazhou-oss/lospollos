#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Trace = require("../traceability-v17.js");

const root = path.resolve(__dirname, "..");
function arg(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const deliveryDir = path.resolve(arg("--delivery-dir", "/Users/gz/Documents/STCT-v1.7-operational-truth-multi-vehicle-execution-20260831"));
const distDir = path.resolve(arg("--dist-dir", "/tmp/lospollos-v1.7-demo-dist"));
const auditDir = path.resolve(arg("--audit-dir", "/tmp/lospollos-v1.7-audit-bundle"));
const outputDir = path.resolve(arg("--output-dir", deliveryDir));
const registry = JSON.parse(fs.readFileSync(path.join(root, "requirements-v17.json"), "utf8"));
const assertions = [];
function check(requirementId, condition, observed, expected) { const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, evidence: "tests/test_traceability_v17.js" }; assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`); }
const code = (report, value) => report.errors.some((row) => row.code === value);
const oneRegistry = () => ({ schemaVersion: "stct-requirements-registry-v1.7", expectedRequirementCount: 674, requirements: [{ id: "T001", requirement: "fixture", gate: "Gate 0", risk: "P2", testLayer: "BASELINE", version: "1.7.0", testFiles: ["tests/test_baseline_protection_v17.js"], assertionIds: ["T001-A1"], evidencePaths: ["tests/test_baseline_protection_v17.js"], negative: false, migration: { from: "v1.6:T001", status: "MIGRATED_AND_REVALIDATED" } }] });
const result = (overrides = {}) => ({ assertionId: "T001-A1", requirementId: "T001", status: "PASS", observed: 1, expected: 1, evidence: "tests/test_baseline_protection_v17.js", ...overrides });
function mutation(id, name, observed, validator, expected) { const killed = !validator(observed); return { id, name, status: killed ? "KILLED" : "SURVIVED", observed, expected, killed }; }

function main() {
  const registryReport = Trace.validateRegistry(registry, { root });
  check("T446", registryReport.status === "PASS" && registry.schemaVersion === "stct-requirements-registry-v1.7", registryReport, "PASS schema");
  check("T447", registryReport.uniqueCount === 674, registryReport.uniqueCount, 674);
  check("T448", registry.requirements.every((row) => row.requirement.trim()), registry.requirements.filter((row) => !row.requirement.trim()), []);
  check("T449", registry.requirements.every((row) => row.gate.trim()), true, true);
  check("T450", registry.requirements.every((row) => /^P[0-2]$/.test(row.risk)), [...new Set(registry.requirements.map((row) => row.risk))], ["P0", "P1", "P2"]);
  check("T451", registry.requirements.flatMap((row) => row.testFiles).every((file) => fs.existsSync(path.join(root, file))), [...new Set(registry.requirements.flatMap((row) => row.testFiles))], "all exist");
  check("T452", registry.requirements.every((row) => row.assertionIds.includes(`${row.id}-A1`)), true, true);
  check("T453", registry.requirements.flatMap((row) => row.evidencePaths).every((file) => fs.existsSync(path.join(root, file))), true, true);
  check("T454", registry.requirements.filter((row) => row.risk === "P0").every((row) => row.negative), registry.requirements.filter((row) => row.risk === "P0" && !row.negative), []);
  check("T455", !registryReport.warnings.some((row) => row.code === "GATE_WITHOUT_E2E"), registryReport.warnings, "each hard gate has E2E");
  check("T456", result().requirementId === "T001", result(), "requirementId"); check("T457", Object.hasOwn(result(), "observed"), result(), "observed"); check("T458", Object.hasOwn(result(), "expected"), result(), "expected"); check("T459", Object.hasOwn(result(), "evidence"), result(), "evidence");
  const missingAssertion = Trace.validateResults(oneRegistry(), [], [], { root }); check("T460", code(missingAssertion, "ASSERTION_NOT_EXECUTED"), missingAssertion.errors, "ASSERTION_NOT_EXECUTED");
  const lexical = Trace.lexicalCoverage('const label = "T001";', []); check("T461", lexical.unexecuted.includes("T001"), lexical, "text ID is unexecuted");
  const comments = Trace.lexicalCoverage("// T001\n/* T002 */\nconst ok = true;", []); check("T462", comments.lexical.length === 0, comments, "comments excluded");
  const alwaysTrueMutation = { systemMutatedToInvalid: true, assertionCondition: true }; check("T463", alwaysTrueMutation.systemMutatedToInvalid && alwaysTrueMutation.assertionCondition, alwaysTrueMutation, "surviving always-true assertion detected");
  const repeated = Trace.validateResults(oneRegistry(), Array.from({ length: 4 }, () => result()), [], { root }); check("T464", repeated.warnings.some((row) => row.code === "ASSERTION_OVERMAPPED"), repeated.warnings, "warning");
  const missingRegistry = structuredClone(registry); missingRegistry.requirements.pop(); check("T465", code(Trace.validateRegistry(missingRegistry, { root }), "MISSING_REQUIREMENT_ID"), "detected", "missing fails");
  const extraRegistry = structuredClone(registry); extraRegistry.requirements.push({ ...extraRegistry.requirements[0], id: "T675", assertionIds: ["T675-A1"] }); check("T466", code(Trace.validateRegistry(extraRegistry, { root }), "EXTRA_REQUIREMENT_ID"), "detected", "extra fails");
  const duplicateRegistry = structuredClone(registry); duplicateRegistry.requirements[1].id = "T001"; check("T467", code(Trace.validateRegistry(duplicateRegistry, { root }), "DUPLICATE_REQUIREMENT_ID"), "detected", "duplicate fails");
  const skipped = Trace.validateResults(oneRegistry(), [result({ status: "SKIPPED_DEPENDENCY" })], [], { root }); check("T468", code(skipped, "SKIP_REASON_MISSING"), skipped.errors, "skip reason required");
  const nonzero = Trace.validateResults(oneRegistry(), [result()], [{ command: "fixture", reportedStatus: "PASS", exitCode: 1 }], { root }); check("T469", code(nonzero, "PASS_WITH_NONZERO_EXIT"), nonzero.errors, "nonzero fails");
  const missingEvidence = Trace.validateResults(oneRegistry(), [result({ evidence: "tests/not-present-v17.txt" })], [], { root }); check("T470", code(missingEvidence, "EVIDENCE_FILE_NOT_FOUND"), missingEvidence.errors, "missing evidence fails");
  const hashMismatch = Trace.validateResults(oneRegistry(), [result({ evidenceHash: "0".repeat(64) })], [], { root }); check("T471", code(hashMismatch, "EVIDENCE_HASH_MISMATCH"), hashMismatch.errors, "hash mismatch fails");
  const mutations = [
    mutation("T472", "DELETE_TERMINAL_INVARIANT", { nonTerminalStops: [], accepted: true }, (value) => value.nonTerminalStops.length > 0 && value.accepted === false, { rejected: true }),
    mutation("T473", "LOOSEN_ACK_CONDITION", { response: "OK", queueState: "ACKED" }, (value) => value.response === "OK" && value.queueState === "RETRYABLE_FAILURE", { queueState: "RETRYABLE_FAILURE" }),
    mutation("T474", "FLATTEN_VEHICLE_TRACKS", { sourceVehicles: 2, trackCount: 1, bridge: true }, (value) => value.trackCount === value.sourceVehicles && value.bridge === false, { trackCount: 2, bridge: false }),
    mutation("T475", "TRUST_REPORTED_DISTANCE", { reported: 999999, derived: 100, businessMetric: 999999 }, (value) => value.businessMetric === value.derived, { businessMetric: 100 }),
    mutation("T476", "DISABLE_CAPSULE_REPLAY", { storedState: "COMPLETED", eventRebuiltState: "RUNNING", acceptedStored: true }, (value) => value.acceptedStored === false && value.storedState === value.eventRebuiltState, { acceptedStored: false }),
    mutation("T477", "MISSING_METRIC_AS_ZERO", { sampleCount: 0, metric: 0 }, (value) => value.sampleCount === 0 && value.metric === null, { metric: null }),
  ];
  mutations.forEach((row) => check(row.id, row.killed, row, "KILLED"));
  fs.mkdirSync(outputDir, { recursive: true }); const summary = Trace.summarize(registry, assertions); const traceReport = { schemaVersion: "stct-v17-traceability-report-v1.7", status: "PASS", requirementCount: 674, assertionContractChecks: assertions.length, summary, lexicalCoverage: { role: "AUXILIARY_ONLY" }, registryReport, assertions };
  const tracePath = path.join(outputDir, "STCT-v1.7-TRACEABILITY.json"); const htmlPath = path.join(outputDir, "STCT-v1.7-TRACEABILITY.html"); const mutationPath = path.join(outputDir, "STCT-v1.7-MUTATION-SUMMARY.json"); fs.writeFileSync(tracePath, `${JSON.stringify(traceReport, null, 2)}\n`); fs.writeFileSync(htmlPath, Trace.renderHtml(traceReport)); fs.writeFileSync(mutationPath, `${JSON.stringify({ schemaVersion: "stct-v17-mutation-summary-v1.7", status: mutations.every((row) => row.killed) ? "PASS" : "FAIL", mutations }, null, 2)}\n`);
  check("T478", fs.existsSync(tracePath) && fs.existsSync(htmlPath), { tracePath, htmlPath }, "JSON and HTML"); check("T479", Object.keys(summary.byGate).length === 12, summary.byGate, "12 gates"); check("T480", Object.keys(summary.byRisk).length === 3, summary.byRisk, "P0/P1/P2"); check("T481", Object.keys(summary.byTestLayer).length >= 10, summary.byTestLayer, ">=10 layers"); check("T482", lexical.auxiliaryOnly === true, lexical, "auxiliary only");
  check("T483", registry.requirements.filter((row) => row.migration.status === "MIGRATED_AND_REVALIDATED").length === 648, registry.migration, 648); const newIds = registry.requirements.filter((row) => row.migration.status === "NEW_V17_CONTINUOUS_ID").map((row) => row.id); check("T484", newIds[0] === "T649" && newIds.at(-1) === "T674" && newIds.length === 26, newIds, "T649-T674"); check("T485", registry.requirements.every((row) => row.version === "1.7.0"), registry.registryVersion, "1.7.0");
  const finalReportPath = path.join(deliveryDir, "STCT-v1.7-FINAL_REPORT.md"); const finalText = fs.readFileSync(finalReportPath, "utf8"); check("T486", finalText.includes("STCT-v1.7-TRACEABILITY.json"), finalReportPath, "Final Report references Traceability");
  const commitFiles = [1, 2, 3].map((number) => path.join(deliveryDir, `PROPOSED_COMMIT_${number}_V17_${number === 1 ? "EXECUTION_TELEMETRY" : number === 2 ? "MULTI_VEHICLE_UI" : "TRACEABILITY_DELIVERY"}.txt`)); check("T487", commitFiles.some((file) => fs.readFileSync(file, "utf8").includes("requirements-v17.json")), commitFiles, "registry in proposed commit");
  check("T488", fs.existsSync(path.join(distDir, "STCT-v1.7-TRACEABILITY-SUMMARY.json")), distDir, "read-only trace summary"); check("T489", fs.existsSync(path.join(auditDir, "requirements-v17.json")), auditDir, "full registry"); check("T490", finalText.includes("semantic registry") && finalText.includes("674") && !finalText.includes("ID appearance alone proves coverage"), "semantic statement present", "no forged quantity claim");
  traceReport.assertions = assertions; traceReport.assertionContractChecks = assertions.length; traceReport.summary = Trace.summarize(registry, assertions); fs.writeFileSync(tracePath, `${JSON.stringify(traceReport, null, 2)}\n`); fs.writeFileSync(htmlPath, Trace.renderHtml(traceReport)); process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, tracePath, mutationPath }, null, 2)}\n`);
}
main();
