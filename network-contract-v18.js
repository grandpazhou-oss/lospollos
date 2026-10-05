(function (root, factory) {
  "use strict";
  const integrity = typeof module !== "undefined" && module.exports
    ? require("./integrity-hash-v151.js")
    : root.STCTV15?.integrityHash;
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV18 = root.STCTV18 || { version: "1.8.0" };
    root.STCTV18.networkContract = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Integrity) {
  "use strict";

  if (!Integrity?.hashValue || !Integrity?.canonicalString) throw new Error("STCT SHA-256 integrity module is required.");

  const VERSION = "stct-network-contract-v1.8";
  const LIMITS = Object.freeze({ maxDepth: 24, maxArrayLength: 5000, maxSupplyPeriodRows: 12000, maxSupplyMatrixRows: 10600, maxStringLength: 2048, maxEntities: 5000 });
  const SUPPLY_PERIOD_ARRAY = /(?:^|\.)(?:periodDemand|sourceRows|excludedRows|outbound|inbound|transfer|capacityByPeriod)$/;
  const SUPPLY_MATRIX_ARRAY = /(?:^|\.)(?:distanceRows|outboundEdges|matrix\.rows|objective\.pairValues)$/;
  const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const HORIZON_MODES = new Set(["SINGLE_DAY", "MULTI_DAY", "MULTI_SHIFT"]);
  const CROSS_MIDNIGHT = new Set(["ALLOW", "FORBID", "EXPLICIT_NEXT_DAY"]);
  const DEPOT_ROLES = new Set(["CDC", "RDC", "SATELLITE", "CROSS_DOCK", "RETURN_CENTER"]);
  const DOCK_TYPES = new Set(["LOAD", "UNLOAD", "MIXED", "CROSS_DOCK_IN", "CROSS_DOCK_OUT"]);
  const TASK_TYPES = new Set(["DELIVERY", "PICKUP", "RETURN", "TRANSFER_IN", "TRANSFER_OUT", "SERVICE"]);
  const WAVE_STATES = new Set(["DRAFT", "FROZEN", "RELEASED", "LOADING", "DEPARTED", "COMPLETED", "CANCELLED"]);
  const TOP_LEVEL_FIELDS = new Set([
    "schemaVersion", "networkId", "dataClassification", "planningHorizon", "depots", "docks", "zones", "orders",
    "pickupDeliveryPairs", "transfers", "vehicles", "drivers", "vehicleTypes", "waves", "policies", "constraints",
    "assumptions", "routingContext", "trips", "routes", "dockReservations", "displayLabel", "uiState", "recordedAt",
  ]);

  class NetworkContractError extends Error {
    constructor(code, message, detail = {}) {
      super(message);
      this.name = "NetworkContractError";
      this.code = code;
      this.detail = detail;
    }
  }

  function fail(code, message, detail) { throw new NetworkContractError(code, message, detail); }
  function text(value, field, options = {}) {
    if (typeof value !== "string") fail("NETWORK_TYPE_ERROR", `${field} must be a string.`, { field, type: typeof value });
    const normalized = value.replace(/\r\n?/g, "\n").trim().normalize("NFC");
    if (!options.allowEmpty && !normalized) fail("NETWORK_REQUIRED_FIELD", `${field} is required.`, { field });
    if (normalized.length > (options.maxLength || LIMITS.maxStringLength)) fail("NETWORK_STRING_LIMIT", `${field} exceeds the string limit.`, { field });
    return normalized;
  }
  function optionalText(value, field) { return value === undefined || value === null ? "" : text(value, field, { allowEmpty: true }); }
  function finite(value, field, options = {}) {
    if (typeof value !== "number" || !Number.isFinite(value)) fail("NETWORK_NUMBER_ERROR", `${field} must be finite.`, { field, value });
    const normalized = Object.is(value, -0) ? 0 : value;
    if (options.integer && !Number.isSafeInteger(normalized)) fail("NETWORK_INTEGER_ERROR", `${field} must be a safe integer.`, { field, value });
    if (options.min !== undefined && normalized < options.min) fail("NETWORK_NUMBER_RANGE", `${field} is below the minimum.`, { field, value });
    if (options.max !== undefined && normalized > options.max) fail("NETWORK_NUMBER_RANGE", `${field} exceeds the maximum.`, { field, value });
    return normalized;
  }
  function list(value, field) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) fail("NETWORK_TYPE_ERROR", `${field} must be an array.`, { field });
    const maximum = SUPPLY_PERIOD_ARRAY.test(field) ? LIMITS.maxSupplyPeriodRows : SUPPLY_MATRIX_ARRAY.test(field) ? LIMITS.maxSupplyMatrixRows : LIMITS.maxArrayLength;
    if (value.length > maximum) fail("NETWORK_ARRAY_LIMIT", `${field} exceeds the array limit.`, { field, length: value.length, maximum });
    return value;
  }
  function stringList(value, field) { return list(value, field).map((item, index) => text(item, `${field}[${index}]`, { maxLength: 256 })); }
  function time(value, field) {
    const result = text(value, field, { maxLength: 5 });
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) fail("NETWORK_TIME_ERROR", `${field} must use HH:MM.`, { field, value });
    return result;
  }
  function coordinate(value, field) {
    if (!Array.isArray(value) || value.length !== 2) fail("NETWORK_COORDINATE_ERROR", `${field} must contain longitude and latitude.`, { field });
    return [finite(value[0], `${field}[0]`, { min: -180, max: 180 }), finite(value[1], `${field}[1]`, { min: -90, max: 90 })];
  }
  function safeValue(value, field = "value", depth = 0, seen = new WeakSet()) {
    if (depth > LIMITS.maxDepth) fail("NETWORK_DEPTH_LIMIT", `${field} exceeds the object depth limit.`, { field, depth });
    if (value === undefined || value === null || typeof value === "boolean") return value === undefined ? null : value;
    if (typeof value === "string") return text(value, field, { allowEmpty: true });
    if (typeof value === "number") {
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail("NETWORK_INTEGER_ERROR", `${field} exceeds the JavaScript safe integer range.`, { field, value });
      return finite(value, field);
    }
    if (Array.isArray(value)) return list(value, field).map((item, index) => safeValue(item, `${field}[${index}]`, depth + 1, seen));
    if (!value || typeof value !== "object") fail("NETWORK_TYPE_ERROR", `${field} contains an unsupported value.`, { field, type: typeof value });
    if (seen.has(value)) fail("NETWORK_CYCLE_REJECTED", `${field} contains a cycle.`, { field });
    seen.add(value);
    const output = Object.create(null);
    for (const sourceKey of Object.keys(value)) {
      const key = text(sourceKey, `${field}.key`, { maxLength: 256 });
      if (DANGEROUS_KEYS.has(key)) fail("NETWORK_DANGEROUS_KEY", `${field} contains a dangerous key.`, { field, key });
      output[key] = safeValue(value[sourceKey], `${field}.${key}`, depth + 1, seen);
    }
    seen.delete(value);
    return output;
  }
  function byUtf8(left, right) { return Integrity.utf8Compare(left, right); }
  function sortedUnique(values, field) {
    const rows = [...values].sort(byUtf8);
    for (let index = 1; index < rows.length; index += 1) if (rows[index] === rows[index - 1]) fail("NETWORK_DUPLICATE_REFERENCE", `${field} contains a duplicate.`, { field, id: rows[index] });
    return rows;
  }
  function optionalNumber(value, field, fallback = 0, options = {}) { return value === undefined || value === null ? fallback : finite(value, field, options); }
  function windows(value, field) {
    return list(value, field).map((row, index) => {
      const safe = safeValue(row, `${field}[${index}]`);
      return { start: time(safe.start, `${field}[${index}].start`), end: time(safe.end, `${field}[${index}].end`) };
    }).sort((a, b) => byUtf8(`${a.start}:${a.end}`, `${b.start}:${b.end}`));
  }
  function entities(value, field, idKey, mapper) {
    const rows = list(value, field).map((row, index) => mapper(safeValue(row, `${field}[${index}]`), index));
    if (rows.length > LIMITS.maxEntities) fail("NETWORK_ENTITY_LIMIT", `${field} exceeds the entity limit.`, { field });
    rows.sort((a, b) => byUtf8(a[idKey], b[idKey]));
    for (let index = 1; index < rows.length; index += 1) if (rows[index][idKey] === rows[index - 1][idKey]) fail("NETWORK_DUPLICATE_ID", `${field} contains a duplicate ID.`, { field, id: rows[index][idKey] });
    return rows;
  }
  function id(value, field) { return text(value, field, { maxLength: 128 }); }
  function idSet(rows, key) { return new Set(rows.map((row) => row[key])); }
  function requireReference(values, available, code, field) {
    for (const value of values) if (!available.has(value)) fail(code, `${field} references an unknown ID.`, { field, id: value });
  }

  function planningHorizon(source) {
    const row = safeValue(source, "planningHorizon");
    const mode = text(row.mode, "planningHorizon.mode", { maxLength: 32 });
    if (!HORIZON_MODES.has(mode)) fail("NETWORK_HORIZON_MODE", "Unsupported planning horizon mode.", { mode });
    const timezone = text(row.timezone, "planningHorizon.timezone", { maxLength: 128 });
    const businessDayStart = time(row.businessDayStart, "planningHorizon.businessDayStart");
    const businessDayEnd = time(row.businessDayEnd, "planningHorizon.businessDayEnd");
    const crossMidnightPolicy = text(row.crossMidnightPolicy, "planningHorizon.crossMidnightPolicy", { maxLength: 32 });
    if (!CROSS_MIDNIGHT.has(crossMidnightPolicy)) fail("NETWORK_CROSS_MIDNIGHT_POLICY", "Unsupported cross-midnight policy.", { crossMidnightPolicy });
    return { mode, timezone, businessDayStart, businessDayEnd, crossMidnightPolicy };
  }

  function normalizeScenario(source) {
    const input = safeValue(source, "NetworkScenario");
    const unknown = Object.keys(input).filter((key) => !TOP_LEVEL_FIELDS.has(key));
    if (unknown.length) fail("NETWORK_UNKNOWN_FIELD", "NetworkScenario contains an unknown top-level field.", { fields: unknown.sort(byUtf8) });
    const scenario = {
      schemaVersion: text(input.schemaVersion, "schemaVersion", { maxLength: 64 }),
      networkId: id(input.networkId, "networkId"),
      dataClassification: text(input.dataClassification, "dataClassification", { maxLength: 32 }),
      planningHorizon: planningHorizon(input.planningHorizon),
    };
    if (!["SYNTHETIC", "ANONYMIZED", "PERSONAL", "CONFIDENTIAL"].includes(scenario.dataClassification)) fail("NETWORK_DATA_CLASSIFICATION", "An explicit supported data classification is required; classification does not authorize external providers.");
    scenario.depots = entities(input.depots, "depots", "depotId", (row, index) => {
      const role = text(row.role, `depots[${index}].role`, { maxLength: 32 });
      if (!DEPOT_ROLES.has(role)) fail("NETWORK_DEPOT_ROLE", "Unsupported depot role.", { role });
      return {
        depotId: id(row.depotId, `depots[${index}].depotId`), name: optionalText(row.name, `depots[${index}].name`),
        coordinate: coordinate(row.coordinate, `depots[${index}].coordinate`), timezone: text(row.timezone, `depots[${index}].timezone`, { maxLength: 128 }), role,
        capabilities: sortedUnique(stringList(row.capabilities, `depots[${index}].capabilities`), `depots[${index}].capabilities`),
        operatingWindows: windows(row.operatingWindows, `depots[${index}].operatingWindows`),
        serviceZoneIds: sortedUnique(stringList(row.serviceZoneIds, `depots[${index}].serviceZoneIds`), `depots[${index}].serviceZoneIds`),
        dockIds: sortedUnique(stringList(row.dockIds, `depots[${index}].dockIds`), `depots[${index}].dockIds`),
        reloadSupported: Boolean(row.reloadSupported), transferSupported: Boolean(row.transferSupported),
        startVehicleIds: sortedUnique(stringList(row.startVehicleIds, `depots[${index}].startVehicleIds`), `depots[${index}].startVehicleIds`),
        allowedVehicleTypes: sortedUnique(stringList(row.allowedVehicleTypes, `depots[${index}].allowedVehicleTypes`), `depots[${index}].allowedVehicleTypes`),
        fixedOperatingCost: optionalNumber(row.fixedOperatingCost, `depots[${index}].fixedOperatingCost`, 0, { min: 0 }),
        variableHandlingCost: optionalNumber(row.variableHandlingCost, `depots[${index}].variableHandlingCost`, 0, { min: 0 }),
        carbonFactor: optionalNumber(row.carbonFactor, `depots[${index}].carbonFactor`, 0, { min: 0 }),
        capacity: safeValue(row.capacity || {}, `depots[${index}].capacity`),
      };
    });
    if (!scenario.depots.length) fail("NETWORK_DEPOTS_REQUIRED", "At least one depot is required.");
    scenario.zones = entities(input.zones, "zones", "zoneId", (row, index) => ({ zoneId: id(row.zoneId, `zones[${index}].zoneId`), mode: optionalText(row.mode, `zones[${index}].mode`) || "DIAGNOSTIC_ONLY", depotIds: sortedUnique(stringList(row.depotIds, `zones[${index}].depotIds`), `zones[${index}].depotIds`), geometry: safeValue(row.geometry || null, `zones[${index}].geometry`) }));
    scenario.docks = entities(input.docks, "docks", "dockId", (row, index) => {
      const type = text(row.type, `docks[${index}].type`, { maxLength: 32 });
      if (!DOCK_TYPES.has(type)) fail("NETWORK_DOCK_TYPE", "Unsupported dock type.", { type });
      return { dockId: id(row.dockId, `docks[${index}].dockId`), depotId: id(row.depotId, `docks[${index}].depotId`), type, compatibleVehicleTypes: sortedUnique(stringList(row.compatibleVehicleTypes, `docks[${index}].compatibleVehicleTypes`), `docks[${index}].compatibleVehicleTypes`), operatingWindows: windows(row.operatingWindows, `docks[${index}].operatingWindows`), simultaneousCapacity: optionalNumber(row.simultaneousCapacity, `docks[${index}].simultaneousCapacity`, 1, { integer: true, min: 1 }), loadRate: optionalNumber(row.loadRate, `docks[${index}].loadRate`, 1, { min: 0 }), unloadRate: optionalNumber(row.unloadRate, `docks[${index}].unloadRate`, 1, { min: 0 }), fixedSetupMinutes: optionalNumber(row.fixedSetupMinutes, `docks[${index}].fixedSetupMinutes`, 0, { integer: true, min: 0 }), queuePolicy: optionalText(row.queuePolicy, `docks[${index}].queuePolicy`) || "FCFS" };
    });
    scenario.vehicleTypes = entities(input.vehicleTypes, "vehicleTypes", "vehicleTypeId", (row, index) => ({ vehicleTypeId: id(row.vehicleTypeId, `vehicleTypes[${index}].vehicleTypeId`), capacity: safeValue(row.capacity || {}, `vehicleTypes[${index}].capacity`), cost: safeValue(row.cost || {}, `vehicleTypes[${index}].cost`), emission: safeValue(row.emission || {}, `vehicleTypes[${index}].emission`), energy: safeValue(row.energy || {}, `vehicleTypes[${index}].energy`) }));
    scenario.vehicles = entities(input.vehicles, "vehicles", "vehicleId", (row, index) => ({ vehicleId: id(row.vehicleId, `vehicles[${index}].vehicleId`), vehicleTypeId: id(row.vehicleTypeId, `vehicles[${index}].vehicleTypeId`), homeDepotId: id(row.homeDepotId, `vehicles[${index}].homeDepotId`), allowedStartDepotIds: sortedUnique(stringList(row.allowedStartDepotIds, `vehicles[${index}].allowedStartDepotIds`), `vehicles[${index}].allowedStartDepotIds`), allowedEndDepotIds: sortedUnique(stringList(row.allowedEndDepotIds, `vehicles[${index}].allowedEndDepotIds`), `vehicles[${index}].allowedEndDepotIds`), capacity: safeValue(row.capacity || {}, `vehicles[${index}].capacity`), cost: safeValue(row.cost || {}, `vehicles[${index}].cost`), emission: safeValue(row.emission || {}, `vehicles[${index}].emission`), energy: safeValue(row.energy || {}, `vehicles[${index}].energy`), routingProfile: optionalText(row.routingProfile, `vehicles[${index}].routingProfile`) || "CAR", maxTrips: optionalNumber(row.maxTrips, `vehicles[${index}].maxTrips`, 1, { integer: true, min: 1 }), availabilityWindows: windows(row.availabilityWindows, `vehicles[${index}].availabilityWindows`), reloadCompatibility: sortedUnique(stringList(row.reloadCompatibility, `vehicles[${index}].reloadCompatibility`), `vehicles[${index}].reloadCompatibility`) }));
    scenario.drivers = entities(input.drivers, "drivers", "driverId", (row, index) => { const homeDepotId = id(row.homeDepotId, `drivers[${index}].homeDepotId`); return { driverId: id(row.driverId, `drivers[${index}].driverId`), homeDepotId, allowedEndDepotIds: sortedUnique(stringList(row.allowedEndDepotIds === undefined ? [homeDepotId] : row.allowedEndDepotIds, `drivers[${index}].allowedEndDepotIds`), `drivers[${index}].allowedEndDepotIds`), skills: sortedUnique(stringList(row.skills, `drivers[${index}].skills`), `drivers[${index}].skills`), shiftWindows: windows(row.shiftWindows, `drivers[${index}].shiftWindows`), maxDrivingMinutes: optionalNumber(row.maxDrivingMinutes, `drivers[${index}].maxDrivingMinutes`, 480, { integer: true, min: 1 }), maxDutyMinutes: optionalNumber(row.maxDutyMinutes, `drivers[${index}].maxDutyMinutes`, 600, { integer: true, min: 1 }), requiredBreaks: safeValue(row.requiredBreaks || [], `drivers[${index}].requiredBreaks`), compatibleVehicleTypes: sortedUnique(stringList(row.compatibleVehicleTypes, `drivers[${index}].compatibleVehicleTypes`), `drivers[${index}].compatibleVehicleTypes`) }; });
    scenario.orders = entities(input.orders, "orders", "orderId", (row, index) => {
      const taskType = text(row.taskType, `orders[${index}].taskType`, { maxLength: 32 });
      if (!TASK_TYPES.has(taskType)) fail("NETWORK_TASK_TYPE", "Unsupported task type.", { taskType });
      return { orderId: id(row.orderId, `orders[${index}].orderId`), taskType, coordinate: coordinate(row.coordinate, `orders[${index}].coordinate`), demand: safeValue(row.demand || {}, `orders[${index}].demand`), serviceDuration: optionalNumber(row.serviceDuration, `orders[${index}].serviceDuration`, 0, { integer: true, min: 0 }), timeWindows: windows(row.timeWindows, `orders[${index}].timeWindows`), priorityWeight: optionalNumber(row.priorityWeight, `orders[${index}].priorityWeight`, 1, { min: 0 }), allowedDepotIds: sortedUnique(stringList(row.allowedDepotIds, `orders[${index}].allowedDepotIds`), `orders[${index}].allowedDepotIds`), fixedDepotId: optionalText(row.fixedDepotId, `orders[${index}].fixedDepotId`), preferredDepotId: optionalText(row.preferredDepotId, `orders[${index}].preferredDepotId`), preferredDepotException: row.preferredDepotException === true, forbiddenDepotIds: sortedUnique(stringList(row.forbiddenDepotIds, `orders[${index}].forbiddenDepotIds`), `orders[${index}].forbiddenDepotIds`), requiredSkills: sortedUnique(stringList(row.requiredSkills, `orders[${index}].requiredSkills`), `orders[${index}].requiredSkills`), requiredVehicleTypes: sortedUnique(stringList(row.requiredVehicleTypes, `orders[${index}].requiredVehicleTypes`), `orders[${index}].requiredVehicleTypes`), zoneId: optionalText(row.zoneId, `orders[${index}].zoneId`), shipmentPairId: optionalText(row.shipmentPairId, `orders[${index}].shipmentPairId`), transferPolicy: optionalText(row.transferPolicy, `orders[${index}].transferPolicy`) || "DIRECT", serviceDay: optionalText(row.serviceDay, `orders[${index}].serviceDay`) || "DAY-1", releaseTime: time(row.releaseTime, `orders[${index}].releaseTime`), dueTime: time(row.dueTime, `orders[${index}].dueTime`) };
    });
    scenario.pickupDeliveryPairs = entities(input.pickupDeliveryPairs, "pickupDeliveryPairs", "pairId", (row, index) => ({ pairId: id(row.pairId, `pickupDeliveryPairs[${index}].pairId`), pickupOrderId: id(row.pickupOrderId, `pickupDeliveryPairs[${index}].pickupOrderId`), deliveryOrderId: id(row.deliveryOrderId, `pickupDeliveryPairs[${index}].deliveryOrderId`), precedence: optionalText(row.precedence, `pickupDeliveryPairs[${index}].precedence`) || "PICKUP_BEFORE_DELIVERY", sameVehicleRequired: row.sameVehicleRequired !== false, sameTripRequired: row.sameTripRequired === true, transferAllowed: row.transferAllowed === true, maxRideTime: optionalNumber(row.maxRideTime, `pickupDeliveryPairs[${index}].maxRideTime`, 0, { integer: true, min: 0 }), loadTransformation: safeValue(row.loadTransformation || {}, `pickupDeliveryPairs[${index}].loadTransformation`) }));
    scenario.trips = entities(input.trips, "trips", "tripId", (row, index) => ({ ...row, tripId: id(row.tripId, `trips[${index}].tripId`), vehicleId: id(row.vehicleId, `trips[${index}].vehicleId`), driverId: id(row.driverId, `trips[${index}].driverId`), tripIndex: optionalNumber(row.tripIndex, `trips[${index}].tripIndex`, index + 1, { integer: true, min: 1 }), startDepotId: id(row.startDepotId, `trips[${index}].startDepotId`), endDepotId: id(row.endDepotId, `trips[${index}].endDepotId`), startTime: time(row.startTime, `trips[${index}].startTime`), endTime: time(row.endTime, `trips[${index}].endTime`), routeId: optionalText(row.routeId, `trips[${index}].routeId`), predecessorTripId: optionalText(row.predecessorTripId, `trips[${index}].predecessorTripId`), successorTripId: optionalText(row.successorTripId, `trips[${index}].successorTripId`) }));
    scenario.routes = entities(input.routes, "routes", "routeId", (row, index) => ({ ...row, routeId: id(row.routeId, `routes[${index}].routeId`), tripId: id(row.tripId, `routes[${index}].tripId`), stops: list(row.stops, `routes[${index}].stops`).map((stop, stopIndex) => ({ ...safeValue(stop, `routes[${index}].stops[${stopIndex}]`), orderId: id(stop.orderId, `routes[${index}].stops[${stopIndex}].orderId`) })) }));
    scenario.transfers = entities(input.transfers, "transfers", "transferId", (row, index) => ({ ...row, transferId: id(row.transferId, `transfers[${index}].transferId`), shipmentId: id(row.shipmentId, `transfers[${index}].shipmentId`), fromTripId: id(row.fromTripId, `transfers[${index}].fromTripId`), toTripId: id(row.toTripId, `transfers[${index}].toTripId`), depotId: id(row.depotId, `transfers[${index}].depotId`) }));
    scenario.waves = entities(input.waves, "waves", "waveId", (row, index) => {
      const status = optionalText(row.status, `waves[${index}].status`) || "DRAFT";
      if (!WAVE_STATES.has(status)) fail("NETWORK_WAVE_STATUS", "Unsupported wave status.", { status });
      return { ...row, waveId: id(row.waveId, `waves[${index}].waveId`), depotId: id(row.depotId, `waves[${index}].depotId`), releaseWindow: safeValue(row.releaseWindow || {}, `waves[${index}].releaseWindow`), cutoffTime: time(row.cutoffTime, `waves[${index}].cutoffTime`), dockReservationIds: sortedUnique(stringList(row.dockReservationIds, `waves[${index}].dockReservationIds`), `waves[${index}].dockReservationIds`), orderIds: sortedUnique(stringList(row.orderIds, `waves[${index}].orderIds`), `waves[${index}].orderIds`), tripIds: sortedUnique(stringList(row.tripIds, `waves[${index}].tripIds`), `waves[${index}].tripIds`), status };
    });
    scenario.dockReservations = entities(input.dockReservations, "dockReservations", "reservationId", (row, index) => ({ ...row, reservationId: id(row.reservationId, `dockReservations[${index}].reservationId`), dockId: id(row.dockId, `dockReservations[${index}].dockId`), vehicleId: id(row.vehicleId, `dockReservations[${index}].vehicleId`), tripId: id(row.tripId, `dockReservations[${index}].tripId`) }));
    scenario.policies = safeValue(input.policies || {}, "policies");
    scenario.constraints = safeValue(input.constraints || {}, "constraints");
    scenario.assumptions = safeValue(input.assumptions || {}, "assumptions");
    scenario.routingContext = safeValue(input.routingContext || {}, "routingContext");

    const depots = idSet(scenario.depots, "depotId"); const docks = idSet(scenario.docks, "dockId"); const zones = idSet(scenario.zones, "zoneId");
    const vehicleTypes = idSet(scenario.vehicleTypes, "vehicleTypeId"); const vehicles = idSet(scenario.vehicles, "vehicleId"); const drivers = idSet(scenario.drivers, "driverId");
    const orders = idSet(scenario.orders, "orderId"); const trips = idSet(scenario.trips, "tripId"); const reservations = idSet(scenario.dockReservations, "reservationId");
    scenario.docks.forEach((row) => requireReference([row.depotId], depots, "NETWORK_DOCK_DEPOT_UNKNOWN", `dock:${row.dockId}`));
    scenario.depots.forEach((row) => { requireReference(row.dockIds, docks, "NETWORK_DEPOT_DOCK_UNKNOWN", `depot:${row.depotId}`); requireReference(row.serviceZoneIds, zones, "NETWORK_DEPOT_ZONE_UNKNOWN", `depot:${row.depotId}`); requireReference(row.startVehicleIds, vehicles, "NETWORK_DEPOT_VEHICLE_UNKNOWN", `depot:${row.depotId}`); requireReference(row.allowedVehicleTypes, vehicleTypes, "NETWORK_VEHICLE_TYPE_UNKNOWN", `depot:${row.depotId}`); });
    scenario.vehicles.forEach((row) => { requireReference([row.homeDepotId, ...row.allowedStartDepotIds, ...row.allowedEndDepotIds], depots, "NETWORK_VEHICLE_DEPOT_UNKNOWN", `vehicle:${row.vehicleId}`); requireReference([row.vehicleTypeId], vehicleTypes, "NETWORK_VEHICLE_TYPE_UNKNOWN", `vehicle:${row.vehicleId}`); });
    scenario.drivers.forEach((row) => { requireReference([row.homeDepotId, ...row.allowedEndDepotIds], depots, "NETWORK_DRIVER_DEPOT_UNKNOWN", `driver:${row.driverId}`); requireReference(row.compatibleVehicleTypes, vehicleTypes, "NETWORK_VEHICLE_TYPE_UNKNOWN", `driver:${row.driverId}`); });
    scenario.orders.forEach((row) => { requireReference(row.allowedDepotIds, depots, "NETWORK_ORDER_DEPOT_UNKNOWN", `order:${row.orderId}`); requireReference(row.forbiddenDepotIds, depots, "NETWORK_ORDER_DEPOT_UNKNOWN", `order:${row.orderId}`); if (row.fixedDepotId) requireReference([row.fixedDepotId], depots, "NETWORK_ORDER_DEPOT_UNKNOWN", `order:${row.orderId}`); if (row.zoneId) requireReference([row.zoneId], zones, "NETWORK_ORDER_ZONE_UNKNOWN", `order:${row.orderId}`); requireReference(row.requiredVehicleTypes, vehicleTypes, "NETWORK_VEHICLE_TYPE_UNKNOWN", `order:${row.orderId}`); const conflict = row.allowedDepotIds.find((value) => row.forbiddenDepotIds.includes(value)); if (conflict) fail("NETWORK_DEPOT_RULE_CONFLICT", "A depot cannot be both allowed and forbidden.", { orderId: row.orderId, depotId: conflict }); if (row.preferredDepotId && !row.allowedDepotIds.includes(row.preferredDepotId) && !row.preferredDepotException) fail("NETWORK_PREFERRED_DEPOT_INVALID", "Preferred depot must be allowed or explicitly excepted.", { orderId: row.orderId }); if (row.fixedDepotId && (!row.allowedDepotIds.includes(row.fixedDepotId) || row.forbiddenDepotIds.includes(row.fixedDepotId))) fail("NETWORK_FIXED_DEPOT_INVALID", "Fixed depot must be allowed and not forbidden.", { orderId: row.orderId, depotId: row.fixedDepotId }); });
    scenario.trips.forEach((row) => { requireReference([row.vehicleId], vehicles, "NETWORK_TRIP_VEHICLE_UNKNOWN", `trip:${row.tripId}`); requireReference([row.driverId], drivers, "NETWORK_TRIP_DRIVER_UNKNOWN", `trip:${row.tripId}`); requireReference([row.startDepotId, row.endDepotId], depots, "NETWORK_TRIP_DEPOT_UNKNOWN", `trip:${row.tripId}`); if (row.predecessorTripId) requireReference([row.predecessorTripId], trips, "NETWORK_TRIP_LINK_UNKNOWN", `trip:${row.tripId}`); if (row.successorTripId) requireReference([row.successorTripId], trips, "NETWORK_TRIP_LINK_UNKNOWN", `trip:${row.tripId}`); });
    scenario.trips.forEach((row) => { if (row.successorTripId && scenario.trips.find((item) => item.tripId === row.successorTripId)?.predecessorTripId !== row.tripId) fail("NETWORK_TRIP_LINK_MISMATCH", "Trip predecessor/successor links must agree.", { tripId: row.tripId }); });
    scenario.routes.forEach((row) => { requireReference([row.tripId], trips, "NETWORK_ROUTE_TRIP_UNKNOWN", `route:${row.routeId}`); requireReference(row.stops.map((stop) => stop.orderId), orders, "NETWORK_ROUTE_ORDER_UNKNOWN", `route:${row.routeId}`); });
    scenario.waves.forEach((row) => { requireReference([row.depotId], depots, "NETWORK_WAVE_DEPOT_UNKNOWN", `wave:${row.waveId}`); requireReference(row.orderIds, orders, "NETWORK_WAVE_ORDER_UNKNOWN", `wave:${row.waveId}`); requireReference(row.tripIds, trips, "NETWORK_WAVE_TRIP_UNKNOWN", `wave:${row.waveId}`); requireReference(row.dockReservationIds, reservations, "NETWORK_WAVE_RESERVATION_UNKNOWN", `wave:${row.waveId}`); });
    scenario.transfers.forEach((row) => { requireReference([row.fromTripId, row.toTripId], trips, "NETWORK_TRANSFER_TRIP_UNKNOWN", `transfer:${row.transferId}`); requireReference([row.depotId], depots, "NETWORK_TRANSFER_DEPOT_UNKNOWN", `transfer:${row.transferId}`); });
    const pairedOrders = new Set(); scenario.pickupDeliveryPairs.forEach((row) => { requireReference([row.pickupOrderId, row.deliveryOrderId], orders, "NETWORK_PAIR_ORDER_UNKNOWN", `pair:${row.pairId}`); for (const orderId of [row.pickupOrderId, row.deliveryOrderId]) { if (pairedOrders.has(orderId)) fail("NETWORK_ORDER_MULTIPLE_PAIRS", "An order cannot belong to multiple pickup-delivery pairs.", { orderId }); pairedOrders.add(orderId); } });
    return scenario;
  }

  function contentProjection(scenario) {
    const { policies, constraints, assumptions, routingContext, ...content } = scenario;
    return content;
  }
  function identityBundle(source, solveOptions = {}) {
    const scenario = normalizeScenario(source);
    const networkContentHash = Integrity.hashValue(contentProjection(scenario));
    const networkInputHash = Integrity.hashValue({ content: contentProjection(scenario), policies: scenario.policies, constraints: scenario.constraints, assumptions: scenario.assumptions });
    const routingContextHash = Integrity.hashValue(scenario.routingContext);
    const solveContextHash = Integrity.hashValue({ networkInputHash, routingContextHash, solveOptions: safeValue(solveOptions, "solveOptions") });
    return { schemaVersion: "stct-network-identity-v1.8", canonicalVersion: Integrity.VERSION, scenario, networkContentHash, networkInputHash, routingContextHash, solveContextHash };
  }
  const _hashMemo = new WeakMap();
  function hashArtifact(value) {
    // F17：冻结（不可变）对象的规范哈希按对象身份备忘——不可变性保证哈希稳定，
    // 校验语义不变（Tamper 无法作用于冻结对象）；非冻结对象每次重算。
    if (value && typeof value === 'object' && Object.isFrozen(value)) {
      const hit = _hashMemo.get(value); if (hit) return hit;
      const out = Integrity.hashValue(safeValue(value));
      _hashMemo.set(value, out);
      return out;
    }
    return Integrity.hashValue(safeValue(value));
  }
  const _bodyHashMemo = new WeakMap();
  function hashBodyMemoized(obj, omitKey) {
    // F17：冻结主体的去键规范哈希按对象身份备忘（不可变性保证稳定）；重复校验零重算。
    const compute = () => hashArtifact(Object.fromEntries(Object.entries(obj).filter(([k]) => k !== omitKey)));
    if (obj && typeof obj === 'object' && Object.isFrozen(obj)) {
      const hit = _bodyHashMemo.get(obj); if (hit) return hit;
      const out = compute();
      _bodyHashMemo.set(obj, out);
      return out;
    }
    return compute();
  }
  function verifyHash(value, expected, code = "NETWORK_HASH_MISMATCH") { const actual = hashArtifact(value); if (actual !== expected) fail(code, "Canonical SHA-256 mismatch.", { expected, actual }); return actual; }
  function isSha256(value) { return /^sha256:[a-f0-9]{64}$/.test(String(value || "")); }

  return {
    VERSION, LIMITS, NetworkContractError, safeValue, normalizeScenario, contentProjection, identityBundle,
    hashArtifact, hashBodyMemoized, verifyHash, isSha256, canonicalString: Integrity.canonicalString, utf8Compare: Integrity.utf8Compare,
  };
});
