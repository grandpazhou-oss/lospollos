(function (root, factory) {
  "use strict";
  const contract = typeof module !== "undefined" && module.exports ? require("./network-contract-v18.js") : root.STCTV18?.networkContract;
  const api = factory(contract);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV18 = root.STCTV18 || { version: "1.8.0" }; root.STCTV18.depotAssignment = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contract) {
  "use strict";

  if (!Contract?.normalizeScenario) throw new Error("STCT v1.8 network contract is required.");
  const VERSION = "stct-depot-assignment-v1.8";
  const EARTH_KM = 6371.0088;
  const REASONS = Object.freeze({
    ASSIGNED_FIXED: { zh: "固定仓约束", en: "Fixed depot constraint", ja: "固定デポ制約" },
    ASSIGNED_PREFERRED: { zh: "首选仓且满足硬约束", en: "Preferred eligible depot", ja: "優先デポかつハード制約適合" },
    ASSIGNED_BEST_SCORE: { zh: "满足硬约束后的最低综合代价", en: "Lowest score after hard constraints", ja: "ハード制約適合後の最小総合コスト" },
    NO_ALLOWED_DEPOT: { zh: "没有允许的仓库", en: "No allowed depot", ja: "許可されたデポがありません" },
    FIXED_DEPOT_INELIGIBLE: { zh: "固定仓不满足硬约束", en: "Fixed depot is ineligible", ja: "固定デポがハード制約を満たしません" },
    HARD_ZONE_MISMATCH: { zh: "不在硬服务区域", en: "Hard service-zone mismatch", ja: "ハードサービスゾーン不一致" },
    DEPOT_CAPACITY_EXCEEDED: { zh: "仓库硬容量已满", en: "Hard depot capacity exceeded", ja: "デポのハード容量超過" },
    REQUIRED_SKILL_UNAVAILABLE: { zh: "没有具备所需技能的司机", en: "Required driver skill unavailable", ja: "必要スキルを持つドライバーがいません" },
    REQUIRED_VEHICLE_UNAVAILABLE: { zh: "没有兼容车型", en: "Compatible vehicle unavailable", ja: "互換車種がありません" },
    DEPOT_CLOSED: { zh: "仓库营业窗不覆盖订单", en: "Depot operating window does not cover the order", ja: "デポ営業時間がオーダーをカバーしません" },
    DEPOT_ROLE_INELIGIBLE: { zh: "仓库角色不支持该任务", en: "Depot role does not support this task", ja: "デポ役割がこのタスクをサポートしません" },
  });
  const text = (value) => String(value ?? "");
  const minute = (value) => { const [hour, minutes] = text(value).split(":").map(Number); return hour * 60 + minutes; };
  function normalizeInterval(row) { const start = minute(row.start); let end = minute(row.end); if (end <= start) end += 1440; return [start, end]; }
  function overlaps(left, right) { const a = normalizeInterval(left); const b = normalizeInterval(right); return Math.max(a[0], b[0]) < Math.min(a[1], b[1]) || Math.max(a[0], b[0] + 1440) < Math.min(a[1], b[1] + 1440); }
  function radians(value) { return Number(value) * Math.PI / 180; }
  function haversineKm(left, right) {
    const latitude = radians(right[1] - left[1]); const longitude = radians(right[0] - left[0]);
    const a = Math.sin(latitude / 2) ** 2 + Math.cos(radians(left[1])) * Math.cos(radians(right[1])) * Math.sin(longitude / 2) ** 2;
    return Math.round(2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a))) * 1000) / 1000;
  }
  function reasonText(code, locale = "en") { const language = text(locale).startsWith("zh") ? "zh" : text(locale).startsWith("ja") ? "ja" : "en"; return REASONS[code]?.[language] || code; }
  function dayKey(order, scenario) {
    if (order.serviceDay) return order.serviceDay;
    const start = minute(scenario.planningHorizon.businessDayStart); const due = minute(order.dueTime);
    return due < start && scenario.planningHorizon.crossMidnightPolicy === "ALLOW" ? "DAY-1/NEXT-DAY" : "DAY-1";
  }
  function capacityState() { return { orders: 0, volume: 0, weight: 0, handlingMinutes: 0, vehicles: new Set() }; }
  function demand(order, key) { const value = Number(order.demand?.[key] || 0); return Number.isFinite(value) ? value : 0; }
  function compatibleVehicles(scenario, depot, order) {
    const allowedTypes = new Set(depot.allowedVehicleTypes);
    return scenario.vehicles.filter((vehicle) => {
      const startAllowed = vehicle.homeDepotId === depot.depotId || vehicle.allowedStartDepotIds.includes(depot.depotId);
      const typeAllowed = (!allowedTypes.size || allowedTypes.has(vehicle.vehicleTypeId)) && (!order.requiredVehicleTypes.length || order.requiredVehicleTypes.includes(vehicle.vehicleTypeId));
      const available = vehicle.availabilityWindows.some(window => !order.timeWindows.length || order.timeWindows.some(required => overlaps(window, required)));
      return startAllowed && typeAllowed && available;
    });
  }
  function compatibleDrivers(scenario, depot, order, vehicles) {
    const vehicleTypes = new Set(vehicles.map((vehicle) => vehicle.vehicleTypeId));
    return scenario.drivers.filter((driver) => driver.homeDepotId === depot.depotId && driver.shiftWindows.some(window => !order.timeWindows.length || order.timeWindows.some(required => overlaps(window, required))) && order.requiredSkills.every((skill) => driver.skills.includes(skill)) && driver.compatibleVehicleTypes.some((type) => vehicleTypes.has(type)));
  }
  function roleSupports(depot, order) {
    if (depot.role === "CROSS_DOCK" && !depot.capabilities.includes(order.taskType) && !["TRANSFER_IN", "TRANSFER_OUT"].includes(order.taskType)) return false;
    if (depot.role === "RETURN_CENTER" && !depot.capabilities.includes(order.taskType) && order.taskType !== "RETURN") return false;
    return true;
  }
  function capacityCheck(depot, order, state, hard, vehicleId) {
    const limit = depot.capacity || {};
    const next = { orders: state.orders + 1, volume: state.volume + demand(order, "volume"), weight: state.weight + demand(order, "weight"), handlingMinutes: state.handlingMinutes + order.serviceDuration };
    const breaches = [];
    if (Number(limit.dailyOrders) >= 0 && next.orders > Number(limit.dailyOrders)) breaches.push("dailyOrders");
    if (Number(limit.volume) >= 0 && next.volume > Number(limit.volume)) breaches.push("volume");
    if (Number(limit.weight) >= 0 && next.weight > Number(limit.weight)) breaches.push("weight");
    if (Number(limit.handlingMinutes) >= 0 && next.handlingMinutes > Number(limit.handlingMinutes)) breaches.push("handlingMinutes");
    const nextVehicleCount = state.vehicles.size + (state.vehicles.has(vehicleId) ? 0 : 1);
    if (Number(limit.parkingSlots) >= 0 && nextVehicleCount > Number(limit.parkingSlots)) breaches.push("parkingSlots");
    return { allowed: !hard || !breaches.length, breaches, next, penalty: breaches.length * 10000 };
  }
  function evaluate(scenario, order, depot, state, options = {}) {
    if (order.fixedDepotId && order.fixedDepotId !== depot.depotId) return { eligible: false, code: "FIXED_DEPOT_INELIGIBLE" };
    if (order.allowedDepotIds.length && !order.allowedDepotIds.includes(depot.depotId)) return { eligible: false, code: "NO_ALLOWED_DEPOT" };
    if (order.forbiddenDepotIds.includes(depot.depotId)) return { eligible: false, code: "NO_ALLOWED_DEPOT" };
    const zone = scenario.zones.find((row) => row.zoneId === order.zoneId);
    if (zone?.mode === "HARD" && !zone.depotIds.includes(depot.depotId)) return { eligible: false, code: "HARD_ZONE_MISMATCH" };
    if (!roleSupports(depot, order)) return { eligible: false, code: "DEPOT_ROLE_INELIGIBLE" };
    if (order.timeWindows.length && depot.operatingWindows.length && !order.timeWindows.some((window) => depot.operatingWindows.some((operating) => overlaps(window, operating)))) return { eligible: false, code: "DEPOT_CLOSED" };
    const vehicles = compatibleVehicles(scenario, depot, order);
    if (!vehicles.length) return { eligible: false, code: "REQUIRED_VEHICLE_UNAVAILABLE" };
    const drivers = compatibleDrivers(scenario, depot, order, vehicles).filter((driver) => vehicles.some((vehicle) => vehicle.allowedEndDepotIds.some((depotId) => driver.allowedEndDepotIds.includes(depotId))));
    if (!drivers.length) return { eligible: false, code: "REQUIRED_SKILL_UNAVAILABLE" };
    const capacity = capacityCheck(depot, order, state, scenario.constraints.hardDepotCapacity !== false, vehicles[0].vehicleId);
    if (!capacity.allowed) return { eligible: false, code: "DEPOT_CAPACITY_EXCEEDED", capacity };
    const distance = haversineKm(depot.coordinate, order.coordinate) * Number(scenario.assumptions.syntheticRoadFactor || 1);
    const preferredPenalty = order.preferredDepotId && order.preferredDepotId !== depot.depotId ? Number(options.preferredPenalty ?? 25) : 0;
    const zonePenalty = zone?.mode === "PREFERRED" && !zone.depotIds.includes(depot.depotId) ? Number(options.zonePenalty ?? 50) : zone?.mode === "PENALTY" && zone.depotIds.includes(depot.depotId) ? Number(options.zonePenalty ?? 50) : 0;
    const handlingCost = Number(depot.variableHandlingCost || 0) * (demand(order, "volume") + demand(order, "weight") / 100);
    const carbon = distance * Number(depot.carbonFactor || 0);
    const score = distance + handlingCost + carbon + preferredPenalty + zonePenalty + capacity.penalty;
    const selectedVehicle = vehicles.find((vehicle) => vehicle.allowedEndDepotIds.some((depotId) => drivers[0].allowedEndDepotIds.includes(depotId)));
    const endDepotIds = selectedVehicle.allowedEndDepotIds.filter((depotId) => drivers[0].allowedEndDepotIds.includes(depotId));
    return { eligible: true, code: order.fixedDepotId ? "ASSIGNED_FIXED" : order.preferredDepotId === depot.depotId ? "ASSIGNED_PREFERRED" : "ASSIGNED_BEST_SCORE", distance, handlingCost, carbon, score, preferredPenalty, zonePenalty, capacity, vehicles, drivers, selectedVehicle, endDepotIds, zoneMatch: zone ? zone.depotIds.includes(depot.depotId) : null };
  }
  function assignDepots(source, options = {}) {
    const identities = Contract.identityBundle(source, { stage: "DEPOT_ASSIGNMENT", objective: options.objective || "BALANCED_NETWORK" });
    const scenario = identities.scenario; const states = new Map(); const assignments = []; const unassigned = []; const blocked = [];
    for (const depot of scenario.depots) states.set(depot.depotId, new Map());
    const ordered = [...scenario.orders].sort((left, right) => right.priorityWeight - left.priorityWeight || Contract.utf8Compare(left.orderId, right.orderId));
    for (const order of ordered) {
      const candidates = scenario.depots.map((depot) => {
        const days = states.get(depot.depotId); const key = dayKey(order, scenario); if (!days.has(key)) days.set(key, capacityState());
        return { depot, state: days.get(key), day: key, result: evaluate(scenario, order, depot, days.get(key), options) };
      });
      const eligible = candidates.filter((row) => row.result.eligible).sort((left, right) => left.result.score - right.result.score || Contract.utf8Compare(left.depot.depotId, right.depot.depotId));
      if (!eligible.length) {
        const codes = [...new Set(candidates.map((row) => row.result.code))].sort(Contract.utf8Compare);
        const code = order.fixedDepotId ? "FIXED_DEPOT_INELIGIBLE" : codes.includes("DEPOT_CAPACITY_EXCEEDED") ? "DEPOT_CAPACITY_EXCEEDED" : codes[0] || "NO_ALLOWED_DEPOT";
        unassigned.push({ orderId: order.orderId, reasonCode: code, reason: reasonText(code, options.locale), evaluatedDepotIds: candidates.map((row) => row.depot.depotId) });
        continue;
      }
      const selected = eligible[0]; const state = selected.state; Object.assign(state, selected.result.capacity.next); state.vehicles.add(selected.result.selectedVehicle.vehicleId);
      assignments.push({
        orderId: order.orderId, assignedDepotId: selected.depot.depotId, eligibility: "HARD_FEASIBLE", reasonCode: selected.result.code,
        reason: reasonText(selected.result.code, options.locale), distanceKm: Math.round(selected.result.distance * 1000) / 1000,
        distanceSource: "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR", handlingCost: Math.round(selected.result.handlingCost * 1000) / 1000,
        carbonKg: Math.round(selected.result.carbon * 1000) / 1000, serviceRisk: selected.result.preferredPenalty + selected.result.zonePenalty + selected.result.capacity.penalty,
        zoneMatch: selected.result.zoneMatch, confidence: "SYNTHETIC_ESTIMATE", serviceDay: selected.day,
        suggestedVehicleId: selected.result.selectedVehicle.vehicleId, suggestedDriverId: selected.result.drivers[0].driverId,
        suggestedStartDepotId: selected.depot.depotId, suggestedEndDepotId: selected.result.endDepotIds[0] || selected.depot.depotId,
      });
    }
    assignments.sort((left, right) => Contract.utf8Compare(left.orderId, right.orderId)); unassigned.sort((left, right) => Contract.utf8Compare(left.orderId, right.orderId));
    const result = { schemaVersion: "stct-depot-assignment-result-v1.8", networkInputHash: identities.networkInputHash, routingContextHash: identities.routingContextHash, objective: options.objective || "BALANCED_NETWORK", assignments, unassigned, blocked, metrics: { assignedOrders: assignments.length, unassignedOrders: unassigned.length, blockedOrders: blocked.length, handlingCost: assignments.reduce((sum, row) => sum + row.handlingCost, 0), estimatedDistanceKm: assignments.reduce((sum, row) => sum + row.distanceKm, 0), estimatedCarbonKg: assignments.reduce((sum, row) => sum + row.carbonKg, 0) } };
    result.assignmentHash = Contract.hashArtifact({ networkInputHash: result.networkInputHash, routingContextHash: result.routingContextHash, objective: result.objective, assignments, unassigned, blocked });
    return result;
  }
  function verifyAssignment(source, result) {
    const expected = assignDepots(source, { objective: result.objective, locale: "en" }); const issues = [];
    if (result.networkInputHash !== expected.networkInputHash) issues.push("STALE_NETWORK_INPUT");
    if (result.routingContextHash !== expected.routingContextHash) issues.push("STALE_ROUTING_CONTEXT");
    const facts = (row) => [row.orderId, row.assignedDepotId, row.reasonCode, row.serviceDay, row.suggestedVehicleId, row.suggestedDriverId, row.suggestedStartDepotId, row.suggestedEndDepotId];
    const observedFacts = (result.assignments || []).map(facts); const expectedFacts = expected.assignments.map(facts);
    if (Contract.canonicalString(observedFacts) !== Contract.canonicalString(expectedFacts)) issues.push("ASSIGNMENT_FACT_MISMATCH");
    if (Contract.canonicalString((result.unassigned || []).map((row) => [row.orderId, row.reasonCode])) !== Contract.canonicalString(expected.unassigned.map((row) => [row.orderId, row.reasonCode]))) issues.push("UNASSIGNED_FACT_MISMATCH");
    const recomputedMetrics = expected.metrics;
    if (Contract.canonicalString(result.metrics || {}) !== Contract.canonicalString(recomputedMetrics)) issues.push("ASSIGNMENT_METRIC_MISMATCH");
    const actualHash = Contract.hashArtifact({ networkInputHash: result.networkInputHash, routingContextHash: result.routingContextHash, objective: result.objective, assignments: result.assignments || [], unassigned: result.unassigned || [], blocked: result.blocked || [] });
    if (actualHash !== result.assignmentHash) issues.push("ASSIGNMENT_HASH_MISMATCH");
    return { schemaVersion: "stct-assignment-verification-v1.8", status: issues.length ? "FAIL" : "PASS", issues, recomputedMetrics, expectedAssignmentHash: expected.assignmentHash };
  }
  function filterAssignments(result, depotId) { return result.assignments.filter((row) => !depotId || row.assignedDepotId === depotId); }
  function depotInspector(source, result, depotId) { const scenario = Contract.normalizeScenario(source); const depot = scenario.depots.find((row) => row.depotId === depotId); return { depot, assignments: filterAssignments(result, depotId), metrics: { orders: filterAssignments(result, depotId).length, volume: filterAssignments(result, depotId).reduce((sum, row) => sum + Number(scenario.orders.find((order) => order.orderId === row.orderId)?.demand?.volume || 0), 0) } }; }
  function tableRows(result) { return result.assignments.map((row) => ({ depotId: row.assignedDepotId, orderId: row.orderId, reasonCode: row.reasonCode, distanceKm: row.distanceKm, distanceSource: row.distanceSource, zoneMatch: row.zoneMatch })); }
  function safeCsvCell(value) { const string = text(value); const protectedValue = /^[=+\-@]/.test(string) ? `'${string}` : string; return `"${protectedValue.replace(/"/g, '""')}"`; }
  function toCsv(result) { return [["orderId", "depotId", "reasonCode", "distanceKm"], ...result.assignments.map((row) => [row.orderId, row.assignedDepotId, row.reasonCode, row.distanceKm])].map((row) => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n"; }
  function replay(source, capsuleResult) { const result = assignDepots(source, { objective: capsuleResult.objective }); return { status: result.assignmentHash === capsuleResult.assignmentHash ? "EQUIVALENT" : "MISMATCH", assignmentHash: result.assignmentHash }; }
  function compare(left, right) { return { comparable: left.networkInputHash === right.networkInputHash, label: left.networkInputHash === right.networkInputHash ? "SAME_INPUT_OPTIMIZATION" : "SCENARIO_CHANGED" }; }

  return { VERSION, REASONS, reasonText, haversineKm, dayKey, evaluate, assignDepots, verifyAssignment, filterAssignments, depotInspector, tableRows, toCsv, replay, compare };
});
