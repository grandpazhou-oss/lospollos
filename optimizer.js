(function () {
  "use strict";

  const GOALS = [
    { id: "vehicles", label: "最少车辆", definition: "先减少使用车辆数，再减少估算道路距离" },
    { id: "distance", label: "最短距离", definition: "减少 Haversine 直线距离乘道路折算系数后的总距离" },
    { id: "utilization", label: "最高装载率", definition: "在不增加未分配订单的前提下优先匹配容积容量" },
    { id: "cost", label: "最低成本", definition: "减少车辆固定成本、距离成本和停靠成本" },
    { id: "carbon", label: "最低碳排", definition: "按车辆排放因子减少估算 CO2" },
    { id: "balanced", label: "均衡方案", definition: "按公开权重平衡未分配、车辆、距离、完成时间、成本、碳排与低利用率" },
  ];

  const planning = {
    phase: "builtin",
    batchId: "BUILTIN",
    inputFingerprint: "",
    raw: null,
    candidates: [],
    selectedScenarioId: null,
    appliedScenarioId: null,
    beforeApply: null,
    staleReason: "",
    generating: false,
    progress: "",
    engineHealth: { ok: false, available: false, engine: "Demo Heuristic", status: "not_checked" },
  };

  const clone = (value) => window.STCTUtils?.clone ? window.STCTUtils.clone(value) : JSON.parse(JSON.stringify(value));
  const numeric = (value, fallback = 0) => {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const result = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(result) ? result : fallback;
  };
  const text = (value, fallback = "") => String(value ?? fallback).trim();
  const emptyCollection = () => ({ type: "FeatureCollection", features: [] });
  const colorAt = (index) => ["#2563eb", "#0891b2", "#16a34a", "#f97316", "#dc2626", "#7c3aed", "#0f766e", "#a855f7", "#ca8a04", "#be123c"][index % 10];

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
    return value;
  }

  function fingerprint(value) {
    const source = JSON.stringify(stableValue(value));
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function config() {
    return window.STCT_CONFIG || {};
  }

  function costModel() {
    const value = config().costModel || {};
    return {
      currency: value.currency || "CNY",
      fixedVehicleCost: numeric(value.fixedVehicleCost ?? value.baseFare, 120),
      perKm: numeric(value.perKm, 4.8),
      perStop: numeric(value.perStop, 8),
    };
  }

  function carbonModel() {
    const value = config().carbonModel || {};
    return { defaultVehicleFactor: numeric(value.defaultVehicleFactor ?? value.kgPerKm, 0.192), unit: "kgCO2/km" };
  }

  function assumptions(raw) {
    return {
      distanceModel: "haversineKm × roadDistanceFactor",
      roadDistanceFactor: numeric(raw?.constraints?.roadDistanceFactor, numeric(config().roadDistanceFactor, 1.35)),
      averageSpeedKmh: numeric(raw?.constraints?.averageSpeedKmh, numeric(config().averageSpeedKmh, 28)),
      defaultServiceMinutes: numeric(raw?.constraints?.defaultServiceMinutes, numeric(config().defaultServiceMinutes, 5)),
      costModel: costModel(),
      carbonModel: carbonModel(),
      balancedWeights: { unassigned: 1000, vehicles: 25, distance: 1, latestEnd: 0.2, lowUtilization: 8, cost: 0.15, carbon: 2, ...(config().balancedWeights || {}) },
      disclaimer: "估算道路距离，不是正式货车导航距离；地图线路形状仅用于本地演示。",
    };
  }

  function normalizeCoord(row) {
    if (window.STCTUtils?.normalizeCoordinate) return window.STCTUtils.normalizeCoordinate(row);
    let lon = numeric(row?.lon, NaN);
    let lat = numeric(row?.lat, NaN);
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 60 && Math.abs(lat) > 60) [lon, lat] = [lat, lon];
    return { lon, lat, valid: Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 };
  }

  function haversineKm(a, b, factor) {
    const radius = 6371;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const deltaLat = (b[1] - a[1]) * Math.PI / 180;
    const deltaLon = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))) * factor;
  }

  function timeToMinutes(value, fallback) {
    const parsed = window.STCTUtils?.timeToMinutes?.(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  }

  function overnightEnd(start, end) {
    return end <= start ? end + 1440 : end;
  }

  function timeText(value) {
    let total = Math.max(0, Math.round(value));
    const next = total >= 1440;
    total %= 1440;
    return `${next ? "次日 " : ""}${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function filteredInput(raw, date, limit) {
    let orders = (raw?.orders || []).filter((order) => !date || date === "ALL" || text(order.date) === date);
    const vehicles = (raw?.vehicles || []).filter((vehicle) => !vehicle.availableDate || !date || date === "ALL" || text(vehicle.availableDate) === date);
    if (limit !== "ALL") orders = orders.slice(0, Math.max(1, numeric(limit, 60)));
    return { orders, vehicles, depot: raw?.depot, constraints: raw?.constraints || {} };
  }

  function inputFingerprint(raw, date, limit) {
    return fingerprint(filteredInput(raw, date, limit));
  }

  function setRawData(raw, batchId) {
    planning.raw = clone(raw);
    planning.batchId = batchId || `BATCH-${Date.now()}`;
    planning.phase = "raw-awaiting-plan";
    planning.inputFingerprint = "";
    planning.candidates = [];
    planning.selectedScenarioId = null;
    planning.appliedScenarioId = null;
    planning.staleReason = "";
    emitState();
  }

  function markPreview(batchId) {
    planning.phase = "preview";
    planning.batchId = batchId || planning.batchId;
    emitState();
  }

  function invalidate(reason) {
    if (planning.candidates.length) {
      planning.candidates = [];
      planning.selectedScenarioId = null;
      planning.inputFingerprint = "";
      planning.staleReason = reason || "规划输入已变化，旧候选方案已失效。";
      planning.phase = planning.raw ? "raw-awaiting-plan" : "builtin";
      emitState();
    }
  }

  function emitState() {
    window.dispatchEvent(new CustomEvent("stct:planning-state", { detail: snapshot() }));
  }

  function snapshot() {
    return {
      phase: planning.phase,
      batchId: planning.batchId,
      inputFingerprint: planning.inputFingerprint,
      candidates: planning.candidates,
      selectedScenarioId: planning.selectedScenarioId,
      appliedScenarioId: planning.appliedScenarioId,
      staleReason: planning.staleReason,
      generating: planning.generating,
      progress: planning.progress,
      engineHealth: planning.engineHealth,
    };
  }

  function buildRequest({ raw, date, goal, limit, timeLimitSeconds = 30, batchId, inputFingerprint: inputHash }) {
    const model = assumptions(raw);
    return {
      version: "v1.4-trust-closure-mission-control",
      engine: "ortools",
      raw,
      date,
      goal,
      limit,
      timeLimitSeconds: Math.min(numeric(config().maxSolveSeconds, 45), numeric(timeLimitSeconds, 30)),
      batchId: batchId || planning.batchId,
      inputFingerprint: inputHash || inputFingerprint(raw, date, limit),
      roadDistanceFactor: model.roadDistanceFactor,
      costModel: model.costModel,
      carbonModel: model.carbonModel,
      balancedWeights: model.balancedWeights,
    };
  }

  function solveTimeLimit(limit) {
    if (String(limit) === "60") return 4;
    if (String(limit) === "120") return 7;
    if (String(limit) === "240") return 12;
    return 20;
  }

  function normalizeResponse(json) {
    if (!json?.ok || !json?.plan) throw new Error(json?.error || "OR-Tools 服务未返回结果");
    const plan = json.plan;
    return {
      ...plan,
      engine: "OR-Tools",
      meta: { ...(plan.meta || {}), source: "Local OR-Tools API", apiVersion: json.version || "v1.4-trust-closure-mission-control" },
    };
  }

  async function healthCheck() {
    if (config().forceHeuristic) {
      planning.engineHealth = { ok: true, available: false, forced: true, engine: "Demo Heuristic", status: "forced_heuristic" };
      emitState();
      return planning.engineHealth;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2200);
    try {
      const response = await fetch(config().optimizerHealthUrl || "http://127.0.0.1:8787/health", { signal: controller.signal, cache: "no-store" });
      const body = await response.json();
      planning.engineHealth = { ok: response.ok && Boolean(body.ok), available: Boolean(body.available), engine: body.engine || "Demo Heuristic", status: body.status || "unknown", maxOrders: body.maxOrders, maxSolveSeconds: body.maxSolveSeconds };
    } catch (error) {
      planning.engineHealth = { ok: false, available: false, engine: "Demo Heuristic", status: error.name === "AbortError" ? "timeout" : "unreachable", error: error.message };
    } finally {
      clearTimeout(timeout);
    }
    emitState();
    return planning.engineHealth;
  }

  function reasonRow(order, category, reason, suggestion, status) {
    return { ...order, id: order.id || order.orderId || order.code, code: order.code || order.id || order.orderId, reasonCategory: category, reason, suggestion, assignmentStatus: status };
  }

  function routeCost(route) {
    const model = costModel();
    return numeric(route.estimatedCost, numeric(route.fixedCost, model.fixedVehicleCost) + numeric(route.km) * numeric(route.perKmCost, model.perKm) + numeric(route.stops) * numeric(route.perStopCost, model.perStop));
  }

  function utilNumber(value) {
    return numeric(String(value ?? "0").replace("%", ""), 0);
  }

  function planMetrics(plan) {
    const routes = plan?.routes || [];
    const conservation = plan?.conservation || {};
    const totalDistance = routes.reduce((sum, route) => sum + numeric(route.km), 0);
    const packages = routes.reduce((sum, route) => sum + numeric(route.packages), 0);
    const orders = routes.reduce((sum, route) => sum + numeric(route.orders ?? route.stops), 0);
    const stops = routes.reduce((sum, route) => sum + numeric(route.stops), 0);
    const volumeValues = routes.map((route) => utilNumber(route.volumeUtil));
    const weightValues = routes.filter((route) => route.weightUtil !== "N/A" && route.weightUtil !== undefined).map((route) => utilNumber(route.weightUtil));
    const cost = routes.reduce((sum, route) => sum + routeCost(route), 0);
    const co2 = routes.reduce((sum, route) => sum + numeric(route.estimatedCo2, numeric(route.km) * numeric(route.emissionFactor, carbonModel().defaultVehicleFactor)), 0);
    const latestEnd = routes.map((route) => ({ label: route.end, value: timeToMinutes(route.end, 0) })).sort((a, b) => a.value - b.value).at(-1)?.label || "-";
    return {
      vehicles: new Set(routes.map((route) => route.vehicleId)).size,
      routes: routes.length,
      orders,
      stops,
      packages,
      totalDistance: Number(totalDistance.toFixed(1)),
      latestEnd,
      avgVolume: volumeValues.length ? Number((volumeValues.reduce((a, b) => a + b, 0) / volumeValues.length).toFixed(1)) : 0,
      avgWeight: weightValues.length ? Number((weightValues.reduce((a, b) => a + b, 0) / weightValues.length).toFixed(1)) : null,
      unassigned: numeric(conservation.unassigned, plan?.unassignedOrders?.length || 0),
      blocked: numeric(conservation.blocked, plan?.blockedOrders?.length || 0),
      assigned: numeric(conservation.assigned, orders),
      cost: Number(cost.toFixed(2)),
      co2: Number(co2.toFixed(3)),
    };
  }

  function heuristicPlan(raw, date, goal, limit, batchId, inputHash, engineError) {
    const selected = filteredInput(raw, date, limit);
    const model = assumptions(raw);
    const depotCoord = normalizeCoord(selected.depot);
    if (!depotCoord.valid) throw new Error("仓库坐标缺失或无效，不能生成方案。");

    const blocked = [];
    const seen = new Set();
    const maxVehicleVolume = Math.max(0, ...selected.vehicles.map((vehicle) => numeric(vehicle.maxVolume)));
    const usableOrders = [];
    selected.orders.forEach((source, index) => {
      const order = { ...source, id: text(source.id || source.orderId || source.code, `ROW-${index + 2}`) };
      const coord = normalizeCoord(order);
      if (seen.has(order.id)) blocked.push(reasonRow(order, "duplicate_order", "订单 ID 重复", "修正为唯一订单 ID", "blocked"));
      else if (!coord.valid) blocked.push(reasonRow(order, "invalid_coordinate", "缺坐标或坐标无效", "补充有效经纬度", "blocked"));
      else if (numeric(order.volume) <= 0) blocked.push(reasonRow(order, "invalid_volume", "订单容积不是正数", "修正订单容积", "blocked"));
      else if (maxVehicleVolume > 0 && numeric(order.volume) > maxVehicleVolume) blocked.push(reasonRow(order, "over_volume_capacity", "单票超过全部车辆容积容量", "拆单或增加大容积车辆", "blocked"));
      else {
        seen.add(order.id);
        usableOrders.push({ ...order, lon: coord.lon, lat: coord.lat });
      }
    });

    let vehicles = selected.vehicles.filter((vehicle) => numeric(vehicle.maxVolume) > 0).map((vehicle, index) => ({ ...vehicle, color: vehicle.color || colorAt(index) }));
    if (!vehicles.length) {
      const allBlocked = blocked.concat(usableOrders.map((order) => reasonRow(order, "vehicle_capacity", "车辆主数据没有有效容积容量", "修正车辆最大容积", "blocked")));
      return emptyPlan(selected, goal, batchId, inputHash, allBlocked, [], model, engineError);
    }
    if (goal === "vehicles") vehicles.sort((a, b) => numeric(b.maxVolume) - numeric(a.maxVolume));
    if (goal === "utilization") vehicles.sort((a, b) => numeric(a.maxVolume) - numeric(b.maxVolume));
    if (goal === "cost") vehicles.sort((a, b) => (numeric(a.fixedCost, model.costModel.fixedVehicleCost) + numeric(a.perKmCost, model.costModel.perKm) * 10) - (numeric(b.fixedCost, model.costModel.fixedVehicleCost) + numeric(b.perKmCost, model.costModel.perKm) * 10));
    if (goal === "carbon") vehicles.sort((a, b) => numeric(a.emissionFactor, model.carbonModel.defaultVehicleFactor) - numeric(b.emissionFactor, model.carbonModel.defaultVehicleFactor));

    const pending = usableOrders.slice();
    const routes = [];
    const routeFeatures = [];
    const stopFeatures = [];
    const depot = { ...selected.depot, lon: depotCoord.lon, lat: depotCoord.lat };

    function candidateScore(candidate, vehicle, currentVolume) {
      const distance = candidate.distance;
      const afterUtil = (currentVolume + numeric(candidate.order.volume)) / Math.max(1, numeric(vehicle.maxVolume));
      const perKm = numeric(vehicle.perKmCost, model.costModel.perKm);
      const emission = numeric(vehicle.emissionFactor, model.carbonModel.defaultVehicleFactor);
      if (goal === "vehicles") return -numeric(candidate.order.volume) * 100 + distance;
      if (goal === "distance") return distance;
      if (goal === "utilization") return Math.abs(1 - afterUtil) * 100 + distance * 0.1;
      if (goal === "cost") return distance * perKm + model.costModel.perStop;
      if (goal === "carbon") return distance * emission;
      const weights = model.balancedWeights;
      return distance * weights.distance + distance * perKm * weights.cost + distance * emission * weights.carbon + Math.abs(1 - afterUtil) * weights.lowUtilization * 10 + candidate.arrive * weights.latestEnd * 0.001;
    }

    vehicles.forEach((vehicle) => {
      if (!pending.length) return;
      const maxVolume = numeric(vehicle.maxVolume);
      const maxWeight = numeric(vehicle.maxWeight);
      const useWeight = maxWeight > 0 && pending.some((order) => numeric(order.weight) > 0);
      const workStart = timeToMinutes(vehicle.start, timeToMinutes(selected.constraints.workStart, 9 * 60));
      const workEnd = overnightEnd(workStart, timeToMinutes(vehicle.end, timeToMinutes(selected.constraints.workEnd, 17 * 60 + 30)));
      let current = [depot.lon, depot.lat];
      let currentTime = workStart;
      let volume = 0;
      let weight = 0;
      let packages = 0;
      let km = 0;
      const routeStops = [];

      while (pending.length) {
        const candidates = pending.map((order, index) => {
          const distance = haversineKm(current, [order.lon, order.lat], model.roadDistanceFactor);
          const rawArrival = currentTime + Math.round(distance / model.averageSpeedKmh * 60);
          const twStart = timeToMinutes(order.twStart, workStart);
          const twEnd = overnightEnd(twStart, timeToMinutes(order.twEnd, workEnd));
          const arrive = Math.max(rawArrival, twStart);
          return { order, index, distance, arrive, twEnd };
        }).filter((candidate) => volume + numeric(candidate.order.volume) <= maxVolume && (!useWeight || weight + numeric(candidate.order.weight) <= maxWeight) && candidate.arrive <= candidate.twEnd && candidate.arrive <= workEnd);
        if (!candidates.length) break;
        candidates.sort((a, b) => candidateScore(a, vehicle, volume) - candidateScore(b, vehicle, volume));
        const selectedCandidate = candidates[0];
        const order = selectedCandidate.order;
        pending.splice(selectedCandidate.index, 1);
        const service = Math.max(1, numeric(order.serviceMin, model.defaultServiceMinutes));
        currentTime = selectedCandidate.arrive;
        const arrive = timeText(currentTime);
        currentTime += service;
        const depart = timeText(currentTime);
        km += selectedCandidate.distance;
        volume += numeric(order.volume);
        weight += numeric(order.weight);
        packages += Math.max(1, numeric(order.count, 1));
        routeStops.push({ ...order, seq: routeStops.length + 1, travelKm: selectedCandidate.distance, travelMin: Math.round(selectedCandidate.distance / model.averageSpeedKmh * 60), arrive, depart });
        current = [order.lon, order.lat];
      }

      if (!routeStops.length) return;
      const back = haversineKm(current, [depot.lon, depot.lat], model.roadDistanceFactor);
      km += back;
      currentTime += Math.round(back / model.averageSpeedKmh * 60);
      const routeId = `${date === "ALL" ? "OPT-ALL" : date || "OPT"}-${String(routes.length + 1).padStart(2, "0")}`;
      const factor = numeric(vehicle.emissionFactor, model.carbonModel.defaultVehicleFactor);
      const fixedCost = numeric(vehicle.fixedCost, model.costModel.fixedVehicleCost);
      const perKmCost = numeric(vehicle.perKmCost, model.costModel.perKm);
      const perStopCost = numeric(vehicle.perStopCost, model.costModel.perStop);
      const regions = new Set(routeStops.map((order) => text(order.region || order.province || order.city)).filter(Boolean));
      const route = {
        date: date === "ALL" ? "OPT-ALL" : date,
        routeId,
        vehicleId: vehicle.vehicleId,
        vehicleName: vehicle.vehicleName || "配送车辆",
        orders: routeStops.length,
        stops: routeStops.length,
        packages,
        weight: Number(weight.toFixed(2)),
        maxWeight: maxWeight || 0,
        volume: Number(volume.toFixed(2)),
        maxVolume,
        km: Number(km.toFixed(1)),
        start: timeText(workStart),
        end: timeText(currentTime),
        status: currentTime <= workEnd ? "OK" : "时间超出",
        weightUtil: maxWeight > 0 ? `${(weight / maxWeight * 100).toFixed(1)}%` : "N/A",
        volumeUtil: `${(volume / maxVolume * 100).toFixed(1)}%`,
        estimatedCost: Number((fixedCost + km * perKmCost + routeStops.length * perStopCost).toFixed(2)),
        estimatedCo2: Number((km * factor).toFixed(3)),
        emissionFactor: factor,
        region: regions.size === 1 ? [...regions][0] : regions.size > 1 ? "多个区域" : "",
        color: vehicle.color,
      };
      routes.push(route);
      const coordinates = [[depot.lon, depot.lat], ...routeStops.map((stop) => [stop.lon, stop.lat]), [depot.lon, depot.lat]];
      routeFeatures.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { ...route } });
      routeStops.forEach((stop) => stopFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [stop.lon, stop.lat] }, properties: { date: route.date, routeId, vehicleId: route.vehicleId, vehicleName: route.vehicleName, seq: stop.seq, orderId: stop.id, code: stop.code || stop.id, name: stop.name || stop.code || stop.id, addr: stop.addr || "", region: stop.region || stop.province || stop.city || "", batch: stop.seq, count: numeric(stop.count, 1), weight: numeric(stop.weight), volume: numeric(stop.volume), serviceMin: numeric(stop.serviceMin, model.defaultServiceMinutes), arrive: stop.arrive, depart: stop.depart, travelKm: Number(stop.travelKm.toFixed(1)), travelMin: stop.travelMin, coordStatus: "OK", cargoCodes: stop.id, color: vehicle.color } }));
    });

    const totalVolume = usableOrders.reduce((sum, order) => sum + numeric(order.volume), 0);
    const totalCapacity = vehicles.reduce((sum, vehicle) => sum + numeric(vehicle.maxVolume), 0);
    const unassigned = pending.map((order) => totalVolume > totalCapacity
      ? reasonRow(order, "total_capacity", "车辆数量或总容积不足", "增加车辆、拆单或调整批次", "unassigned")
      : reasonRow(order, "time_window", "时间窗或车辆班次不可满足", "放宽时间窗或调整车辆班次", "unassigned"));
    return finalizePlan({ raw: selected, goal, batchId, inputHash, model, routes, routeFeatures, stopFeatures, blocked, unassigned, depot, engineError });
  }

  function buildHeuristicPlanFromCanonical(scenario, request = {}, engineError = "") {
    if (!scenario?.canonicalScenario && !scenario?.contractVersion) {
      throw new Error("Demo Heuristic requires a Canonical Scenario.");
    }
    const canonical = scenario.canonicalScenario || scenario;
    const requestedGoal = request.requestedGoal || request.goal || request.objective || "balanced";
    const compareText = window.STCTCanonical.canonicalUtf8Compare;
    const started = performance.now();
    const pending = (canonical.orders || []).map(clone).sort((left, right) => compareText(left.id, right.id));
    const vehicles = (canonical.vehicles || []).filter((vehicle) => vehicle.enabled !== false).map(clone);

    vehicles.sort((left, right) => {
      let difference = 0;
      if (requestedGoal === "vehicles") difference = numeric(right.maxVolume) - numeric(left.maxVolume);
      else if (requestedGoal === "utilization") difference = numeric(left.maxVolume) - numeric(right.maxVolume);
      else if (requestedGoal === "cost") {
        difference = numeric(left.fixedCost) - numeric(right.fixedCost)
          || numeric(left.perKmCost) - numeric(right.perKmCost)
          || numeric(left.perMinuteCost) - numeric(right.perMinuteCost)
          || numeric(left.perStopCost) - numeric(right.perStopCost);
      } else if (requestedGoal === "carbon") difference = numeric(left.emissionFactor) - numeric(right.emissionFactor);
      return difference || compareText(left.id, right.id);
    });

    const routes = [];
    vehicles.forEach((vehicle) => {
      if (!pending.length) return;
      const routeId = `HEURISTIC-${String(routes.length + 1).padStart(2, "0")}`;
      const color = vehicle.color || colorAt(routes.length);
      const orderIds = [];

      while (pending.length) {
        const candidates = [];
        pending.forEach((order, index) => {
          const candidateIds = [...orderIds, order.id];
          const result = window.STCTVerifier.recomputeRoute({ routeId, vehicleId: vehicle.id, color }, candidateIds, scenario);
          if (!result.route || result.violations.length) return;
          const route = result.route;
          const priority = numeric(order.priorityWeight, 1);
          let businessScore = route.roadMeters;
          if (requestedGoal === "vehicles") businessScore = -route.effectiveUtilization;
          else if (requestedGoal === "utilization") businessScore = -route.effectiveUtilization;
          else if (requestedGoal === "cost") businessScore = route.estimatedCost;
          else if (requestedGoal === "carbon") businessScore = route.estimatedCo2;
          else if (requestedGoal === "balanced" || requestedGoal === "balanced_seed") {
            businessScore = route.roadMeters / 1000 + route.estimatedCost * 0.15 + route.estimatedCo2 * 2 - route.effectiveUtilization * 0.08;
          }
          candidates.push({ index, order, candidateIds, route, priority, businessScore });
        });
        if (!candidates.length) break;
        candidates.sort((left, right) => (
          right.priority - left.priority
          || left.businessScore - right.businessScore
          || left.route.returnMinutes - right.route.returnMinutes
          || compareText(left.order.id, right.order.id)
        ));
        const selected = candidates[0];
        orderIds.push(selected.order.id);
        pending.splice(selected.index, 1);
      }

      if (orderIds.length) routes.push({ routeId, vehicleId: vehicle.id, orderIds, color });
    });

    const unassignedOrders = pending.map((order) => reasonRow(
      order,
      "time_window",
      "当前车辆容量、班次或时间窗组合不可满足",
      "调整车辆、班次、时间窗或拆分规划批次",
      "unassigned",
    ));
    const skeleton = {
      engine: "Demo Heuristic",
      depot: clone(canonical.depot),
      routes,
      unassignedOrderIds: unassignedOrders.map((order) => order.id),
      blockedOrderIds: [],
      unassignedOrders,
      blockedOrders: [],
      missingStops: clone(unassignedOrders),
      splitRows: [],
      meta: {},
    };
    const rebuilt = window.STCTVerifier.recomputePlan(skeleton, scenario);
    if (rebuilt.violations.length) {
      const error = new Error(`Demo Heuristic generated an infeasible plan: ${rebuilt.violations[0].code}`);
      error.code = "HEURISTIC_VERIFIER_REJECTED";
      throw error;
    }
    const plan = rebuilt.plan;
    plan.engine = "Demo Heuristic";
    plan.meta = {
      ...(plan.meta || {}),
      engine: "Demo Heuristic",
      engineVersion: "demo-heuristic-v1.4",
      requestedGoal,
      requestedObjective: request.objective || requestedGoal,
      solveStats: { status: "HEURISTIC_FEASIBLE", solveMs: Math.round(performance.now() - started) },
      fallbackForced: Boolean(config().forceHeuristic),
      fallbackLimitations: [
        "Deterministic local heuristic; no optimality claim.",
        "Uses the same Canonical Scenario and verifier as OR-Tools candidates.",
      ],
      engineError: engineError || "OR-Tools unavailable",
    };
    plan.solverStatus = "HEURISTIC_FEASIBLE";
    return plan;
  }

  function emptyPlan(selected, goal, batchId, inputHash, blocked, unassigned, model, engineError) {
    return finalizePlan({ raw: selected, goal, batchId, inputHash, model, routes: [], routeFeatures: [], stopFeatures: [], blocked, unassigned, depot: selected.depot, engineError });
  }

  function finalizePlan({ raw, goal, batchId, inputHash, model, routes, routeFeatures, stopFeatures, blocked, unassigned, depot, engineError }) {
    const input = (raw.orders || []).length;
    const assigned = stopFeatures.length;
    const conservation = { input, assigned, unassigned: unassigned.length, blocked: blocked.length };
    conservation.balanced = input === assigned + unassigned.length + blocked.length;
    const routeFingerprint = fingerprint(routes.map((route) => ({ vehicleId: route.vehicleId, orders: stopFeatures.filter((feature) => feature.properties.routeId === route.routeId).map((feature) => feature.properties.orderId) })));
    const latest = routes.map((route) => ({ label: route.end, value: timeToMinutes(route.end, 0) })).sort((a, b) => a.value - b.value).at(-1)?.label || "-";
    const plan = {
      engine: "Demo Heuristic",
      depot,
      routes,
      daySummaries: [{ date: raw.date || "ALL", vehicles: routes.length, routes: routes.length, orders: assigned, destinations: assigned, stops: assigned, packages: routes.reduce((sum, route) => sum + numeric(route.packages), 0), volume: routes.reduce((sum, route) => sum + numeric(route.volume), 0), km: Number(routes.reduce((sum, route) => sum + numeric(route.km), 0).toFixed(1)), latestEnd: latest, status: unassigned.length || blocked.length ? "需人工确认" : "OK" }],
      routeGeoJson: { type: "FeatureCollection", features: routeFeatures },
      stopGeoJson: { type: "FeatureCollection", features: stopFeatures },
      missingStops: [...blocked, ...unassigned],
      unassignedOrders: unassigned,
      blockedOrders: blocked,
      splitRows: [],
      conservation,
      fingerprint: routeFingerprint,
      meta: { version: "v1.4-trust-closure-mission-control", source: "Browser Demo Heuristic", engine: "Demo Heuristic", goal, goalLabel: GOALS.find((item) => item.id === goal)?.label, goalDefinition: GOALS.find((item) => item.id === goal)?.definition, batchId, inputFingerprint: inputHash, planFingerprint: routeFingerprint, generatedAt: new Date().toISOString(), ...model, equivalenceExplanation: [], engineError: engineError || "" },
    };
    plan.metrics = planMetrics(plan);
    if (goal === "carbon" && new Set((raw.vehicles || []).map((vehicle) => numeric(vehicle.emissionFactor, model.carbonModel.defaultVehicleFactor))).size <= 1) plan.meta.equivalenceExplanation.push("所有车辆使用相同排放因子，最低碳排与最短距离在当前假设下可能等价。");
    if (goal === "cost" && new Set((raw.vehicles || []).map((vehicle) => numeric(vehicle.perKmCost, model.costModel.perKm))).size <= 1) plan.meta.equivalenceExplanation.push("所有车辆使用相同单位里程成本，固定车辆成本仍会影响方案。");
    return plan;
  }

  async function optimize({ raw, date, goal, limit, batchId, inputHash }) {
    const maxOrders = numeric(config().maxOptimizerOrders, 500);
    const selectedCount = filteredInput(raw, date, "ALL").orders.length;
    if (limit === "ALL" && selectedCount > maxOrders) throw new Error(`全部订单共 ${selectedCount} 单，超过本地 Demo 上限 ${maxOrders}。请选择 60、120 或 240 单。`);
    const health = await healthCheck();
    if (health.available) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), (numeric(config().maxSolveSeconds, 45) + 5) * 1000);
      try {
        const response = await fetch(config().optimizerApiUrl || "http://127.0.0.1:8787/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildRequest({ raw, date, goal, limit, timeLimitSeconds: solveTimeLimit(limit), batchId, inputFingerprint: inputHash })),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || `优化服务返回 HTTP ${response.status}`);
        return normalizeResponse(body);
      } catch (error) {
        const message = error.name === "AbortError" ? "OR-Tools 请求超时" : error.message;
        return heuristicPlan(raw, date, goal, limit, batchId, inputHash, message);
      } finally {
        clearTimeout(timeout);
      }
    }
    return heuristicPlan(raw, date, goal, limit, batchId, inputHash, health.error || health.status || "OR-Tools 不可用");
  }

  async function generateScenarios(options = {}) {
    if (planning.generating) throw new Error("方案正在生成，请勿重复提交。");
    const core = window.STCTCore;
    const raw = options.raw || planning.raw || core?.getRawData?.() || window.RAW_DATA;
    if (!raw) throw new Error("请先在数据中心应用原始数据批次。");
    const date = options.date || document.getElementById("optimizerDate")?.value || "ALL";
    const limit = options.limit || document.getElementById("optimizerLimit")?.value || "60";
    const inputHash = inputFingerprint(raw, date, limit);
    planning.generating = true;
    planning.progress = "准备规划输入";
    planning.phase = "generating";
    planning.inputFingerprint = inputHash;
    planning.candidates = [];
    planning.selectedScenarioId = null;
    planning.staleReason = "";
    emitState();
    try {
      for (let index = 0; index < GOALS.length; index += 1) {
        const goal = GOALS[index];
        planning.progress = `${index + 1}/6 ${goal.label}`;
        emitState();
        const plan = await optimize({ raw, date, goal: goal.id, limit, batchId: planning.batchId, inputHash });
        const duplicate = planning.candidates.find((candidate) => candidate.fingerprint === plan.fingerprint);
        plan.scenarioId = goal.id;
        plan.scenarioName = goal.label;
        plan.metrics = planMetrics(plan);
        plan.meta = { ...(plan.meta || {}), goal: goal.id, goalLabel: goal.label, goalDefinition: goal.definition, batchId: planning.batchId, inputFingerprint: inputHash, equivalentTo: duplicate?.scenarioId || null };
        planning.candidates.push(plan);
      }
      planning.selectedScenarioId = recommend(planning.candidates)?.scenarioId || "balanced";
      planning.phase = "candidates";
      planning.progress = "6/6 已完成";
      return planning.candidates;
    } finally {
      planning.generating = false;
      emitState();
    }
  }

  function recommend(candidates) {
    if (!candidates?.length) return null;
    const metrics = candidates.map((plan) => plan.metrics || planMetrics(plan));
    const ranges = ["vehicles", "totalDistance", "latestEnd", "cost", "co2", "unassigned", "blocked"].reduce((out, key) => {
      const values = metrics.map((metric) => key === "latestEnd" ? timeToMinutes(metric[key], 0) : numeric(metric[key]));
      out[key] = { min: Math.min(...values), max: Math.max(...values) };
      return out;
    }, {});
    const weights = assumptions(planning.raw).balancedWeights;
    return candidates.map((plan, index) => {
      const metric = metrics[index];
      const normalized = (key, value) => ranges[key].max === ranges[key].min ? 0 : (value - ranges[key].min) / (ranges[key].max - ranges[key].min);
      const score = normalized("unassigned", metric.unassigned) * weights.unassigned + normalized("blocked", metric.blocked) * weights.unassigned + normalized("vehicles", metric.vehicles) * weights.vehicles + normalized("totalDistance", metric.totalDistance) * weights.distance + normalized("latestEnd", timeToMinutes(metric.latestEnd, 0)) * weights.latestEnd + normalized("cost", metric.cost) * weights.cost + normalized("co2", metric.co2) * weights.carbon + Math.max(0, (70 - metric.avgVolume) / 70) * weights.lowUtilization;
      return { plan, score };
    }).sort((a, b) => a.score - b.score)[0].plan;
  }

  function selectScenario(id) {
    if (planning.candidates.some((candidate) => candidate.scenarioId === id)) {
      planning.selectedScenarioId = id;
      emitState();
    }
  }

  function currentCandidate() {
    return planning.candidates.find((candidate) => candidate.scenarioId === planning.selectedScenarioId) || planning.candidates[0] || null;
  }

  function applySelected() {
    const plan = currentCandidate();
    if (!plan) throw new Error("请先生成并选择候选方案。");
    const raw = planning.raw || window.STCTCore?.getRawData?.() || window.RAW_DATA;
    const date = document.getElementById("optimizerDate")?.value || "ALL";
    const limit = document.getElementById("optimizerLimit")?.value || "60";
    const currentHash = inputFingerprint(raw, date, limit);
    if (currentHash !== plan.meta?.inputFingerprint) {
      invalidate("日期、订单规模或原始数据已变化，旧候选方案不可应用。");
      throw new Error("候选方案已过期，请重新生成。");
    }
    if (!plan.conservation?.balanced) throw new Error("订单守恒校验失败，已禁止应用该方案。");
    if (!planning.beforeApply) planning.beforeApply = clone(window.STCTCore?.getData?.() || window.DATA || window.FLOWMAP_DATA);
    (window.STCTCore?.applyPlan || window.applyUploadedData)(plan);
    planning.appliedScenarioId = plan.scenarioId;
    planning.phase = "applied";
    emitState();
    return plan;
  }

  function restore() {
    if (!planning.beforeApply) throw new Error("当前没有可恢复的应用前方案。");
    (window.STCTCore?.applyPlan || window.applyUploadedData)(clone(planning.beforeApply));
    planning.appliedScenarioId = null;
    planning.phase = planning.candidates.length ? "candidates" : planning.raw ? "raw-awaiting-plan" : "builtin";
    emitState();
  }

  function explainUnassigned(order) {
    const category = text(order?.reasonCategory);
    if (category.includes("coordinate")) return { reason: "缺坐标", action: "补坐标" };
    if (category.includes("capacity") || category.includes("volume") || category.includes("weight")) return { reason: "容量不足", action: order?.suggestion || "拆单或增加车辆" };
    if (category.includes("time")) return { reason: "时间窗不可满足", action: order?.suggestion || "放宽时间窗" };
    if (category.includes("duplicate")) return { reason: "订单重复", action: "修正订单 ID" };
    return { reason: order?.reason || "未分配", action: order?.suggestion || "人工复核" };
  }

  window.STCTPlanning = { state: planning, snapshot, setRawData, markPreview, invalidate, selectScenario, currentCandidate, applySelected, restore, inputFingerprint, recommend };
  window.STCTOptimizer = { GOALS, buildRequest, normalizeResponse, healthCheck, heuristicPlan, buildHeuristicPlanFromCanonical, optimize, generateScenarios, planMetrics, routeCost, explainUnassigned, fingerprint, assumptions, recommend };
})();
