"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "stct-requirement-traceability-v1.7";
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const expectedIds = () => Array.from({ length: 674 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`);
function issue(code, detail = {}) { return { code, detail }; }

function validateRegistry(registry, options = {}) {
  const root = path.resolve(options.root || __dirname); const errors = []; const warnings = []; const rows = Array.isArray(registry?.requirements) ? registry.requirements : [];
  if (registry?.schemaVersion !== "stct-requirements-registry-v1.7" || registry?.expectedRequirementCount !== 674) errors.push(issue("REGISTRY_SCHEMA_INVALID"));
  const ids = rows.map((row) => row.id); const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index); if (duplicates.length) errors.push(issue("DUPLICATE_REQUIREMENT_ID", { ids: [...new Set(duplicates)] }));
  const expected = options.expectedIds || expectedIds(); const missing = expected.filter((id) => !ids.includes(id)); const extra = ids.filter((id) => !expected.includes(id)); if (missing.length) errors.push(issue("MISSING_REQUIREMENT_ID", { ids: missing })); if (extra.length) errors.push(issue("EXTRA_REQUIREMENT_ID", { ids: extra }));
  for (const row of rows) {
    for (const field of ["id", "requirement", "gate", "risk", "testLayer", "version"]) if (!String(row?.[field] || "").trim()) errors.push(issue("REQUIREMENT_FIELD_EMPTY", { id: row?.id, field }));
    if (!Array.isArray(row.testFiles) || !row.testFiles.length) errors.push(issue("TEST_FILE_MISSING", { id: row.id })); else row.testFiles.forEach((file) => { if (!fs.existsSync(path.resolve(root, file))) errors.push(issue("TEST_FILE_NOT_FOUND", { id: row.id, file })); });
    if (!Array.isArray(row.assertionIds) || !row.assertionIds.length) errors.push(issue("ASSERTION_ID_MISSING", { id: row.id }));
    if (!Array.isArray(row.evidencePaths) || !row.evidencePaths.length) errors.push(issue("EVIDENCE_PATH_MISSING", { id: row.id })); else row.evidencePaths.forEach((file) => { if (!fs.existsSync(path.resolve(root, file))) errors.push(issue("EVIDENCE_FILE_NOT_FOUND", { id: row.id, file })); });
    if (row.risk === "P0" && row.negative !== true) errors.push(issue("P0_NEGATIVE_TEST_MISSING", { id: row.id }));
    if (row.migration?.status === "MIGRATED_AND_REVALIDATED" && !row.migration.from) errors.push(issue("MIGRATION_SOURCE_MISSING", { id: row.id }));
  }
  const hardGates = new Set(rows.map((row) => row.gate)); for (const gate of hardGates) if (!rows.some((row) => row.gate === gate && /^E2E_|PERFORMANCE|META_TEST|BASELINE/.test(row.testLayer))) warnings.push(issue("GATE_WITHOUT_E2E", { gate }));
  return { status: errors.length ? "FAIL" : "PASS", errors, warnings, requirementCount: rows.length, uniqueCount: new Set(ids).size, missing, extra };
}

function validateResults(registry, results, commands = [], options = {}) {
  const root = path.resolve(options.root || __dirname); const errors = []; const warnings = []; const rows = Array.isArray(results) ? results : []; const byAssertion = new Map();
  for (const result of rows) {
    if (!result.assertionId) errors.push(issue("ASSERTION_ID_MISSING", { result })); else { const prior = byAssertion.get(result.assertionId) || []; prior.push(result); byAssertion.set(result.assertionId, prior); }
    for (const field of ["requirementId", "status", "observed", "expected", "evidence"]) if (result[field] === undefined || result[field] === "") errors.push(issue("ASSERTION_FIELD_MISSING", { assertionId: result.assertionId, field }));
    if (String(result.status).startsWith("SKIPPED") && !result.reason) errors.push(issue("SKIP_REASON_MISSING", { assertionId: result.assertionId }));
    if (result.evidence && !fs.existsSync(path.resolve(root, result.evidence))) errors.push(issue("EVIDENCE_FILE_NOT_FOUND", { assertionId: result.assertionId, evidence: result.evidence }));
    if (result.evidenceHash && result.evidence && fs.existsSync(path.resolve(root, result.evidence)) && result.evidenceHash !== sha256(path.resolve(root, result.evidence))) errors.push(issue("EVIDENCE_HASH_MISMATCH", { assertionId: result.assertionId }));
  }
  const required = registry.requirements.flatMap((row) => row.assertionIds); const missing = required.filter((id) => !byAssertion.has(id)); if (missing.length) errors.push(issue("ASSERTION_NOT_EXECUTED", { ids: missing }));
  for (const [id, mapped] of byAssertion) if (mapped.length > 3) warnings.push(issue("ASSERTION_OVERMAPPED", { assertionId: id, count: mapped.length }));
  commands.forEach((command) => { if (command.reportedStatus === "PASS" && command.exitCode !== 0) errors.push(issue("PASS_WITH_NONZERO_EXIT", { command: command.command, exitCode: command.exitCode })); });
  const known = new Set(registry.requirements.map((row) => row.id)); const extra = rows.filter((row) => !known.has(row.requirementId)); if (extra.length) errors.push(issue("RESULT_REQUIREMENT_EXTRA", { ids: extra.map((row) => row.requirementId) }));
  return { status: errors.length ? "FAIL" : "PASS", errors, warnings, assertionCount: rows.length, missing };
}

function lexicalCoverage(source, executedIds = []) { const withoutComments = String(source).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); const lexical = [...new Set([...withoutComments.matchAll(/\bT\d{3}\b/g)].map((match) => match[0]))]; const executed = new Set(executedIds); return { auxiliaryOnly: true, lexical, unexecuted: lexical.filter((id) => !executed.has(id)) }; }
function summarize(registry, results) { const aggregate = (key) => Object.fromEntries([...new Set(registry.requirements.map((row) => row[key]))].sort().map((value) => [value, { requirements: registry.requirements.filter((row) => row[key] === value).length, passed: results.filter((row) => row.status === "PASS" && registry.requirements.find((requirement) => requirement.id === row.requirementId)?.[key] === value).length }])); return { byGate: aggregate("gate"), byRisk: aggregate("risk"), byTestLayer: aggregate("testLayer") }; }
function renderHtml(report) { const sections = Object.entries(report.summary.byGate).map(([gate, value]) => `<tr><th>${gate}</th><td>${value.passed}</td><td>${value.requirements}</td></tr>`).join(""); return `<!doctype html><html lang="en"><meta charset="utf-8"><title>STCT v1.7 Traceability</title><style>body{font:14px system-ui;margin:32px;color:#123}table{border-collapse:collapse}th,td{border:1px solid #ccd;padding:8px;text-align:left}</style><h1>STCT v1.7 Requirement Traceability</h1><p>Status: <b>${report.status}</b></p><p>Semantic registry: ${report.requirementCount} requirements. Lexical coverage is auxiliary only.</p><table><tr><th>Gate</th><th>Passed</th><th>Requirements</th></tr>${sections}</table></html>\n`; }
module.exports = { VERSION, expectedIds, validateRegistry, validateResults, lexicalCoverage, summarize, renderHtml, sha256 };
