(function () {
  "use strict";

  const runtime = typeof window !== "undefined" ? window : globalThis;

  const CONTRACT_URL = "./shared/planning-contract-v13.json";
  let contract = null;
  let loadError = null;

  class CanonicalError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "CanonicalError";
      this.code = code;
      this.details = details;
    }
  }

  function configure(value) {
    if (!value || !value.contractVersion || !value.canonicalSchemas) {
      throw new CanonicalError("CONTRACT_INVALID", "Planning contract is missing required sections.");
    }
    contract = value;
    loadError = null;
    return contract;
  }

  const readyPromise = typeof runtime.fetch === "function" && typeof window !== "undefined"
    ? runtime.fetch(CONTRACT_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(configure)
      .catch((error) => {
        loadError = error;
        return null;
      })
    : Promise.resolve(null);

  async function ready() {
    if (!contract) await readyPromise;
    if (!contract) {
      throw new CanonicalError("CONTRACT_UNAVAILABLE", "Planning contract could not be loaded.", { message: loadError?.message || "not configured" });
    }
    return contract;
  }

  function requireContract() {
    if (!contract) throw new CanonicalError("CONTRACT_NOT_READY", "Planning contract is not ready.");
    return contract;
  }

  function text(value, options = {}) {
    if (value === null || value === undefined) {
      if (options.required) throw new CanonicalError("CANONICALIZATION_ERROR", `Missing required string: ${options.field}`, { field: options.field });
      return "";
    }
    if (typeof value !== "string") {
      throw new CanonicalError("CANONICAL_TYPE_ERROR", `Invalid string type: ${options.field}`, { field: options.field, type: typeof value });
    }
    const normalized = value.replace(/\r\n?/g, "\n").trim().normalize("NFC");
    if (options.required && !normalized) throw new CanonicalError("CANONICALIZATION_ERROR", `Empty required string: ${options.field}`, { field: options.field });
    return normalized;
  }

  function importText(value, options = {}) {
    if (value === null || value === undefined) return options.required ? text(value, options) : "";
    if (typeof value === "boolean" || (typeof value === "object" && !(value instanceof Date))) {
      throw new CanonicalError("IMPORT_TYPE_ERROR", `Invalid imported text type: ${options.field}`, { field: options.field, type: typeof value });
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new CanonicalError("IMPORT_TYPE_ERROR", `Invalid imported number: ${options.field}`, { field: options.field });
      return value === 0 ? "0" : String(value);
    }
    return text(String(value), options);
  }

  function importDate(value, field, optional = false) {
    if (value === null || value === undefined || value === "") {
      if (optional) return "";
      throw new CanonicalError("CANONICALIZATION_ERROR", `Missing required date: ${field}`, { field });
    }
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const dateValue = new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86400000);
      return `${String(dateValue.getUTCFullYear()).padStart(4, "0")}-${String(dateValue.getUTCMonth() + 1).padStart(2, "0")}-${String(dateValue.getUTCDate()).padStart(2, "0")}`;
    }
    const source = importText(value, { required: !optional, field });
    const match = /^(\d{1,4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(source);
    if (!match) throw new CanonicalError("CANONICALIZATION_ERROR", `Invalid imported date: ${field}`, { field, value: source });
    return date(`${match[1].padStart(4, "0")}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`, field, optional);
  }

  function importTime(value, field) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
      const minutes = Math.round(value * 1440) % 1440;
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
    const source = importText(value, { required: true, field });
    const match = /^(\d{1,2}):(\d{2})$/.exec(source);
    if (!match) throw new CanonicalError("CANONICALIZATION_ERROR", `Invalid imported time: ${field}`, { field, value: source });
    return time(`${match[1].padStart(2, "0")}:${match[2]}`, field);
  }

  function parseDecimal(value, field) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new CanonicalError("INVALID_CANONICAL_NUMBER", `Non-finite number: ${field}`, { field });
    }
    if (!["string", "number", "bigint"].includes(typeof value)) {
      throw new CanonicalError("CANONICAL_TYPE_ERROR", `Invalid number type: ${field}`, { field, type: typeof value });
    }
    const source = typeof value === "number" && Object.is(value, -0) ? "-0" : String(value).trim();
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
    if (!match) throw new CanonicalError("INVALID_CANONICAL_NUMBER", `Invalid number: ${field}`, { field, value: source });
    const sign = match[1] === "-" ? -1n : 1n;
    const integer = match[2] || "0";
    const fraction = match[3] !== undefined ? match[3] : (match[4] || "");
    const exponent = Number(match[5] || 0);
    const digits = BigInt(`${integer}${fraction}` || "0");
    return { sign, digits, decimalPlaces: fraction.length - exponent };
  }

  function pow10(power) {
    if (!Number.isInteger(power) || power < 0 || power > 1000) {
      throw new CanonicalError("INVALID_CANONICAL_NUMBER", "Decimal exponent is outside the supported range.", { power });
    }
    return 10n ** BigInt(power);
  }

  function decimal(value, scale, field) {
    const parsed = parseDecimal(value, field);
    let scaled;
    if (parsed.decimalPlaces <= scale) {
      scaled = parsed.digits * pow10(scale - parsed.decimalPlaces);
    } else {
      const divisor = pow10(parsed.decimalPlaces - scale);
      let quotient = parsed.digits / divisor;
      const remainder = parsed.digits % divisor;
      if (remainder * 2n >= divisor) quotient += 1n;
      scaled = quotient;
    }
    if (scaled !== 0n && parsed.sign < 0n) scaled = -scaled;
    const negative = scaled < 0n;
    const absolute = negative ? -scaled : scaled;
    if (scale === 0) return `${negative ? "-" : ""}${absolute}`;
    const padded = absolute.toString().padStart(scale + 1, "0");
    const whole = padded.slice(0, -scale) || "0";
    const fraction = padded.slice(-scale);
    return `${negative ? "-" : ""}${whole}.${fraction}`;
  }

  function integer(value, field) {
    return decimal(value, 0, field);
  }

  function booleanValue(value, field) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
    if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
    throw new CanonicalError("CANONICALIZATION_ERROR", `Invalid boolean: ${field}`, { field, value });
  }

  function date(value, field, optional = false) {
    const source = text(value, { required: !optional, field });
    if (!source && optional) return "";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
    if (!match) throw new CanonicalError("CANONICALIZATION_ERROR", `Invalid date: ${field}`, { field, value: source });
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) {
      throw new CanonicalError("CANONICALIZATION_ERROR", `Invalid date: ${field}`, { field, value: source });
    }
    return source;
  }

  function time(value, field) {
    const source = text(value, { required: true, field });
    const match = /^(\d{2}):(\d{2})$/.exec(source);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new CanonicalError("CANONICALIZATION_ERROR", `Invalid time: ${field}`, { field, value: source });
    }
    return source;
  }

  function canonicalUtf8Bytes(value) {
    return new TextEncoder().encode(text(value, { required: true, field: "canonical-sort" }));
  }

  function canonicalUtf8Compare(leftValue, rightValue) {
    const left = canonicalUtf8Bytes(leftValue);
    const right = canonicalUtf8Bytes(rightValue);
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  }

  function normalizeEntity(source, schemaName) {
    const current = requireContract();
    const schema = current.canonicalSchemas[schemaName];
    if (!schema) throw new CanonicalError("CONTRACT_INVALID", `Unknown canonical schema: ${schemaName}`);
    const result = {};
    schema.forEach((definition) => {
      const field = `${schemaName}.${definition.name}`;
      const value = source?.[definition.name];
      if (["identifier", "text", "optionalText", "enum"].includes(definition.type)) result[definition.name] = text(value, { required: definition.required, field });
      else if (definition.type === "date") result[definition.name] = date(value, field, false);
      else if (definition.type === "optionalDate") result[definition.name] = date(value, field, true);
      else if (definition.type === "time") result[definition.name] = time(value, field);
      else if (definition.type === "number") result[definition.name] = decimal(value, definition.scale, field);
      else if (definition.type === "integer") result[definition.name] = integer(value, field);
      else if (definition.type === "boolean") result[definition.name] = booleanValue(value, field);
      else throw new CanonicalError("CONTRACT_INVALID", `Unknown canonical type: ${definition.type}`, { field });
    });
    return result;
  }

  function uniqueSorted(rows, entityName) {
    const seen = new Set();
    rows.forEach((row) => {
      if (seen.has(row.id)) {
        const code = entityName === "order" ? "DUPLICATE_ORDER_ID" : "DUPLICATE_VEHICLE_ID";
        throw new CanonicalError(code, `Duplicate ${entityName} id: ${row.id}`, { id: row.id });
      }
      seen.add(row.id);
    });
    return [...rows].sort((left, right) => canonicalUtf8Compare(left.id, right.id));
  }

  function validateScenarioValues(scenario) {
    const depotLon = Number(scenario.depot.lon);
    const depotLat = Number(scenario.depot.lat);
    if (Math.abs(depotLon) > 180 || Math.abs(depotLat) > 90) throw new CanonicalError("CANONICALIZATION_ERROR", "Depot coordinate is outside the valid range.");
    scenario.orders.forEach((order) => {
      if (Math.abs(Number(order.lon)) > 180 || Math.abs(Number(order.lat)) > 90) throw new CanonicalError("CANONICALIZATION_ERROR", "Order coordinate is outside the valid range.", { orderId: order.id });
      ["count", "volume", "weight", "serviceMin"].forEach((field) => {
        if (Number(order[field]) < 0) throw new CanonicalError("CANONICALIZATION_ERROR", `Order ${field} must be non-negative.`, { orderId: order.id, field });
      });
      const weight = Number(order.priorityWeight);
      const mapping = requireContract().priorityMapping;
      if (!Number.isInteger(weight) || weight < mapping.minimum || weight > mapping.maximum) {
        throw new CanonicalError("CANONICALIZATION_ERROR", "priorityWeight is outside the supported range.", { orderId: order.id, priorityWeight: order.priorityWeight });
      }
    });
    scenario.vehicles.forEach((vehicle) => {
      if (Number(vehicle.maxVolume) <= 0 || Number(vehicle.maxWeight) <= 0) {
        throw new CanonicalError("INVALID_VEHICLE_CAPACITY_DATA", "Vehicle capacity must be positive.", { vehicleId: vehicle.id });
      }
    });
  }

  function canonicalScenario(source) {
    const current = requireContract();
    const planningMode = text(source?.planningMode, { required: true, field: "planningMode" });
    if (!current.planningModes.includes(planningMode)) throw new CanonicalError("CANONICALIZATION_ERROR", `Unsupported planningMode: ${planningMode}`);
    const result = {
      contractVersion: current.contractVersion,
      canonicalVersion: current.canonicalVersion,
      planningMode,
      planningDate: date(source?.planningDate, "planningDate", false),
      depot: normalizeEntity(source?.depot, "depot"),
      orders: uniqueSorted((source?.orders || []).map((row) => normalizeEntity(row, "order")), "order"),
      vehicles: uniqueSorted((source?.vehicles || []).map((row) => normalizeEntity(row, "vehicle")), "vehicle"),
      constraints: normalizeEntity(source?.constraints, "constraints"),
      assumptions: normalizeEntity(source?.assumptions, "assumptions"),
    };
    if (planningMode === "SINGLE_DAY") {
      const differentDate = result.orders.find((order) => order.date !== result.planningDate);
      if (differentDate) throw new CanonicalError("MULTIPLE_ORDER_DATES_IN_SINGLE_DAY_SCENARIO", "SINGLE_DAY scenario contains an order from another date.", { orderId: differentDate.id, orderDate: differentDate.date, planningDate: result.planningDate });
    }
    validateScenarioValues(result);
    return result;
  }

  function contentEnvelope(scenario) {
    return {
      canonicalVersion: scenario.canonicalVersion,
      depot: scenario.depot,
      orders: scenario.orders,
      vehicles: scenario.vehicles,
    };
  }

  function canonicalString(value) {
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new CanonicalError("INVALID_CANONICAL_NUMBER", "Canonical JSON only accepts safe integer number tokens.");
      return String(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
    if (value && typeof value === "object") {
      const normalized = new Map();
      Object.keys(value).forEach((sourceKey) => {
        const key = text(sourceKey, { required: true, field: "canonical-key" });
        if (normalized.has(key)) throw new CanonicalError("DUPLICATE_CANONICAL_KEY", `Duplicate canonical key: ${key}`, { key });
        normalized.set(key, value[sourceKey]);
      });
      const keys = [...normalized.keys()].sort(canonicalUtf8Compare);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalString(normalized.get(key))}`).join(",")}}`;
    }
    throw new CanonicalError("CANONICALIZATION_ERROR", "Unsupported canonical JSON value.", { type: typeof value });
  }

  async function sha256(source) {
    const cryptoApi = runtime.crypto || globalThis.crypto;
    if (!cryptoApi?.subtle) throw new CanonicalError("HASH_ENGINE_UNAVAILABLE", "Web Crypto SHA-256 is unavailable.");
    const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(source));
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${requireContract().hash.prefix}${hex}`;
  }

  async function scenarioIdentity(source) {
    await ready();
    const scenario = canonicalScenario(source);
    const contentBytes = canonicalString(contentEnvelope(scenario));
    const inputBytes = canonicalString(scenario);
    return {
      scenario,
      contentBytes,
      inputBytes,
      contentHash: await sha256(contentBytes),
      inputHash: await sha256(inputBytes),
    };
  }

  function scenarioIdentitySync(source) {
    const integrity = runtime.STCTV15?.integrityHash
      || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
    if (!integrity?.sha256Text) throw new CanonicalError("HASH_ENGINE_UNAVAILABLE", "Integrity SHA-256 engine is unavailable.");
    const scenario = canonicalScenario(source);
    const contentBytes = canonicalString(contentEnvelope(scenario));
    const inputBytes = canonicalString(scenario);
    return {
      scenario,
      contentBytes,
      inputBytes,
      contentHash: integrity.sha256Text(contentBytes),
      inputHash: integrity.sha256Text(inputBytes),
    };
  }

  function requestEnvelope(inputHash, options) {
    const current = requireContract();
    const schema = current.requestSchema;
    const unknownTopLevel = Object.keys(options || {}).filter((key) => !schema.allowedTopLevel.includes(key));
    if (unknownTopLevel.length) throw new CanonicalError("UNKNOWN_REQUEST_OPTION", `Unknown request option: ${unknownTopLevel[0]}`, { fields: unknownTopLevel.sort(canonicalUtf8Compare) });
    const objective = text(options?.objective, { required: true, field: "objective" });
    if (!current.objectives.includes(objective)) throw new CanonicalError("CANONICALIZATION_ERROR", `Unsupported objective: ${objective}`);
    const engineRequested = text(options?.engineRequested || "ortools", { required: true, field: "engineRequested" });
    if (!schema.engineRequested.includes(engineRequested)) throw new CanonicalError("CANONICALIZATION_ERROR", `Unsupported engineRequested: ${engineRequested}`);
    const sourceSearch = options?.searchConfiguration || {};
    if (!sourceSearch || typeof sourceSearch !== "object" || Array.isArray(sourceSearch)) {
      throw new CanonicalError("CANONICAL_TYPE_ERROR", "searchConfiguration must be an object.");
    }
    const unknownSearch = Object.keys(sourceSearch).filter((key) => !Object.prototype.hasOwnProperty.call(schema.searchConfiguration, key));
    if (unknownSearch.length) throw new CanonicalError("UNKNOWN_REQUEST_OPTION", `Unknown search option: ${unknownSearch[0]}`, { fields: unknownSearch.sort(canonicalUtf8Compare) });
    const searchConfiguration = {};
    Object.keys(sourceSearch).sort(canonicalUtf8Compare).forEach((key) => {
      const definition = schema.searchConfiguration[key];
      const value = sourceSearch[key];
      if (definition.type === "integer") searchConfiguration[key] = integer(value, `searchConfiguration.${key}`);
      else if (definition.type === "boolean") searchConfiguration[key] = booleanValue(value, `searchConfiguration.${key}`);
      else if (definition.type === "enum") {
        const normalized = text(value, { required: true, field: `searchConfiguration.${key}` });
        if (!definition.values.includes(normalized)) throw new CanonicalError("CANONICALIZATION_ERROR", `Unsupported search option value: ${key}`, { field: key, value: normalized });
        searchConfiguration[key] = normalized;
      } else throw new CanonicalError("CONTRACT_INVALID", `Unsupported request schema type: ${definition.type}`, { field: key });
    });
    return {
      contractVersion: current.contractVersion,
      canonicalVersion: current.canonicalVersion,
      inputHash: text(inputHash, { required: true, field: "inputHash" }),
      objective,
      timeLimitSeconds: integer(options?.timeLimitSeconds, "timeLimitSeconds"),
      engineRequested,
      searchConfiguration,
    };
  }

  async function requestIdentity(inputHash, options) {
    await ready();
    const envelope = requestEnvelope(inputHash, options);
    const bytes = canonicalString(envelope);
    return { envelope, requestBytes: bytes, requestHash: await sha256(bytes) };
  }

  function normalizePlanEnvelope(inputHash, source) {
    const current = requireContract();
    const routeIds = new Set();
    const routes = (source?.routes || []).map((route) => {
      const normalized = {
        routeId: text(route.routeId, { required: true, field: "route.routeId" }),
        vehicleId: text(route.vehicleId, { required: true, field: "route.vehicleId" }),
        orderIds: (route.orderIds || []).map((id) => text(id, { required: true, field: "route.orderIds" })),
      };
      if (routeIds.has(normalized.routeId)) throw new CanonicalError("DUPLICATE_ROUTE_ID", `Duplicate route id: ${normalized.routeId}`);
      routeIds.add(normalized.routeId);
      return normalized;
    }).sort((left, right) => canonicalUtf8Compare(left.routeId, right.routeId) || canonicalUtf8Compare(left.vehicleId, right.vehicleId));
    return {
      contractVersion: current.contractVersion,
      canonicalVersion: current.canonicalVersion,
      inputHash: text(inputHash, { required: true, field: "inputHash" }),
      parentPlanHash: text(source?.parentPlanHash || source?.basePlanHash || ""),
      routes,
      unassignedOrderIds: [...new Set((source?.unassignedOrderIds || []).map((id) => text(id, { required: true, field: "unassignedOrderIds" })))].sort(canonicalUtf8Compare),
      blockedOrderIds: [...new Set((source?.blockedOrderIds || []).map((id) => text(id, { required: true, field: "blockedOrderIds" })))].sort(canonicalUtf8Compare),
      manualRevision: integer(source?.manualRevision || 0, "manualRevision"),
    };
  }

  async function planIdentity(inputHash, source) {
    await ready();
    const envelope = normalizePlanEnvelope(inputHash, source);
    const bytes = canonicalString(envelope);
    return { envelope, planBytes: bytes, planHash: await sha256(bytes) };
  }

  function priority(value, explicitWeight) {
    const current = requireContract();
    const mapping = current.priorityMapping;
    const explicitText = explicitWeight === undefined || explicitWeight === null ? "" : String(explicitWeight).trim();
    if (explicitText) {
      const normalizedWeight = Number(integer(explicitText, "priorityWeight"));
      if (normalizedWeight >= mapping.minimum && normalizedWeight <= mapping.maximum) {
        return { original: text(value), normalized: text(value).toLowerCase() || "normal", weight: normalizedWeight, source: "explicit", warning: null };
      }
      throw new CanonicalError("CANONICALIZATION_ERROR", "Explicit priorityWeight is outside the supported range.", { priorityWeight: explicitWeight });
    }
    const original = text(value);
    const trimmed = original.trim();
    const normalizedKey = Object.prototype.hasOwnProperty.call(mapping.aliases, trimmed)
      ? mapping.aliases[trimmed]
      : Object.prototype.hasOwnProperty.call(mapping.aliases, trimmed.toLowerCase())
        ? mapping.aliases[trimmed.toLowerCase()]
        : null;
    if (normalizedKey && Object.prototype.hasOwnProperty.call(mapping.values, normalizedKey)) {
      return { original, normalized: normalizedKey, weight: mapping.values[normalizedKey], source: "mapped", warning: null };
    }
    return { original, normalized: "normal", weight: mapping.default, source: "defaulted", warning: "UNKNOWN_PRIORITY_DEFAULTED_TO_NORMAL" };
  }

  const api = {
    CONTRACT_URL,
    CanonicalError,
    configure,
    ready,
    getContract: requireContract,
    text,
    importText,
    importDate,
    importTime,
    decimal,
    date,
    time,
    normalizeEntity,
    canonicalScenario,
    canonicalString,
    canonicalUtf8Compare,
    sha256,
    scenarioIdentity,
    scenarioIdentitySync,
    requestEnvelope,
    requestIdentity,
    normalizePlanEnvelope,
    planIdentity,
    priority,
  };
  runtime.STCTCanonical = api;
  if (typeof module !== "undefined" && module.exports && typeof window === "undefined") module.exports = api;
})();
