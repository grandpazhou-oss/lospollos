(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV16 = root.STCTV16 || { version: "1.6.0" };
    root.STCTV16.routingProvenance = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";

  if (!IntegrityHash?.hashValue) throw new Error("Routing provenance v1.6 requires the v1.5.1 SHA-256 utility.");
  const VERSION = "stct-routing-provenance-v1.6";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const SENSITIVE_KEY = /(token|secret|password|authorization|api[-_]?key|credential|cookie)/i;

  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, item]) => [key, redact(item)]));
    return value;
  }

  function semantic(value) {
    return {
      schemaVersion: "stct-routing-provenance-v1.6",
      providerId: text(value.providerId),
      providerVersion: text(value.providerVersion),
      availability: text(value.availability),
      mode: text(value.mode),
      profile: text(value.profile),
      requestHash: text(value.requestHash),
      matrixHash: text(value.matrixHash),
      routeHash: text(value.routeHash),
      graphHash: text(value.graphHash),
      capabilities: clone(value.capabilities || {}),
      trafficMode: text(value.trafficMode || "NONE"),
      departureTimeApplied: value.departureTimeApplied === true,
      privacyMode: text(value.privacyMode || "NO_EXTERNAL_COORDINATE_TRANSMISSION"),
      endpointCategory: text(value.endpointCategory || "NONE"),
      pointCount: Number(value.pointCount || 0),
      requestCount: Number(value.requestCount || 0),
      dataClassification: text(value.dataClassification || "SYNTHETIC"),
      boundary: text(value.boundary || "Local Demo / Not Live Operations"),
    };
  }

  function create(provider, context = {}) {
    const value = semantic({
      ...redact(context),
      providerId: provider.id,
      providerVersion: provider.version,
      availability: provider.availability,
      mode: provider.mode,
      capabilities: provider.capabilities(),
    });
    return { ...value, provenanceHash: IntegrityHash.hashValue(value), generatedAt: text(context.generatedAt || new Date().toISOString()), generatedAtExcludedFromIdentity: true, providerOwned: true };
  }

  function validate(value, provider) {
    const errors = [];
    if (!value || typeof value !== "object") errors.push("PROVENANCE_REQUIRED");
    else {
      if (value.schemaVersion !== "stct-routing-provenance-v1.6") errors.push("PROVENANCE_SCHEMA_INVALID");
      if (!text(value.providerId) || !text(value.providerVersion) || !text(value.mode) || !text(value.availability)) errors.push("PROVENANCE_PROVIDER_FIELDS_REQUIRED");
      if (provider && (value.providerId !== provider.id || value.providerVersion !== provider.version || value.mode !== provider.mode)) errors.push("PROVENANCE_PROVIDER_MISMATCH");
      if (value.provenanceHash !== IntegrityHash.hashValue(semantic(value))) errors.push("PROVENANCE_HASH_STALE");
      if (JSON.stringify(value).match(SENSITIVE_KEY)) errors.push("PROVENANCE_SECRET_FIELD");
      if (value.providerOwned !== true) errors.push("PROVENANCE_NOT_PROVIDER_OWNED");
    }
    return { status: errors.length ? "FAIL" : "PASS", errors };
  }

  return { VERSION, redact, semantic, create, validate };
});
