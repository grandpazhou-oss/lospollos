(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const telemetry = root?.STCTV17?.telemetry || (typeof require === "function" ? require("./telemetry-v17.js") : null);
  const api = factory(integrity, telemetry);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.telemetryValidator = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Telemetry) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Telemetry?.derivedIdentity) throw new Error("Telemetry Validator v1.7 dependencies are missing.");
  const VERSION = "stct-telemetry-validator-v1.7";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  function validateObservation(value) {
    const errors = [];
    if (value?.schemaVersion !== "stct-telemetry-observation-v1.7") errors.push("OBSERVATION_SCHEMA_INVALID");
    if (value?.observationHash !== IntegrityHash.hashValue(Telemetry.observationIdentity(value || {}))) errors.push("OBSERVATION_HASH_STALE");
    if (value?.rawClaimHash !== IntegrityHash.hashValue(Telemetry.rawClaimIdentity(value || {}))) errors.push("RAW_CLAIM_HASH_STALE");
    if (value?.rawRecordHash !== IntegrityHash.hashValue(Telemetry.rawRecordIdentity(value || {}))) errors.push("RAW_RECORD_HASH_STALE");
    return { status: errors.length ? "FAIL" : "PASS", errors };
  }
  function validateDerived(value) { const errors = []; if (value?.schemaVersion !== "stct-derived-telemetry-v1.7") errors.push("DERIVED_SCHEMA_INVALID"); if (value?.derivedTelemetryHash !== IntegrityHash.hashValue(Telemetry.derivedIdentity(value || {}))) errors.push("DERIVED_HASH_STALE"); return { status: errors.length ? "FAIL" : "PASS", errors }; }
  function validateBundle(bundle = {}) { const observation = validateObservation(bundle.observation); const derived = validateDerived(bundle.derived); const links = []; if (bundle.derived?.observationHash !== bundle.observation?.observationHash) links.push("OBSERVATION_DERIVED_LINK_MISMATCH"); if (bundle.previousDerived && bundle.derived?.previousObservationHash !== bundle.previousDerived.observationHash) links.push("PREVIOUS_OBSERVATION_LINK_MISMATCH"); const errors = [...observation.errors, ...derived.errors, ...links]; return { status: errors.length ? "FAIL" : "PASS", errors, observation, derived }; }
  function metrics(derivedRows = []) { return { source: "DERIVED_TELEMETRY_ONLY", distanceMeters: derivedRows.reduce((sum, row) => sum + Number(row.derivedSegmentDistanceMeters || 0), 0), durationSeconds: derivedRows.reduce((sum, row) => sum + Math.max(0, Number(row.derivedDurationSeconds || 0)), 0), offRouteCount: derivedRows.filter((row) => row.offRoute).length }; }
  function alertEvidence(derived) { return { source: "DERIVED_TELEMETRY_ONLY", derivedTelemetryHash: derived.derivedTelemetryHash, status: derived.plausibility.status, reasons: clone(derived.plausibility.reasons), lowConfidence: ["LOW", "FAILED", "UNMATCHED"].includes(derived.matchConfidence), offRoute: derived.offRoute }; }
  return { VERSION, validateObservation, validateDerived, validateBundle, metrics, alertEvidence };
});
