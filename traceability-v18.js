"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VERSION = "stct-requirement-traceability-v1.8";
const LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxDepth: 32, maxEntities: 5000 });
const CORE_GATES = Object.freeze([
  [1, 40, "Gate 0"], [41, 113, "Gate 1"], [114, 184, "Gate 2"], [185, 255, "Gate 3"],
  [256, 331, "Gate 4"], [332, 406, "Gate 5"], [407, 479, "Gate 6"], [480, 550, "Gate 7"],
  [551, 619, "Gate 8"], [620, 701, "Gate 9"], [702, 780, "Gate 10"], [781, 845, "Gate 11"],
  [846, 907, "Gate 12"], [908, 984, "Gate 13"], [985, 1067, "Gate 14"],
]);
const SECRET_PATTERNS = Object.freeze([
  { code: "OPENAI_TOKEN", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { code: "GITHUB_TOKEN", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { code: "AWS_ACCESS_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { code: "PRIVATE_KEY", pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/g },
]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const sha256Bytes = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sha256File = (file) => sha256Bytes(fs.readFileSync(file));
const expectedCoreIds = () => Array.from({ length: 1067 }, (_, index) => `T${String(index + 1).padStart(4, "0")}`);
const expectedOvernightIds = () => Array.from({ length: 1752 }, (_, index) => `OVN-${String(index + 1).padStart(4, "0")}`);
const issue = (code, detail = {}) => ({ code, detail });

function gateForId(id) {
  if (/^T\d{4}$/.test(id)) { const number = Number(id.slice(1)); return CORE_GATES.find(([from, to]) => number >= from && number <= to)?.[2] || "UNMAPPED"; }
  return /^OVN-\d{4}$/.test(id) ? "Gate O?" : "UNMAPPED";
}
function parseGoal(markdown) {
  const definitions = new Map(); let gate = "";
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = line.match(/^## Gate ((?:O)?\d+)\s/); if (heading) gate = `Gate ${heading[1]}`;
    const requirement = line.match(/^- \*\*(T\d{4})\*\*\s+—\s+(.+?)。?$/); if (requirement) definitions.set(requirement[1], { id: requirement[1], requirement: requirement[2].replace(/。$/, ""), gate });
  }
  return definitions;
}
function validateOfficialRegistry(registry) {
  const errors = []; const warnings = [];
  if (registry?.schemaVersion !== "stct-requirements-registry-v1") errors.push(issue("REGISTRY_SCHEMA_INVALID"));
  if (registry?.coreRequirementCount !== 1067 || registry?.overnightRequirementCount !== 1752 || registry?.totalRequirementCount !== 2819) errors.push(issue("REGISTRY_COUNT_INVALID"));
  const core = Array.isArray(registry?.coreRequirements) ? registry.coreRequirements : []; const overnight = Array.isArray(registry?.overnightRequirements) ? registry.overnightRequirements : [];
  const ids = [...core, ...overnight].map((row) => row.id); const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) errors.push(issue("DUPLICATE_REQUIREMENT_ID", { ids: [...new Set(duplicates)] }));
  const expected = [...expectedCoreIds(), ...expectedOvernightIds()]; const missing = expected.filter((id) => !ids.includes(id)); const extra = ids.filter((id) => !expected.includes(id));
  if (missing.length) errors.push(issue("MISSING_REQUIREMENT_ID", { ids: missing })); if (extra.length) errors.push(issue("EXTRA_REQUIREMENT_ID", { ids: extra }));
  if (core.some((row) => row.source !== "embedded-core-v1.8")) errors.push(issue("CORE_SOURCE_INVALID"));
  if (overnight.some((row) => !row.section || !row.requirement || !["P0", "P1"].includes(row.risk))) errors.push(issue("OVERNIGHT_FIELDS_INVALID"));
  if (!Array.isArray(registry?.hardGates) || registry.hardGates.length !== 16) errors.push(issue("HARD_GATE_REGISTRY_INVALID"));
  return { status: errors.length ? "FAIL" : "PASS", errors, warnings, counts: { core: core.length, overnight: overnight.length, total: ids.length }, uniqueCount: new Set(ids).size, missing, extra };
}
function buildCatalog(registry, goalMarkdown, results = []) {
  const definitions = parseGoal(goalMarkdown); const byRequirement = new Map();
  for (const result of results) { const rows = byRequirement.get(result.requirementId) || []; rows.push(result); byRequirement.set(result.requirementId, rows); }
  const metadata = (executed, fallbackLayer) => ({ testLayer: executed[0]?.testLayer || fallbackLayer, sourceFile: executed[0]?.sourceFile || executed[0]?.testFile || "", sourceLine: executed[0]?.sourceLine || null, command: executed[0]?.command || "", durationMs: executed.reduce((sum, item) => sum + Number(item.durationMs || 0), 0), environmentClassification: executed[0]?.environmentClassification || "LOCAL_SYNTHETIC", assertionIds: executed.map((item) => item.assertionId), evidencePaths: [...new Set(executed.map((item) => item.evidence).filter(Boolean))] });
  const core = registry.coreRequirements.map((row) => { const executed = byRequirement.get(row.id) || []; const testFile = executed[0]?.testFile || executed[0]?.evidence || ""; const inferred = /browser/i.test(testFile) ? "E2E_BROWSER" : /performance/i.test(testFile) ? "PERFORMANCE" : "SEMANTIC"; return { ...row, requirement: definitions.get(row.id)?.requirement || "", gate: definitions.get(row.id)?.gate || gateForId(row.id), risk: executed.some((item) => item.negative) ? "P0" : "P1", ...metadata(executed, inferred), version: "v1.8" }; });
  const overnight = registry.overnightRequirements.map((row) => { const executed = byRequirement.get(row.id) || []; return { ...row, gate: row.section.match(/Gate O\d+/)?.[0] || "Gate O?", ...metadata(executed, "OVERNIGHT"), version: "v1.8-overnight" }; });
  return { schemaVersion: "stct-traceability-catalog-v1.8", requirements: [...core, ...overnight] };
}
function validateResults(catalog, results, commands = [], options = {}) {
  const root = path.resolve(options.root || process.cwd()); const errors = []; const warnings = []; const known = new Set(catalog.requirements.map((row) => row.id)); const assertions = new Map();
  for (const result of results) {
    if (!result.assertionId) errors.push(issue("ASSERTION_ID_MISSING", { requirementId: result.requirementId })); else { const rows = assertions.get(result.assertionId) || []; rows.push(result); assertions.set(result.assertionId, rows); }
    for (const field of ["requirementId", "status", "observed", "expected", "evidence"]) if (result[field] === undefined || result[field] === "") errors.push(issue("ASSERTION_FIELD_MISSING", { assertionId: result.assertionId, field }));
    if (!known.has(result.requirementId)) errors.push(issue("RESULT_REQUIREMENT_EXTRA", { requirementId: result.requirementId }));
    if (String(result.status).startsWith("SKIPPED") && !result.reason) errors.push(issue("SKIP_REASON_MISSING", { assertionId: result.assertionId }));
    const evidence = result.evidence ? path.resolve(root, result.evidence) : "";
    if (evidence && !fs.existsSync(evidence)) errors.push(issue("EVIDENCE_FILE_NOT_FOUND", { assertionId: result.assertionId, evidence: result.evidence }));
    if (result.evidenceHash && evidence && fs.existsSync(evidence) && result.evidenceHash !== sha256File(evidence)) errors.push(issue("EVIDENCE_HASH_MISMATCH", { assertionId: result.assertionId }));
  }
  for (const [assertionId, rows] of assertions) {
    if (rows.length > 1) warnings.push(issue("ASSERTION_DUPLICATE_MAPPING", { assertionId, count: rows.length }));
    const requirementIds = [...new Set(rows.map((row) => row.requirementId))];
    if (requirementIds.length > Number(options.maxRequirementsPerAssertion || 8)) errors.push(issue("ASSERTION_SCOPE_EXCESSIVE", { assertionId, requirementIds }));
  }
  for (const command of commands) if (command.reportedStatus === "PASS" && command.exitCode !== 0) errors.push(issue("PASS_WITH_NONZERO_EXIT", { command: command.command, exitCode: command.exitCode }));
  return { status: errors.length ? "FAIL" : "PASS", errors, warnings, assertionCount: results.length, executedRequirements: new Set(results.map((row) => row.requirementId)).size };
}
function lexicalCoverage(source, executedIds = []) {
  const withoutComments = String(source).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); const lexical = [...new Set([...withoutComments.matchAll(/\b(?:T\d{4}|OVN-\d{4})\b/g)].map((match) => match[0]))]; const executed = new Set(executedIds);
  return { auxiliaryOnly: true, lexical, unexecuted: lexical.filter((id) => !executed.has(id)) };
}
function summarize(catalog, results) {
  const passed = new Set(results.filter((row) => row.status === "PASS").map((row) => row.requirementId));
  const aggregate = (field) => Object.fromEntries([...new Set(catalog.requirements.map((row) => row[field]).filter(Boolean))].sort().map((value) => [value, { requirements: catalog.requirements.filter((row) => row[field] === value).length, passed: catalog.requirements.filter((row) => row[field] === value && passed.has(row.id)).length }]));
  return { byGate: aggregate("gate"), byRisk: aggregate("risk"), byLayer: aggregate("testLayer") };
}
function walkSecurity(value, limits = LIMITS) {
  let entities = 0; const visit = (current, depth, location) => { if (depth > limits.maxDepth) throw Object.assign(new Error("Payload depth limit exceeded"), { code: "PAYLOAD_DEPTH_LIMIT", location }); if (!current || typeof current !== "object") return; entities += 1; if (entities > limits.maxEntities) throw Object.assign(new Error("Payload entity limit exceeded"), { code: "PAYLOAD_ENTITY_LIMIT", location }); for (const key of Object.keys(current)) { if (DANGEROUS_KEYS.has(key)) throw Object.assign(new Error("Dangerous object key rejected"), { code: "PAYLOAD_DANGEROUS_KEY", location: `${location}.${key}` }); visit(current[key], depth + 1, `${location}.${key}`); } }; visit(value, 0, "$"); return { entities, maxDepth: limits.maxDepth };
}
function safeParseJson(content, options = {}) {
  const limits = { ...LIMITS, ...options }; const bytes = Buffer.byteLength(String(content)); if (bytes > limits.maxBytes) throw Object.assign(new Error("Payload size limit exceeded"), { code: "PAYLOAD_SIZE_LIMIT", bytes });
  const value = JSON.parse(String(content), (key, item) => { if (DANGEROUS_KEYS.has(key)) throw Object.assign(new Error("Dangerous object key rejected"), { code: "PAYLOAD_DANGEROUS_KEY", key }); return item; }); walkSecurity(value, limits); return value;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function safeCsvCell(value) { const text = String(value ?? ""); const protectedValue = /^[=+\-@]/.test(text) ? `'${text}` : text; return `"${protectedValue.replace(/"/g, '""')}"`; }
function safeFilename(value, fallback = "artifact") { const clean = String(value ?? "").normalize("NFKC").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\.\.+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 120); return clean || fallback; }
function redact(content) {
  let value = String(content ?? ""); for (const row of SECRET_PATTERNS) value = value.replace(row.pattern, `<REDACTED_${row.code}>`);
  value = value.replace(/file:\/\/\/Users\/[^\s"'<>]+/g, "file://<USER_HOME>").replace(/\/Users\/[^\s"'<>]+/g, "<USER_HOME>").replace(/\/(?:private\/)?tmp\/[^\s"'<>]+/g, "<TEMP_ROOT>"); return value;
}
function scanSecrets(content) { const findings = []; for (const row of SECRET_PATTERNS) { row.pattern.lastIndex = 0; if (row.pattern.test(String(content))) findings.push(row.code); row.pattern.lastIndex = 0; } return { status: findings.length ? "FAIL" : "PASS", findings }; }
function classifyPath(file) { const normalized = String(file).replaceAll("\\", "/"); if (/\.(?:xlsx|xlsm?|csv)$/i.test(normalized) || normalized.includes("/templates/")) return { classification: "INTERNAL", distributable: false, reasonCode: "CUSTOMER_OR_TEMPLATE_DATA" }; return { classification: "SOURCE_OR_SYNTHETIC_EVIDENCE", distributable: true, reasonCode: "" }; }
function externalReference(url) { const external = /^(?:https?|ftp):\/\//i.test(String(url)); return { status: external ? "BLOCKED_EXTERNAL_REFERENCE" : "LOCAL_REFERENCE", loaded: false, url: external ? "<EXTERNAL_URL>" : String(url) }; }
function providerPolicy() { return { autoCall: false, publicOsrm: false, publicValhalla: false, publicVroom: false, coordinateTransmissionRequiresApproval: true }; }
function scanBinary(buffer) { const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer); const binary = value.includes(0); return { status: binary ? "BINARY_REVIEW_REQUIRED" : "TEXT", binary, bytes: value.length }; }
function manifest(files, root) { return files.map((file) => { const absolute = path.resolve(root, file); return { path: path.relative(root, absolute).replaceAll(path.sep, "/"), bytes: fs.statSync(absolute).size, sha256: sha256File(absolute), classification: classifyPath(absolute).classification }; }).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))); }
function migrateV17(registry) { return registry.requirements.map((row) => ({ from: row.id, to: `T${String(Number(row.id.slice(1))).padStart(4, "0")}`, fromVersion: "v1.7", toVersion: "v1.8", status: "MIGRATED_REFERENCE_ONLY_REVALIDATION_REQUIRED" })); }
function renderHtml(report) { const gates = Object.entries(report.summary.byGate).map(([gate, row]) => `<tr><th>${escapeHtml(gate)}</th><td>${row.passed}</td><td>${row.requirements}</td></tr>`).join(""); return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>STCT v1.8 Requirement Traceability</title></head><body><h1>STCT v1.8 Requirement Traceability</h1><p>Status: <strong>${escapeHtml(report.status)}</strong></p><p>${report.requirementCount} registered requirements. Lexical matches are auxiliary only.</p><table><thead><tr><th>Gate</th><th>Passed</th><th>Registered</th></tr></thead><tbody>${gates}</tbody></table></body></html>\n`; }
function buildReport(catalog, results) { const value = { schemaVersion: "stct-traceability-report-v1.8", status: results.every((row) => row.status === "PASS") ? "PASS" : "FAIL", requirementCount: catalog.requirements.length, executedRequirementCount: new Set(results.map((row) => row.requirementId)).size, assertionCount: results.length, summary: summarize(catalog, results), lexicalCoverage: "AUXILIARY_ONLY", results }; value.reportHash = `sha256:${sha256Bytes(JSON.stringify(value))}`; return value; }

module.exports = { VERSION, LIMITS, CORE_GATES, SECRET_PATTERNS, expectedCoreIds, expectedOvernightIds, gateForId, parseGoal, validateOfficialRegistry, buildCatalog, validateResults, lexicalCoverage, summarize, safeParseJson, walkSecurity, escapeHtml, safeCsvCell, safeFilename, redact, scanSecrets, classifyPath, externalReference, providerPolicy, scanBinary, manifest, migrateV17, renderHtml, buildReport, sha256File };
