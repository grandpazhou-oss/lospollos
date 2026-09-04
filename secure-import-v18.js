"use strict";

const path = require("path");
const Contract = require("./network-contract-v18.js");

const VERSION = "stct-secure-import-v1.8";
const LIMITS = Object.freeze({ maxStringLength: 100000, maxDepth: 32, maxEntities: 5000 });
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|(?:OPENAI_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY)\s*=)/;
const LOCAL_PATH_PATTERN = /(?:file:\/\/\/)?(?:\/Users\/|\/private\/tmp\/|\/tmp\/|\/private\/var\/)[^\s"'`<>]*/g;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function escapeLabel(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safeFilename(value) {
  const name = path.basename(String(value || "artifact.json").replace(/\\/g, "/"));
  return name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "artifact.json";
}

function redactText(value) {
  return String(value ?? "").replace(LOCAL_PATH_PATTERN, "<LOCAL_PATH>").replace(SECRET_PATTERN, "<REDACTED_SECRET>");
}

function validateTabularCell(value) {
  if (typeof value === "string" && /^[=+\-@]/.test(value.trim())) return { status: "REJECTED", code: "IMPORT_FORMULA_INJECTION" };
  if (typeof value === "string" && /<(?:script|iframe|object|embed)|on\w+\s*=|javascript:/i.test(value)) return { status: "REJECTED", code: "IMPORT_ACTIVE_CONTENT" };
  return { status: "PASS", value };
}

function hasMalformedUnicode(value) {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(String(value));
}

function inspectValue(value, limits = LIMITS) {
  let entities = 0;
  const visit = (current, depth, location) => {
    if (depth > limits.maxDepth) throw Object.assign(new Error("Import depth limit exceeded"), { code: "IMPORT_DEPTH_LIMIT", location });
    if (typeof current === "string") {
      if (current.length > limits.maxStringLength) throw Object.assign(new Error("Import string limit exceeded"), { code: "IMPORT_STRING_LIMIT", location });
      if (hasMalformedUnicode(current)) throw Object.assign(new Error("Malformed Unicode rejected"), { code: "IMPORT_MALFORMED_UNICODE", location });
      return;
    }
    if (!current || typeof current !== "object") return;
    entities += 1;
    if (entities > limits.maxEntities) throw Object.assign(new Error("Import entity limit exceeded"), { code: "IMPORT_ENTITY_LIMIT", location });
    for (const key of Object.keys(current)) {
      if (DANGEROUS_KEYS.has(key)) throw Object.assign(new Error("Dangerous object key rejected"), { code: "IMPORT_DANGEROUS_KEY", location: `${location}.${key}` });
      visit(current[key], depth + 1, `${location}.${key}`);
    }
  };
  visit(value, 0, "$");
  return { entities };
}

function validateJson(value) {
  try {
    inspectValue(value);
    const safe = Contract.safeValue(value, "import");
    const text = JSON.stringify(safe);
    if (SECRET_PATTERN.test(text)) return { status: "REJECTED", code: "IMPORT_SECRET_PATTERN" };
    LOCAL_PATH_PATTERN.lastIndex = 0;
    if (LOCAL_PATH_PATTERN.test(text)) { LOCAL_PATH_PATTERN.lastIndex = 0; return { status: "REJECTED", code: "IMPORT_LOCAL_PATH" }; }
    LOCAL_PATH_PATTERN.lastIndex = 0;
    return { status: "PASS", value: safe, contentHash: Contract.hashArtifact(safe) };
  } catch (error) {
    return { status: "REJECTED", code: error.code || "IMPORT_INVALID" };
  }
}

function importCapsule(capsule, expectedHash, options = {}) {
  const validation = validateJson(capsule);
  if (validation.status !== "PASS") return validation;
  if (expectedHash && validation.contentHash !== expectedHash) return { status: "REJECTED", code: "CAPSULE_HASH_MISMATCH" };
  const sandboxSelected = options.mode === "SANDBOX_SIMULATION";
  return { status: "PASS", mode: sandboxSelected ? "SANDBOX_SIMULATION" : "READ_ONLY", sandboxSelected, autoApply: false, autoStartExecution: false, autoSyncDriverQueue: false, externalRequests: false, contentHash: validation.contentHash, capsule: validation.value };
}

function scanArchiveEntries(entries, nestedEntries = {}) {
  const issues = [];
  let recursivelyScanned = false;
  for (const entry of entries) {
    const normalized = String(entry).replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) issues.push({ entry, code: "ARCHIVE_PATH_TRAVERSAL" });
    if (normalized.includes("__MACOSX/") || path.posix.basename(normalized).startsWith("._")) issues.push({ entry, code: "ARCHIVE_APPLEDOUBLE" });
    if (/\.(?:exe|dll|dylib|so|bin)$/i.test(normalized)) issues.push({ entry, code: "ARCHIVE_BINARY_REJECTED" });
    if (/\.zip$/i.test(normalized)) {
      if (Array.isArray(nestedEntries[entry])) {
        recursivelyScanned = true;
        const nested = scanArchiveEntries(nestedEntries[entry], nestedEntries);
        issues.push(...nested.issues.map((issue) => ({ ...issue, parent: entry })));
      } else issues.push({ entry, code: "ARCHIVE_NESTED_REQUIRES_RECURSIVE_SCAN" });
    }
  }
  return { status: issues.length ? "REJECTED" : "PASS", issues, recursivelyScanned };
}

function deepProjection(capsule) {
  const copy = JSON.parse(JSON.stringify(capsule));
  delete copy.capsuleHash;
  return copy;
}

function createDeepCapsule(sections, metadata = {}) {
  const sectionHashes = Object.fromEntries(Object.entries(sections).map(([name, value]) => [name, Contract.hashArtifact(value)]));
  const capsule = { schemaVersion: "stct-deep-evidence-capsule-v1.8", mode: "READ_ONLY_REPLAY", dataClassification: "SYNTHETIC_DEMO", sections: JSON.parse(JSON.stringify(sections)), sectionHashes, metadata: { ...metadata, integrity: "SHA-256 content integrity only", authenticity: "Not established by a digital signature", confidentiality: "Not encrypted" }, importPolicy: { autoApply: false, autoStartExecution: false, autoSyncDriverQueue: false, externalRequests: false } };
  capsule.capsuleHash = Contract.hashArtifact(deepProjection(capsule));
  return capsule;
}

function verifyDeepCapsule(capsule, verifiers = {}) {
  const validation = validateJson(capsule);
  const issues = [];
  const fail = (code, detail = {}) => issues.push({ code, detail });
  if (validation.status !== "PASS") return { status: "REJECTED", issues: [{ code: validation.code }], mode: "READ_ONLY", autoApply: false, externalRequests: false };
  if (capsule.schemaVersion !== "stct-deep-evidence-capsule-v1.8") fail("CAPSULE_SCHEMA_INVALID");
  const sections = capsule.sections && typeof capsule.sections === "object" ? capsule.sections : {};
  const hashes = capsule.sectionHashes && typeof capsule.sectionHashes === "object" ? capsule.sectionHashes : {};
  const sectionNames = Object.keys(sections).sort();
  const hashNames = Object.keys(hashes).sort();
  if (JSON.stringify(sectionNames) !== JSON.stringify(hashNames)) fail("CAPSULE_SECTION_SET_MISMATCH", { sectionNames, hashNames });
  for (const name of new Set([...sectionNames, ...hashNames])) {
    if (!Object.hasOwn(sections, name) || !Object.hasOwn(hashes, name)) continue;
    if (Contract.hashArtifact(sections[name]) !== hashes[name]) fail("CAPSULE_SECTION_HASH_MISMATCH", { section: name });
    if (typeof verifiers[name] === "function") {
      const result = verifiers[name](sections[name], sections);
      if (!result || result.status !== "PASS") fail("CAPSULE_SECTION_SEMANTIC_INVALID", { section: name, result });
    }
  }
  if (Contract.hashArtifact(deepProjection(capsule)) !== capsule.capsuleHash) fail("CAPSULE_OUTER_HASH_MISMATCH");
  if (!capsule.importPolicy || capsule.importPolicy.autoApply !== false || capsule.importPolicy.autoStartExecution !== false || capsule.importPolicy.autoSyncDriverQueue !== false || capsule.importPolicy.externalRequests !== false) fail("CAPSULE_IMPORT_POLICY_INVALID");
  return { status: issues.length ? "REJECTED" : "PASS", issues, mode: "READ_ONLY", sandboxSelected: false, autoApply: false, autoStartExecution: false, autoSyncDriverQueue: false, externalRequests: false, sectionCount: sectionNames.length, capsuleHash: capsule.capsuleHash };
}

module.exports = { VERSION, LIMITS, SECRET_PATTERN, LOCAL_PATH_PATTERN, DANGEROUS_KEYS, escapeLabel, safeFilename, redactText, validateTabularCell, hasMalformedUnicode, inspectValue, validateJson, importCapsule, scanArchiveEntries, deepProjection, createDeepCapsule, verifyDeepCapsule };
