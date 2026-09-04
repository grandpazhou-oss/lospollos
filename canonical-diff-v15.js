(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.canonicalDiff = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "stct-canonical-diff-v1.5";
  const ORDER_FIELDS = Object.freeze(["lon", "lat", "volume", "weight", "count", "twStart", "twEnd", "serviceMin", "priorityWeight"]);
  const VEHICLE_FIELDS = Object.freeze(["maxVolume", "maxWeight", "start", "end", "fixedCost", "perKmCost", "perMinuteCost", "perStopCost", "emissionFactor", "enabled"]);
  const DEPOT_FIELDS = Object.freeze(["lon", "lat", "name"]);
  const SENSITIVE_FIELDS = new Set(["lon", "lat", "address", "addr"]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function compare(left, right) {
    const encoder = new TextEncoder();
    const a = encoder.encode(text(left).normalize("NFC"));
    const b = encoder.encode(text(right).normalize("NFC"));
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function stableStringify(value) {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function equal(left, right) {
    return stableStringify(left) === stableStringify(right);
  }

  function entityId(entity) {
    return text(entity?.id || entity?.orderId || entity?.vehicleId || entity?.code);
  }

  function classification(field, options = {}) {
    if (options.synthetic === true) return "SYNTHETIC";
    return SENSITIVE_FIELDS.has(field.split(".").at(-1)) ? "INTERNAL_PRECISE_LOCATION" : "INTERNAL_DERIVED";
  }

  function displayValue(value, field, options = {}) {
    if (options.synthetic === true || options.revealSensitive === true || !SENSITIVE_FIELDS.has(field.split(".").at(-1))) return clone(value);
    return value === undefined ? undefined : "<INTERNAL>";
  }

  function change(entityType, entityIdValue, field, before, after, options = {}) {
    return {
      entityType,
      entityId: text(entityIdValue),
      field,
      before: clone(before),
      after: clone(after),
      displayBefore: displayValue(before, field, options),
      displayAfter: displayValue(after, field, options),
      classification: classification(field, options),
      changeType: before === undefined ? "ADDED" : after === undefined ? "REMOVED" : "MUTATED",
    };
  }

  function fieldChanges(entityType, id, left, right, fields, options = {}) {
    return fields.filter((field) => !equal(left?.[field], right?.[field])).map((field) => change(entityType, id, field, left?.[field], right?.[field], options));
  }

  function deepChanges(entityType, id, left, right, prefix, options = {}) {
    if (equal(left, right)) return [];
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compare)
        .flatMap((key) => deepChanges(entityType, id, left[key], right[key], prefix ? `${prefix}.${key}` : key, options));
    }
    return [change(entityType, id, prefix, left, right, options)];
  }

  function entityDiff(entityType, leftRows = [], rightRows = [], fields = [], options = {}) {
    const left = new Map(leftRows.map((row) => [entityId(row), row]).filter(([id]) => id));
    const right = new Map(rightRows.map((row) => [entityId(row), row]).filter(([id]) => id));
    const ids = [...new Set([...left.keys(), ...right.keys()])].sort(compare);
    const added = ids.filter((id) => !left.has(id)).map((id) => clone(right.get(id)));
    const removed = ids.filter((id) => !right.has(id)).map((id) => clone(left.get(id)));
    const mutated = ids.filter((id) => left.has(id) && right.has(id)).map((id) => ({
      id,
      changes: fieldChanges(entityType, id, left.get(id), right.get(id), fields, options),
    })).filter((row) => row.changes.length);
    return { added, removed, mutated };
  }

  function vehicleChanges(leftRows, rightRows, options = {}) {
    const result = entityDiff("VEHICLE", leftRows, rightRows, VEHICLE_FIELDS, options);
    result.mutated.forEach((row) => {
      row.changes.forEach((item) => {
        if (["start", "end"].includes(item.field)) item.group = "shift";
        if (["fixedCost", "perKmCost", "perMinuteCost", "perStopCost"].includes(item.field)) item.group = "cost";
      });
    });
    return result;
  }

  function scenarioDiff(leftScenario = {}, rightScenario = {}, options = {}) {
    const orders = entityDiff("ORDER", leftScenario.orders || [], rightScenario.orders || [], ORDER_FIELDS, options);
    const vehicles = vehicleChanges(leftScenario.vehicles || [], rightScenario.vehicles || [], options);
    const depotChanges = fieldChanges("DEPOT", entityId(leftScenario.depot) || entityId(rightScenario.depot) || "DEPOT", leftScenario.depot || {}, rightScenario.depot || {}, DEPOT_FIELDS, options);
    const leftConstraints = leftScenario.constraintsSnapshot || leftScenario.constraints || {};
    const rightConstraints = rightScenario.constraintsSnapshot || rightScenario.constraints || {};
    const leftAssumptions = leftScenario.assumptionsSnapshot || leftScenario.assumptions || {};
    const rightAssumptions = rightScenario.assumptionsSnapshot || rightScenario.assumptions || {};
    const constraintChanges = deepChanges("CONSTRAINT", "SCENARIO", leftConstraints, rightConstraints, "", options);
    const assumptionChanges = deepChanges("ASSUMPTION", "SCENARIO", leftAssumptions, rightAssumptions, "", options);
    const fieldChangeList = [
      ...depotChanges,
      ...orders.mutated.flatMap((row) => row.changes),
      ...vehicles.mutated.flatMap((row) => row.changes),
      ...constraintChanges,
      ...assumptionChanges,
    ].sort((a, b) => compare(a.entityType, b.entityType) || compare(a.entityId, b.entityId) || compare(a.field, b.field));
    return {
      version: VERSION,
      status: fieldChangeList.length || orders.added.length || orders.removed.length || vehicles.added.length || vehicles.removed.length ? "CHANGED" : "UNCHANGED",
      inputHashA: text(leftScenario.inputHash),
      inputHashB: text(rightScenario.inputHash),
      depotChanges,
      orders,
      vehicles,
      constraintChanges,
      assumptionChanges,
      fieldChanges: fieldChangeList,
      summary: {
        addedOrders: orders.added.length,
        removedOrders: orders.removed.length,
        mutatedOrders: orders.mutated.length,
        addedVehicles: vehicles.added.length,
        removedVehicles: vehicles.removed.length,
        mutatedVehicles: vehicles.mutated.length,
        changedFields: fieldChangeList.length,
      },
    };
  }

  function findChange(diff, entityType, entityIdValue, field) {
    return (diff?.fieldChanges || []).find((item) => item.entityType === entityType && item.entityId === text(entityIdValue) && item.field === field) || null;
  }

  return {
    VERSION,
    ORDER_FIELDS,
    VEHICLE_FIELDS,
    DEPOT_FIELDS,
    SENSITIVE_FIELDS,
    scenarioDiff,
    findChange,
    fieldChanges,
    deepChanges,
    stableStringify,
  };
});
