(function () {
  "use strict";

  const text = (value, fallback = "") => String(value ?? fallback).trim();
  const numeric = (value, fallback = 0) => {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const parsed = Number(String(value).replace(/,/g, "").replace(/%$/, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const clone = (value) => window.STCTUtils?.clone
    ? window.STCTUtils.clone(value)
    : JSON.parse(JSON.stringify(value));
  const orderId = (row) => text(row?._scenarioOrderKey || row?.id || row?.orderId || row?.code);
  const vehicleId = (row) => text(row?.vehicleId || row?.id || row?.code);
  const round = (value, digits = 3) => Number(numeric(value).toFixed(digits));

  function contract() {
    return window.STCTCanonical.getContract();
  }

  function scenarioModel(scenario) {
    const current = contract();
    const assumptions = scenario?.assumptions || scenario?.assumptionsSnapshot || {};
    const constraints = scenario?.constraints || scenario?.constraintsSnapshot || {};
    return {
      roadDistanceFactor: numeric(assumptions.roadDistanceFactor ?? constraints.roadDistanceFactor, 1.35),
      averageSpeedKmh: numeric(assumptions.averageSpeedKmh ?? constraints.averageSpeedKmh, 28),
      defaultServiceMin: numeric(assumptions.defaultServiceMin ?? assumptions.defaultServiceMinutes ?? constraints.defaultServiceMinutes, 5),
      maxWaitingMinutes: numeric(constraints.maxWaitingMinutes, current.time.maxWaitingMinutes),
      shiftExtensionMinutes: numeric(constraints.shiftExtensionMinutes, 0),
      maxRouteMinutes: numeric(constraints.maxRouteMinutes, 48 * 60),
      capacityScale: numeric(constraints.capacityScale, current.capacity.volumeScale),
      weightScale: numeric(constraints.weightScale, current.capacity.weightScale),
      lowUtilizationThreshold: numeric(assumptions.lowUtilizationThreshold, current.utilization.lowRouteThresholdPercent),
      defaultEmissionFactor: numeric(assumptions.defaultEmissionFactor, current.models.defaultEmissionFactor),
      balancedWeights: {
        usedVehicles: numeric(assumptions.balancedWeightUsedVehicles, current.balancedPoolWeights.usedVehicles),
        estimatedRoadKm: numeric(assumptions.balancedWeightDistance, current.balancedPoolWeights.estimatedRoadKm),
        totalCost: numeric(assumptions.balancedWeightCost, current.balancedPoolWeights.totalCost),
        totalCO2: numeric(assumptions.balancedWeightCarbon, current.balancedPoolWeights.totalCO2),
        latestEnd: numeric(assumptions.balancedWeightLatestEnd, current.balancedPoolWeights.latestEnd),
        utilizationScore: numeric(assumptions.balancedWeightUtilization, current.balancedPoolWeights.utilizationScore),
      },
      tolerance: current.tolerances,
    };
  }

  function normalizeCoord(row) {
    const lon = numeric(row?.lon, NaN);
    const lat = numeric(row?.lat, NaN);
    return { lon, lat, valid: Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 };
  }

  function haversineMeters(a, b) {
    const radius = 6371000;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const deltaLat = (b[1] - a[1]) * Math.PI / 180;
    const deltaLon = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function roadMeters(a, b, factor) {
    return Math.floor(haversineMeters(a, b) * factor + 0.5);
  }

  function haversineKm(a, b, factor = 1) {
    return roadMeters(a, b, factor) / 1000;
  }

  function travelMinutes(meters, speedKmh) {
    return Math.ceil(meters / 1000 / Math.max(1, speedKmh) * 60);
  }

  function timeToMinutes(value, fallback = null) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
    if (!match) return fallback;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : fallback;
  }

  function overnightEnd(start, end) {
    return end < start ? end + 1440 : end;
  }

  function timeText(value) {
    let total = Math.max(0, Math.round(numeric(value)));
    const prefix = total >= 1440 ? "次日 " : "";
    total %= 1440;
    return `${prefix}${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function scaled(value, scale, field) {
    const digits = Math.round(Math.log10(scale));
    if (10 ** digits !== scale) throw new Error(`Unsupported scale for ${field}: ${scale}`);
    return Number(window.STCTCanonical.decimal(value, digits, field).replace(".", ""));
  }

  function routeOrderIds(route, sourcePlan) {
    if (Array.isArray(route?.orderIds)) return route.orderIds.map((id) => text(id));
    const features = (sourcePlan?.stopGeoJson?.features || [])
      .filter((feature) => text(feature.properties?.routeId) === text(route?.routeId))
      .sort((left, right) => numeric(left.properties?.seq) - numeric(right.properties?.seq));
    return features.map((feature) => text(feature.properties?.orderId || feature.properties?.code));
  }

  function lookupMaps(scenario) {
    return {
      orders: new Map((scenario?.orders || []).map((order) => [orderId(order), order])),
      vehicles: new Map((scenario?.vehicles || []).map((vehicle) => [vehicleId(vehicle), vehicle])),
    };
  }

  function normalizedWindow(order, shiftStart) {
    let start = timeToMinutes(order.twStart, NaN);
    let end = timeToMinutes(order.twEnd, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { valid: false, start, end };
    end = overnightEnd(start, end);
    while (end < shiftStart) {
      start += 1440;
      end += 1440;
    }
    return { valid: true, start, end };
  }

  function utilizationMetrics(routes, scenario) {
    const current = contract();
    const threshold = scenarioModel(scenario).lowUtilizationThreshold;
    const effective = routes.map((route) => numeric(route.effectiveUtilization));
    const totalVolume = routes.reduce((sum, route) => sum + numeric(route.volume), 0);
    const volumeCapacity = routes.reduce((sum, route) => sum + numeric(route.maxVolume), 0);
    const totalWeight = routes.reduce((sum, route) => sum + numeric(route.weight), 0);
    const weightCapacity = routes.reduce((sum, route) => sum + numeric(route.maxWeight), 0);
    const volumeFleet = volumeCapacity > 0 ? totalVolume / volumeCapacity * 100 : 0;
    const weightFleet = weightCapacity > 0 ? totalWeight / weightCapacity * 100 : 0;
    const fleetUtilization = Math.max(volumeFleet, weightFleet);
    const averageEffective = effective.length ? effective.reduce((sum, value) => sum + value, 0) / effective.length : 0;
    const minimumRoute = effective.length ? Math.min(...effective) : 0;
    const variance = effective.length ? effective.reduce((sum, value) => sum + (value - averageEffective) ** 2, 0) / effective.length : 0;
    const standardDeviation = Math.sqrt(variance);
    const lowRouteShare = effective.length ? effective.filter((value) => value < threshold).length / effective.length * 100 : 0;
    const weights = current.utilization.scoreWeights;
    const utilizationScore = (
      Math.min(100, fleetUtilization) * weights.fleetUtilization
      + Math.min(100, averageEffective) * weights.averageEffective
      + Math.min(100, minimumRoute) * weights.minimumRoute
      + Math.max(0, 100 - standardDeviation) * weights.stability
      + Math.max(0, 100 - lowRouteShare) * weights.lowRouteShare
    ) / 100;
    return {
      fleetVolumeUtilization: round(volumeFleet, 1),
      fleetWeightUtilization: round(weightFleet, 1),
      fleetUtilization: round(fleetUtilization, 1),
      averageRouteUtilization: round(averageEffective, 1),
      minimumRouteUtilization: round(minimumRoute, 1),
      utilizationStdDev: round(standardDeviation, 1),
      lowUtilizationRouteShare: round(lowRouteShare, 1),
      utilizationScore: round(utilizationScore, 1),
    };
  }

  function deterministicRouteSchedule(ids, vehicle, scenario, maps, model, depot) {
    const shiftStart = timeToMinutes(vehicle.start, timeToMinutes(scenario?.constraints?.workStart || scenario?.constraintsSnapshot?.workStart, 9 * 60));
    const intervals = [{ earliest: shiftStart, latest: shiftStart }];
    const legs = [{ travel: 0, serviceBefore: 0 }];
    let previous = [depot.lon, depot.lat];
    let previousService = 0;
    for (const id of ids) {
      const order = maps.orders.get(id);
      const coord = normalizeCoord(order);
      const timeWindow = order ? normalizedWindow(order, shiftStart) : { valid: false };
      if (!order || !coord.valid || !timeWindow.valid) return null;
      const meters = roadMeters(previous, [coord.lon, coord.lat], model.roadDistanceFactor);
      const travel = travelMinutes(meters, model.averageSpeedKmh);
      const transit = previousService + travel;
      const prior = intervals[intervals.length - 1];
      const earliest = Math.max(timeWindow.start, prior.earliest + transit);
      const latest = Math.min(timeWindow.end, prior.latest + transit + model.maxWaitingMinutes);
      if (earliest > latest) return null;
      intervals.push({ earliest, latest });
      legs.push({ travel, serviceBefore: previousService });
      previous = [coord.lon, coord.lat];
      previousService = Math.max(0, Number(window.STCTCanonical.decimal(order.serviceMin ?? model.defaultServiceMin, 0, `order.${id}.serviceMin`)));
    }
    const starts = Array(intervals.length).fill(0);
    starts[starts.length - 1] = intervals[intervals.length - 1].earliest;
    for (let index = intervals.length - 2; index >= 0; index -= 1) {
      const transit = legs[index + 1].travel + legs[index + 1].serviceBefore;
      const lower = Math.max(intervals[index].earliest, starts[index + 1] - transit - model.maxWaitingMinutes);
      const upper = Math.min(intervals[index].latest, starts[index + 1] - transit);
      if (lower > upper) return null;
      starts[index] = lower;
    }
    return ids.map((id, index) => {
      const transit = legs[index + 1].travel + legs[index + 1].serviceBefore;
      const rawArrival = starts[index] + transit;
      const serviceStart = starts[index + 1];
      const order = maps.orders.get(id);
      const serviceMin = Math.max(0, Number(window.STCTCanonical.decimal(order.serviceMin ?? model.defaultServiceMin, 0, `order.${id}.serviceMin`)));
      return { rawArrival, waiting: serviceStart - rawArrival, serviceStart, departure: serviceStart + serviceMin };
    });
  }

  function recomputeRoute(route, orderIdsOrStops, scenario) {
    const model = scenarioModel(scenario);
    const maps = lookupMaps(scenario);
    const depot = normalizeCoord(scenario?.depot);
    const vehicle = maps.vehicles.get(text(route?.vehicleId));
    const violations = [];
    if (!vehicle) return { route: null, stops: [], violations: [{ code: "UNKNOWN_VEHICLE_ID", routeId: route?.routeId, vehicleId: route?.vehicleId }] };
    const ids = (orderIdsOrStops || []).map((row) => typeof row === "string" ? text(row) : text(row?.properties?.orderId || row?.orderId || row?.id));
    const shiftStart = timeToMinutes(vehicle.start, timeToMinutes(scenario?.constraints?.workStart || scenario?.constraintsSnapshot?.workStart, 9 * 60));
    const shiftEndBase = timeToMinutes(vehicle.end, timeToMinutes(scenario?.constraints?.workEnd || scenario?.constraintsSnapshot?.workEnd, 17 * 60 + 30));
    const shiftEnd = overnightEnd(shiftStart, shiftEndBase) + model.shiftExtensionMinutes;
    let previous = [depot.lon, depot.lat];
    let departure = shiftStart;
    let totalMeters = 0;
    let drivingMinutes = 0;
    let volumeScaled = 0;
    let weightScaled = 0;
    let packages = 0;
    const stops = [];
    const coordinates = [[depot.lon, depot.lat]];
    const schedule = deterministicRouteSchedule(ids, vehicle, scenario, maps, model, depot);

    ids.forEach((id, index) => {
      const order = maps.orders.get(id);
      if (!order) {
        violations.push({ code: "UNKNOWN_ORDER_ID", routeId: route.routeId, orderId: id });
        return;
      }
      const coord = normalizeCoord(order);
      if (!coord.valid) {
        violations.push({ code: "INVALID_ORDER_COORDINATE", routeId: route.routeId, orderId: id });
        return;
      }
      const meters = roadMeters(previous, [coord.lon, coord.lat], model.roadDistanceFactor);
      const travel = travelMinutes(meters, model.averageSpeedKmh);
      const rawArrival = schedule?.[index]?.rawArrival ?? departure + travel;
      const timeWindow = normalizedWindow(order, shiftStart);
      if (!timeWindow.valid) {
        violations.push({ code: "OVERNIGHT_NORMALIZATION_ERROR", routeId: route.routeId, orderId: id });
        return;
      }
      const waiting = schedule?.[index]?.waiting ?? Math.max(0, timeWindow.start - rawArrival);
      const serviceStart = schedule?.[index]?.serviceStart ?? rawArrival + waiting;
      const serviceMin = Math.max(0, Number(window.STCTCanonical.decimal(order.serviceMin ?? model.defaultServiceMin, 0, `order.${id}.serviceMin`)));
      const stopDeparture = schedule?.[index]?.departure ?? serviceStart + serviceMin;
      if (waiting > model.maxWaitingMinutes) violations.push({ code: "MAX_WAIT_EXCEEDED", routeId: route.routeId, orderId: id, waitingMinutes: waiting, maximum: model.maxWaitingMinutes });
      if (serviceStart > timeWindow.end) violations.push({ code: "TIME_WINDOW_VIOLATION", routeId: route.routeId, orderId: id, serviceStart, windowEnd: timeWindow.end });
      totalMeters += meters;
      drivingMinutes += travel;
      volumeScaled += scaled(order.volume, model.capacityScale, `order.${id}.volume`);
      weightScaled += scaled(order.weight, model.weightScale, `order.${id}.weight`);
      packages += Math.max(0, numeric(order.count));
      coordinates.push([coord.lon, coord.lat]);
      stops.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [coord.lon, coord.lat] },
        properties: {
          routeId: text(route.routeId),
          vehicleId: vehicleId(vehicle),
          orderId: id,
          code: order.code,
          name: order.name,
          addr: order.address,
          seq: index + 1,
          count: numeric(order.count),
          volume: numeric(order.volume),
          weight: numeric(order.weight),
          priority: order.priority,
          priorityWeight: numeric(order.priorityWeight),
          serviceMin,
          travelMeters: meters,
          travelKm: round(meters / 1000, 3),
          travelMin: travel,
          rawArrivalMinutes: rawArrival,
          waitingMinutes: waiting,
          serviceStartMinutes: serviceStart,
          departureMinutes: stopDeparture,
          arrive: timeText(serviceStart),
          depart: timeText(stopDeparture),
          color: route.color,
        },
      });
      previous = [coord.lon, coord.lat];
      departure = stopDeparture;
    });

    const returnMeters = roadMeters(previous, [depot.lon, depot.lat], model.roadDistanceFactor);
    const returnTravel = travelMinutes(returnMeters, model.averageSpeedKmh);
    totalMeters += returnMeters;
    drivingMinutes += returnTravel;
    const returnMinutes = departure + returnTravel;
    coordinates.push([depot.lon, depot.lat]);
    const maxVolumeScaled = scaled(vehicle.maxVolume, model.capacityScale, `vehicle.${vehicleId(vehicle)}.maxVolume`);
    const maxWeightScaled = scaled(vehicle.maxWeight, model.weightScale, `vehicle.${vehicleId(vehicle)}.maxWeight`);
    if (volumeScaled > maxVolumeScaled) violations.push({ code: "ROUTE_VOLUME_CAPACITY_EXCEEDED", routeId: route.routeId, actualScaled: volumeScaled, capacityScaled: maxVolumeScaled });
    if (weightScaled > maxWeightScaled) violations.push({ code: "ROUTE_WEIGHT_CAPACITY_EXCEEDED", routeId: route.routeId, actualScaled: weightScaled, capacityScaled: maxWeightScaled });
    if (returnMinutes > shiftEnd) violations.push({ code: "SHIFT_END_VIOLATION", routeId: route.routeId, returnMinutes, shiftEnd });
    if (returnMinutes - shiftStart > model.maxRouteMinutes) violations.push({ code: "MAX_ROUTE_MINUTES_EXCEEDED", routeId: route.routeId, routeMinutes: returnMinutes - shiftStart, maximum: model.maxRouteMinutes });

    const volume = volumeScaled / model.capacityScale;
    const weight = weightScaled / model.weightScale;
    const maxVolume = maxVolumeScaled / model.capacityScale;
    const maxWeight = maxWeightScaled / model.weightScale;
    const volumeUtilization = maxVolume > 0 ? volume / maxVolume * 100 : 0;
    const weightUtilization = maxWeight > 0 ? weight / maxWeight * 100 : 0;
    const fixedCost = numeric(vehicle.fixedCost);
    const kmCost = totalMeters / 1000 * numeric(vehicle.perKmCost);
    const timeCost = drivingMinutes * numeric(vehicle.perMinuteCost);
    const stopCost = ids.length * numeric(vehicle.perStopCost);
    const totalCost = fixedCost + kmCost + timeCost + stopCost;
    const emissionFactor = numeric(vehicle.emissionFactor, model.defaultEmissionFactor);
    const totalCO2 = totalMeters / 1000 * emissionFactor;
    const rebuilt = {
      routeId: text(route.routeId),
      vehicleId: vehicleId(vehicle),
      vehicleName: vehicle.name || vehicle.vehicleName,
      orderIds: ids,
      orders: ids.length,
      stops: ids.length,
      packages,
      volume: round(volume, 3),
      weight: round(weight, 3),
      maxVolume: round(maxVolume, 3),
      maxWeight: round(maxWeight, 3),
      volumeUtilization: round(volumeUtilization, 3),
      weightUtilization: round(weightUtilization, 3),
      effectiveUtilization: round(Math.max(volumeUtilization, weightUtilization), 3),
      volumeUtil: `${round(volumeUtilization, 1)}%`,
      weightUtil: `${round(weightUtilization, 1)}%`,
      roadMeters: totalMeters,
      km: round(totalMeters / 1000, 3),
      drivingMinutes,
      startMinutes: shiftStart,
      returnMinutes,
      start: timeText(shiftStart),
      end: timeText(returnMinutes),
      fixedCost: round(fixedCost, 4),
      kmCost: round(kmCost, 4),
      timeCost: round(timeCost, 4),
      stopCost: round(stopCost, 4),
      estimatedCost: round(totalCost, 4),
      emissionFactor: round(emissionFactor, 6),
      estimatedCo2: round(totalCO2, 6),
      color: route.color,
    };
    return {
      route: rebuilt,
      stops,
      routeFeature: { type: "Feature", geometry: { type: "LineString", coordinates }, properties: clone(rebuilt) },
      violations,
    };
  }

  function listIds(rows) {
    return (rows || []).map((row) => typeof row === "string" ? text(row) : orderId(row)).filter(Boolean);
  }

  function recomputePlan(sourcePlan, scenario) {
    const violations = [];
    const routes = [];
    const routeFeatures = [];
    const stopFeatures = [];
    (sourcePlan?.routes || []).forEach((route) => {
      const ids = routeOrderIds(route, sourcePlan);
      const rebuilt = recomputeRoute(route, ids, scenario);
      if (rebuilt.route) routes.push(rebuilt.route);
      if (rebuilt.routeFeature) routeFeatures.push(rebuilt.routeFeature);
      stopFeatures.push(...rebuilt.stops);
      violations.push(...rebuilt.violations);
    });
    const assignedIds = routes.flatMap((route) => route.orderIds);
    const unassignedIds = sourcePlan?.unassignedOrderIds?.length ? listIds(sourcePlan.unassignedOrderIds) : listIds(sourcePlan?.unassignedOrders);
    const blockedIds = sourcePlan?.blockedOrderIds?.length ? listIds(sourcePlan.blockedOrderIds) : listIds(sourcePlan?.blockedOrders);
    const sourceById = new Map([...(sourcePlan?.unassignedOrders || []), ...(sourcePlan?.blockedOrders || [])].map((row) => [orderId(row), row]));
    const orderMap = lookupMaps(scenario).orders;
    const unassignedOrders = unassignedIds.map((id) => ({ ...clone(orderMap.get(id) || {}), ...clone(sourceById.get(id) || {}), id }));
    const blockedOrders = blockedIds.map((id) => ({ ...clone(orderMap.get(id) || {}), ...clone(sourceById.get(id) || {}), id }));
    const latestEndMinutes = routes.length ? Math.max(...routes.map((route) => route.returnMinutes)) : 0;
    const utilization = utilizationMetrics(routes, scenario);
    const isBaseCandidate = numeric(sourcePlan?.manualRevision, 0) === 0
      && !text(sourcePlan?.parentPlanHash || sourcePlan?.basePlanHash);
    const metrics = {
      assigned: assignedIds.length,
      unassigned: unassignedIds.length,
      blocked: blockedIds.length,
      servicePriorityScore: assignedIds.reduce((sum, id) => sum + numeric(orderMap.get(id)?.priorityWeight, 1), 0),
      usedVehicles: routes.length,
      vehicles: routes.length,
      routes: routes.length,
      orders: assignedIds.length,
      stops: assignedIds.length,
      packages: routes.reduce((sum, route) => sum + numeric(route.packages), 0),
      roadMeters: routes.reduce((sum, route) => sum + numeric(route.roadMeters), 0),
      estimatedRoadKm: round(routes.reduce((sum, route) => sum + numeric(route.roadMeters), 0) / 1000, 3),
      totalDistance: round(routes.reduce((sum, route) => sum + numeric(route.roadMeters), 0) / 1000, 3),
      latestEndMinutes,
      latestEnd: latestEndMinutes ? timeText(latestEndMinutes) : "-",
      totalCost: round(routes.reduce((sum, route) => sum + numeric(route.estimatedCost), 0), 4),
      cost: round(routes.reduce((sum, route) => sum + numeric(route.estimatedCost), 0), 4),
      totalCO2: round(routes.reduce((sum, route) => sum + numeric(route.estimatedCo2), 0), 6),
      co2: round(routes.reduce((sum, route) => sum + numeric(route.estimatedCo2), 0), 6),
      serviceRate: scenario?.orders?.length ? round(assignedIds.length / scenario.orders.length * 100, 1) : 0,
      ...(isBaseCandidate ? { changeCount: 0 } : {}),
      ...utilization,
    };
    const conservation = {
      input: scenario?.orders?.length || 0,
      assigned: assignedIds.length,
      unassigned: unassignedIds.length,
      blocked: blockedIds.length,
    };
    conservation.balanced = conservation.input === conservation.assigned + conservation.unassigned + conservation.blocked;
    const plan = {
      ...clone(sourcePlan || {}),
      routes,
      routeGeoJson: { type: "FeatureCollection", features: routeFeatures },
      stopGeoJson: { type: "FeatureCollection", features: stopFeatures },
      unassignedOrderIds: unassignedIds,
      blockedOrderIds: blockedIds,
      unassignedOrders,
      blockedOrders,
      missingStops: [...blockedOrders, ...unassignedOrders],
      splitRows: Array.isArray(sourcePlan?.splitRows) ? clone(sourcePlan.splitRows) : [],
      metrics,
      conservation,
      daySummaries: [{
        date: scenario?.planningDate,
        vehicles: routes.length,
        routes: routes.length,
        orders: assignedIds.length,
        stops: assignedIds.length,
        packages: metrics.packages,
        km: metrics.estimatedRoadKm,
        latestEnd: metrics.latestEnd,
        avgVolumeUtil: `${metrics.averageRouteUtilization}%`,
        avgWeightUtil: `${metrics.fleetWeightUtilization}%`,
      }],
    };
    return { plan, violations };
  }

  function mismatch(metric, reported, recomputed, tolerance) {
    if (reported === undefined || reported === null || reported === "") return null;
    return Math.abs(numeric(reported) - numeric(recomputed)) > tolerance
      ? { code: "METRIC_MISMATCH", metric, reported, recomputed, tolerance }
      : null;
  }

  function cacheChecks(sourcePlan, scenario, hard, warnings) {
    const orderMap = lookupMaps(scenario).orders;
    const vehicleMap = lookupMaps(scenario).vehicles;
    const tolerance = scenarioModel(scenario).tolerance.coordinate;
    const routeMap = new Map((sourcePlan?.routes || []).map((route) => [text(route.routeId), route]));
    const sourceStops = sourcePlan?.stopGeoJson?.features || [];
    sourceStops.forEach((feature) => {
      const props = feature.properties || {};
      const route = routeMap.get(text(props.routeId));
      if (!route) hard.push({ code: "STOP_PARENT_ROUTE_MISMATCH", routeId: props.routeId, orderId: props.orderId });
      else if (text(props.vehicleId) !== text(route.vehicleId)) hard.push({ code: "STOP_PARENT_VEHICLE_MISMATCH", routeId: props.routeId, orderId: props.orderId, expected: route.vehicleId, actual: props.vehicleId });
      const order = orderMap.get(text(props.orderId));
      if (!order) return;
      const coordinates = feature.geometry?.coordinates || [];
      if (Math.abs(numeric(coordinates[0], NaN) - numeric(order.lon)) > tolerance || Math.abs(numeric(coordinates[1], NaN) - numeric(order.lat)) > tolerance) {
        hard.push({ code: "STOP_COORDINATE_MISMATCH", routeId: props.routeId, orderId: props.orderId, expected: [numeric(order.lon), numeric(order.lat)], actual: coordinates });
      }
      for (const field of ["count", "volume", "weight", "serviceMin"]) {
        if (props[field] !== undefined && Math.abs(numeric(props[field]) - numeric(order[field])) > 0.000001) {
          hard.push({ code: "STOP_ORDER_FACT_MISMATCH", routeId: props.routeId, orderId: props.orderId, field, expected: order[field], actual: props[field] });
        }
      }
    });
    if (!sourceStops.length) warnings.push({ code: "DISPLAY_STOP_CACHE_ABSENT" });
    else {
      (sourcePlan?.routes || []).forEach((route) => {
        const cached = sourceStops
          .filter((feature) => text(feature.properties?.routeId) === text(route.routeId))
          .sort((left, right) => numeric(left.properties?.seq) - numeric(right.properties?.seq))
          .map((feature) => text(feature.properties?.orderId));
        const authority = Array.isArray(route.orderIds) ? route.orderIds.map((id) => text(id)) : cached;
        if (cached.length !== authority.length || cached.some((id, index) => id !== authority[index])) {
          hard.push({ code: "STOP_ORDER_ID_MISMATCH", routeId: route.routeId, expected: authority, actual: cached });
        }
        const vehicle = vehicleMap.get(text(route.vehicleId));
        if (vehicle) {
          for (const field of ["maxVolume", "maxWeight"]) {
            if (route[field] !== undefined && Math.abs(numeric(route[field]) - numeric(vehicle[field])) > 0.000001) {
              hard.push({ code: "VEHICLE_FACT_MISMATCH", routeId: route.routeId, vehicleId: route.vehicleId, field, expected: vehicle[field], actual: route[field] });
            }
          }
        }
      });
    }
    const depot = normalizeCoord(scenario?.depot);
    if (sourcePlan?.depot) {
      const sourceDepot = normalizeCoord(sourcePlan.depot);
      if (!sourceDepot.valid || Math.abs(sourceDepot.lon - depot.lon) > tolerance || Math.abs(sourceDepot.lat - depot.lat) > tolerance) {
        hard.push({ code: "DEPOT_COORDINATE_MISMATCH", expected: [depot.lon, depot.lat], actual: [sourceDepot.lon, sourceDepot.lat] });
      }
    }
    (sourcePlan?.routeGeoJson?.features || []).forEach((feature) => {
      const route = routeMap.get(text(feature.properties?.routeId));
      if (!route) hard.push({ code: "STOP_PARENT_ROUTE_MISMATCH", routeId: feature.properties?.routeId, scope: "route-cache" });
      else if (feature.properties?.vehicleId !== undefined && text(feature.properties.vehicleId) !== text(route.vehicleId)) hard.push({ code: "STOP_PARENT_VEHICLE_MISMATCH", routeId: feature.properties?.routeId, scope: "route-cache", expected: route.vehicleId, actual: feature.properties.vehicleId });
      const coordinates = feature.geometry?.coordinates || [];
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      const valid = coordinates.length >= 2
        && Math.abs(numeric(first?.[0], NaN) - depot.lon) <= tolerance
        && Math.abs(numeric(first?.[1], NaN) - depot.lat) <= tolerance
        && Math.abs(numeric(last?.[0], NaN) - depot.lon) <= tolerance
        && Math.abs(numeric(last?.[1], NaN) - depot.lat) <= tolerance;
      if (!valid) hard.push({ code: "ROUTE_DEPOT_MISMATCH", routeId: feature.properties?.routeId });
    });
  }

  async function verify(sourcePlan, scenario) {
    const hard = [];
    const warnings = [];
    const metricMismatches = [];
    const model = scenarioModel(scenario);
    const maps = lookupMaps(scenario);
    const routeIds = new Set();
    const vehicleIds = new Set();
    const assigned = [];
    const sourceRoutes = sourcePlan?.routes || [];
    sourceRoutes.forEach((route) => {
      const routeIdValue = text(route.routeId);
      const vehicleIdValue = text(route.vehicleId);
      if (!routeIdValue || routeIds.has(routeIdValue)) hard.push({ code: "DUPLICATE_ROUTE_ID", routeId: routeIdValue });
      routeIds.add(routeIdValue);
      if (!maps.vehicles.has(vehicleIdValue)) hard.push({ code: "UNKNOWN_VEHICLE_ID", routeId: routeIdValue, vehicleId: vehicleIdValue });
      if (vehicleIds.has(vehicleIdValue)) hard.push({ code: "DUPLICATE_VEHICLE_USE", routeId: routeIdValue, vehicleId: vehicleIdValue });
      vehicleIds.add(vehicleIdValue);
      const vehicle = maps.vehicles.get(vehicleIdValue);
      if (vehicle && (vehicle.enabled === false || (vehicle.availableDate && text(vehicle.availableDate) !== text(scenario.planningDate)))) {
        hard.push({ code: "VEHICLE_NOT_AVAILABLE_ON_DATE", routeId: routeIdValue, vehicleId: vehicleIdValue, planningDate: scenario.planningDate, availableDate: vehicle.availableDate });
      }
      const ids = routeOrderIds(route, sourcePlan);
      const local = new Set();
      ids.forEach((id) => {
        if (local.has(id)) hard.push({ code: "DUPLICATE_ASSIGNED_ORDER", routeId: routeIdValue, orderId: id, scope: "route" });
        local.add(id);
        assigned.push(id);
      });
    });
    const assignedCounts = new Map();
    assigned.forEach((id) => assignedCounts.set(id, (assignedCounts.get(id) || 0) + 1));
    assignedCounts.forEach((count, id) => {
      if (count > 1) hard.push({ code: "DUPLICATE_ASSIGNED_ORDER", orderId: id, count, scope: "plan" });
      if (!maps.orders.has(id)) hard.push({ code: "UNKNOWN_ORDER_ID", orderId: id });
    });
    const unassigned = sourcePlan?.unassignedOrderIds?.length ? listIds(sourcePlan.unassignedOrderIds) : listIds(sourcePlan?.unassignedOrders);
    const blocked = sourcePlan?.blockedOrderIds?.length ? listIds(sourcePlan.blockedOrderIds) : listIds(sourcePlan?.blockedOrders);
    const all = [...assigned, ...unassigned, ...blocked];
    const counts = new Map();
    all.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    counts.forEach((count, id) => {
      if (count > 1) hard.push({ code: "ORDER_SET_CONSERVATION_FAILED", orderId: id, count });
      if (!maps.orders.has(id)) hard.push({ code: "UNKNOWN_ORDER_ID", orderId: id });
    });
    (scenario?.orders || []).forEach((order) => {
      if (!counts.has(orderId(order))) hard.push({ code: "ORDER_SET_CONSERVATION_FAILED", orderId: orderId(order), count: 0 });
    });

    if (text(sourcePlan?.contractVersion || sourcePlan?.meta?.contractVersion) !== text(scenario?.contractVersion)) hard.push({ code: "PLAN_CONTRACT_MISMATCH", expected: scenario?.contractVersion, actual: sourcePlan?.contractVersion || sourcePlan?.meta?.contractVersion });
    if (text(sourcePlan?.inputHash || sourcePlan?.meta?.inputHash) !== text(scenario?.inputHash)) hard.push({ code: "PLAN_INPUT_HASH_MISMATCH", expected: scenario?.inputHash, actual: sourcePlan?.inputHash || sourcePlan?.meta?.inputHash });
    cacheChecks(sourcePlan, scenario, hard, warnings);

    let rebuilt;
    try {
      rebuilt = recomputePlan(sourcePlan, scenario);
      hard.push(...rebuilt.violations);
    } catch (error) {
      hard.push({ code: error.code || "VERIFIER_RECOMPUTE_ERROR", message: error.message });
      rebuilt = { plan: { ...clone(sourcePlan), metrics: {}, conservation: { balanced: false } }, violations: [] };
    }
    if (!rebuilt.plan.conservation?.balanced) hard.push({ code: "ORDER_SET_CONSERVATION_FAILED", ...rebuilt.plan.conservation });

    const reported = sourcePlan?.reportedMetrics || sourcePlan?.metrics || {};
    [
      mismatch("roadMeters", reported.roadMeters, rebuilt.plan.metrics.roadMeters, model.tolerance.distanceMeters),
      mismatch("estimatedRoadKm", reported.estimatedRoadKm ?? reported.totalDistance, rebuilt.plan.metrics.estimatedRoadKm, model.tolerance.distanceMeters / 1000),
      mismatch("totalCost", reported.totalCost ?? reported.cost, rebuilt.plan.metrics.totalCost, model.tolerance.cost),
      mismatch("totalCO2", reported.totalCO2 ?? reported.co2, rebuilt.plan.metrics.totalCO2, model.tolerance.carbon),
      mismatch("usedVehicles", reported.usedVehicles ?? reported.vehicles, rebuilt.plan.metrics.usedVehicles, 0),
      mismatch("assigned", reported.assigned, rebuilt.plan.metrics.assigned, 0),
      mismatch("latestEndMinutes", reported.latestEndMinutes, rebuilt.plan.metrics.latestEndMinutes, model.tolerance.latestEndMinutes),
      mismatch("utilizationScore", reported.utilizationScore, rebuilt.plan.metrics.utilizationScore, model.tolerance.utilizationPercent),
    ].filter(Boolean).forEach((row) => metricMismatches.push(row));

    const authority = {
      routes: sourceRoutes.map((route) => ({ routeId: text(route.routeId), vehicleId: text(route.vehicleId), orderIds: routeOrderIds(route, sourcePlan) })),
      unassignedOrderIds: unassigned,
      blockedOrderIds: blocked,
      manualRevision: numeric(sourcePlan?.manualRevision, 0),
      parentPlanHash: text(sourcePlan?.parentPlanHash || sourcePlan?.basePlanHash),
    };
    let computedPlanHash = "";
    try {
      computedPlanHash = (await window.STCTCanonical.planIdentity(scenario.inputHash, authority)).planHash;
      if (text(sourcePlan?.planHash || sourcePlan?.meta?.planHash) !== computedPlanHash) hard.push({ code: "PLAN_HASH_MISMATCH", expected: computedPlanHash, actual: sourcePlan?.planHash || sourcePlan?.meta?.planHash });
    } catch (error) {
      hard.push({ code: error.code || "PLAN_HASH_ERROR", message: error.message });
    }

    const status = hard.length || metricMismatches.length ? "FAIL" : "PASS";
    rebuilt.plan.contractVersion = scenario.contractVersion;
    rebuilt.plan.canonicalVersion = scenario.canonicalVersion;
    rebuilt.plan.contentHash = scenario.contentHash;
    rebuilt.plan.inputHash = scenario.inputHash;
    rebuilt.plan.requestHash = sourcePlan.requestHash || sourcePlan.meta?.requestHash;
    rebuilt.plan.planHash = computedPlanHash;
    rebuilt.plan.serverHashVerified = sourcePlan.serverHashVerified === true;
    rebuilt.plan.reportedMetrics = clone(reported);
    return {
      status,
      hardViolationCount: hard.length,
      warningCount: warnings.length,
      metricMismatchCount: metricMismatches.length,
      violations: hard,
      hardViolations: hard,
      warnings,
      metricMismatches,
      recomputedMetrics: rebuilt.plan.metrics,
      reportedMetrics: clone(reported),
      recomputedPlan: rebuilt.plan,
      computedPlanHash,
      tolerance: clone(model.tolerance),
      contractVersion: scenario.contractVersion,
      inputHash: scenario.inputHash,
    };
  }

  function normalizeScore(value, values, lowerIsBetter) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (Math.abs(max - min) < 0.000001) return 100;
    const result = lowerIsBetter ? (max - value) / (max - min) : (value - min) / (max - min);
    return Math.max(0, Math.min(100, result * 100));
  }

  function bestRows(rows, key, direction, tolerance = 0.0001) {
    if (!rows.length) return [];
    const values = rows.map((row) => numeric(row.metrics[key]));
    const target = direction === "max" ? Math.max(...values) : Math.min(...values);
    return rows.filter((row) => Math.abs(numeric(row.metrics[key]) - target) <= tolerance);
  }

  function serviceComparator(left, right, businessKey = "estimatedRoadKm", businessDirection = "min") {
    const priorityDifference = numeric(right?.metrics?.servicePriorityScore) - numeric(left?.metrics?.servicePriorityScore);
    if (priorityDifference) return priorityDifference;
    const assignedDifference = numeric(right?.metrics?.assigned) - numeric(left?.metrics?.assigned);
    if (assignedDifference) return assignedDifference;
    const leftBusiness = numeric(left?.metrics?.[businessKey]);
    const rightBusiness = numeric(right?.metrics?.[businessKey]);
    const businessDifference = businessDirection === "max"
      ? rightBusiness - leftBusiness
      : leftBusiness - rightBusiness;
    if (businessDifference) return businessDifference;
    return text(left?.planHash).localeCompare(text(right?.planHash));
  }

  async function rankCandidatePool(sourcePlans, scenario) {
    const verified = [];
    for (const sourcePlan of sourcePlans) {
      const verification = await verify(sourcePlan, scenario);
      const plan = verification.recomputedPlan;
      plan.verification = { ...verification, recomputedPlan: undefined };
      plan.meta = { ...(sourcePlan.meta || {}), ...(plan.meta || {}), reportedMetrics: verification.reportedMetrics };
      plan.requestedGoals = [...new Set([...(sourcePlan.requestedGoals || []), text(sourcePlan.meta?.requestedGoal || sourcePlan.meta?.goal)].filter(Boolean))];
      plan.planId = sourcePlan.planId || `PLAN-${text(plan.planHash).split(":").at(-1).slice(0, 12).toUpperCase()}`;
      plan.scenarioId = scenario.scenarioId;
      verified.push(plan);
    }
    const deduped = [];
    verified.forEach((plan) => {
      const existing = deduped.find((candidate) => candidate.planHash === plan.planHash);
      if (existing) {
        existing.requestedGoals = [...new Set([...existing.requestedGoals, ...plan.requestedGoals])];
        existing.meta.equivalentRequestedGoals = existing.requestedGoals;
      } else deduped.push(plan);
    });
    const valid = deduped.filter((plan) => {
      if (plan.verification.status === "FAIL") return false;
      if (plan.serverHashVerified === true) return true;
      return plan.engine === "Demo Heuristic"
        && plan.inputHash === scenario.inputHash
        && plan.planHash === plan.verification.computedPlanHash;
    });
    const maxPriority = valid.length ? Math.max(...valid.map((plan) => numeric(plan.metrics.servicePriorityScore))) : -Infinity;
    const priorityPeers = valid.filter((plan) => numeric(plan.metrics.servicePriorityScore) === maxPriority);
    const maxAssigned = priorityPeers.length ? Math.max(...priorityPeers.map((plan) => numeric(plan.metrics.assigned))) : -Infinity;
    const servicePeers = priorityPeers.filter((plan) => numeric(plan.metrics.assigned) === maxAssigned);
    const weights = scenarioModel(scenario).balancedWeights;
    const values = {
      usedVehicles: servicePeers.map((plan) => numeric(plan.metrics.usedVehicles)),
      estimatedRoadKm: servicePeers.map((plan) => numeric(plan.metrics.estimatedRoadKm)),
      totalCost: servicePeers.map((plan) => numeric(plan.metrics.totalCost)),
      totalCO2: servicePeers.map((plan) => numeric(plan.metrics.totalCO2)),
      latestEnd: servicePeers.map((plan) => numeric(plan.metrics.latestEndMinutes)),
      utilizationScore: servicePeers.map((plan) => numeric(plan.metrics.utilizationScore)),
    };
    servicePeers.forEach((plan) => {
      const breakdown = {
        usedVehicles: normalizeScore(plan.metrics.usedVehicles, values.usedVehicles, true),
        estimatedRoadKm: normalizeScore(plan.metrics.estimatedRoadKm, values.estimatedRoadKm, true),
        totalCost: normalizeScore(plan.metrics.totalCost, values.totalCost, true),
        totalCO2: normalizeScore(plan.metrics.totalCO2, values.totalCO2, true),
        latestEnd: normalizeScore(plan.metrics.latestEndMinutes, values.latestEnd, true),
        utilizationScore: normalizeScore(plan.metrics.utilizationScore, values.utilizationScore, false),
      };
      const totalWeight = Object.values(weights).reduce((sum, value) => sum + numeric(value), 0) || 100;
      plan.metrics.balancedPoolScore = round(Object.entries(breakdown).reduce((sum, [key, value]) => sum + value * numeric(weights[key]), 0) / totalWeight, 1);
      plan.metrics.balancedScore = plan.metrics.balancedPoolScore;
      plan.metrics.balancedPoolBreakdown = Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, round(value, 1)]));
    });
    deduped.forEach((plan) => {
      plan.labels = [];
      plan.meta = { ...(plan.meta || {}), serviceLevelComparable: servicePeers.includes(plan), candidatePoolSize: deduped.length, bestServiceCandidateCount: servicePeers.length, balancedStrategy: "balanced-seed-plus-pool-score" };
    });
    const tolerance = scenarioModel(scenario).tolerance;
    const assignments = {
      distance: bestRows(servicePeers, "estimatedRoadKm", "min", tolerance.distanceMeters / 1000),
      cost: bestRows(servicePeers, "totalCost", "min", tolerance.cost),
      carbon: bestRows(servicePeers, "totalCO2", "min", tolerance.carbon),
      vehicles: bestRows(servicePeers, "usedVehicles", "min", 0),
      utilization: bestRows(servicePeers, "utilizationScore", "max", tolerance.utilizationPercent),
      balanced: bestRows(servicePeers, "balancedPoolScore", "max", tolerance.utilizationPercent),
    };
    Object.entries(assignments).forEach(([label, plans]) => plans.forEach((plan) => plan.labels.push(label)));
    const goalLinks = Object.fromEntries(Object.entries(assignments).map(([goal, plans]) => [goal, plans.sort((left, right) => left.planHash.localeCompare(right.planHash))[0]?.planId || null]));
    return { candidates: deduped, servicePeers, goalLinks, assignments, bestService: { priorityScore: maxPriority, assigned: maxAssigned }, invariant: { status: Object.values(goalLinks).every(Boolean) && servicePeers.length ? "PASS" : "FAIL", checkedAt: new Date().toISOString() } };
  }

  function capacityLowerBound(demand, vehicles, field) {
    if (demand <= 0) return 0;
    const capacities = vehicles.map((vehicle) => numeric(vehicle[field])).filter((value) => value > 0).sort((left, right) => right - left);
    let total = 0;
    for (let index = 0; index < capacities.length; index += 1) {
      total += capacities[index];
      if (total >= demand) return index + 1;
    }
    return Infinity;
  }

  function precheckOrder(order, scenario) {
    const coord = normalizeCoord(order);
    if (!coord.valid) return { reasonCode: "INVALID_COORDINATE", confidence: "deterministic", evidence: { lon: order.lon, lat: order.lat }, suggestedActions: ["补充有效经纬度"] };
    const vehicles = (scenario?.vehicles || []).filter((vehicle) => vehicle.enabled !== false && (!vehicle.availableDate || text(vehicle.availableDate) === text(scenario.planningDate)));
    if (!vehicles.length) return { reasonCode: "NO_VEHICLE_AVAILABLE_ON_DATE", confidence: "deterministic", evidence: { planningDate: scenario.planningDate }, suggestedActions: ["补充当日可用车辆"] };
    const maxVolume = Math.max(...vehicles.map((vehicle) => numeric(vehicle.maxVolume)));
    const maxWeight = Math.max(...vehicles.map((vehicle) => numeric(vehicle.maxWeight)));
    if (numeric(order.volume) > maxVolume) return { reasonCode: "ORDER_EXCEEDS_ALL_VEHICLES_VOLUME", confidence: "deterministic", evidence: { orderVolume: numeric(order.volume), maxVehicleVolume: maxVolume }, suggestedActions: ["拆单", "增加大容积车辆"] };
    if (numeric(order.weight) > maxWeight) return { reasonCode: "ORDER_EXCEEDS_ALL_VEHICLES_WEIGHT", confidence: "deterministic", evidence: { orderWeight: numeric(order.weight), maxVehicleWeight: maxWeight }, suggestedActions: ["拆单", "增加大载重车辆"] };
    return null;
  }

  function fleetAdequacy(scenario) {
    const orders = scenario?.orders || [];
    const vehicles = (scenario?.vehicles || []).filter((vehicle) => vehicle.enabled !== false && (!vehicle.availableDate || text(vehicle.availableDate) === text(scenario.planningDate)));
    const totalVolume = orders.reduce((sum, order) => sum + Math.max(0, numeric(order.volume)), 0);
    const totalWeight = orders.reduce((sum, order) => sum + Math.max(0, numeric(order.weight)), 0);
    const totalVolumeCapacity = vehicles.reduce((sum, vehicle) => sum + Math.max(0, numeric(vehicle.maxVolume)), 0);
    const totalWeightCapacity = vehicles.reduce((sum, vehicle) => sum + Math.max(0, numeric(vehicle.maxWeight)), 0);
    const model = scenarioModel(scenario);
    const serviceMinutes = orders.reduce((sum, order) => sum + Math.max(0, numeric(order.serviceMin, model.defaultServiceMin)), 0);
    const longestShift = Math.max(1, ...vehicles.map((vehicle) => {
      const start = timeToMinutes(vehicle.start, 0);
      return overnightEnd(start, timeToMinutes(vehicle.end, start)) + model.shiftExtensionMinutes - start;
    }));
    const blocked = orders.map((order) => ({ orderId: orderId(order), detail: precheckOrder(order, scenario) })).filter((row) => row.detail);
    const volumeLowerBound = capacityLowerBound(totalVolume, vehicles, "maxVolume");
    const weightLowerBound = capacityLowerBound(totalWeight, vehicles, "maxWeight");
    const timeLowerBound = Math.ceil(serviceMinutes / longestShift);
    const requiredLowerBound = Math.max(volumeLowerBound, weightLowerBound, timeLowerBound);
    const primaryCapacityGap = !vehicles.length ? "vehicles" : totalVolume > totalVolumeCapacity ? "volume" : totalWeight > totalWeightCapacity ? "weight" : timeLowerBound > vehicles.length ? "time" : blocked.length ? "precheck" : "none";
    return {
      totalOrders: orders.length,
      totalVolume: round(totalVolume, 3),
      totalWeight: round(totalWeight, 3),
      availableVehicles: vehicles.length,
      totalVolumeCapacity: round(totalVolumeCapacity, 3),
      totalWeightCapacity: round(totalWeightCapacity, 3),
      volumeLowerBound,
      weightLowerBound,
      timeLowerBound,
      requiredLowerBound,
      blockedOrders: blocked,
      primaryCapacityGap,
      theoreticallyCanServeAll: blocked.length === 0 && requiredLowerBound <= vehicles.length,
      note: "下界不是完整 VRP 可行性证明。",
    };
  }

  function diagnostics(plan, scenario) {
    const adequacy = fleetAdequacy(scenario);
    const rows = [...(plan?.blockedOrders || []), ...(plan?.unassignedOrders || [])];
    const scenarioReasons = [];
    if (adequacy.totalVolume > adequacy.totalVolumeCapacity) scenarioReasons.push({ reasonCode: "GLOBAL_VOLUME_CAPACITY_SHORTFALL", severity: "high", evidence: { demandVolume: adequacy.totalVolume, availableVolume: adequacy.totalVolumeCapacity, gap: round(adequacy.totalVolume - adequacy.totalVolumeCapacity, 3) }, suggestedActions: ["增加车辆", "拆分配送波次", "使用更大车型"] });
    if (adequacy.totalWeight > adequacy.totalWeightCapacity) scenarioReasons.push({ reasonCode: "GLOBAL_WEIGHT_CAPACITY_SHORTFALL", severity: "high", evidence: { demandWeight: adequacy.totalWeight, availableWeight: adequacy.totalWeightCapacity, gap: round(adequacy.totalWeight - adequacy.totalWeightCapacity, 3) }, suggestedActions: ["增加载重能力", "拆单"] });
    if (!adequacy.availableVehicles) scenarioReasons.push({ reasonCode: "NO_AVAILABLE_VEHICLES", severity: "high", evidence: { planningDate: scenario.planningDate }, suggestedActions: ["补充当日可用车辆"] });
    const orderReasons = rows.map((row) => {
      const order = (scenario.orders || []).find((item) => orderId(item) === orderId(row)) || row;
      const deterministic = precheckOrder(order, scenario);
      if (deterministic) return { orderId: orderId(order), priority: order.priority, priorityWeight: numeric(order.priorityWeight), ...deterministic, scenarioReasons: scenarioReasons.map((reason) => reason.reasonCode), solverStatus: plan?.meta?.solveStats?.status || "BEST_FOUND" };
      const heuristic = plan?.engine !== "OR-Tools";
      return {
        orderId: orderId(order),
        priority: order.priority,
        priorityWeight: numeric(order.priorityWeight),
        reasonCode: heuristic ? "HEURISTIC_FALLBACK_UNASSIGNED" : scenarioReasons.length ? "UNASSIGNED_UNDER_GLOBAL_CAPACITY_PRESSURE" : "UNASSIGNED_REASON_NOT_PROVEN",
        confidence: heuristic ? "unknown" : scenarioReasons.length ? "probable" : "unknown",
        scenarioReasons: scenarioReasons.map((reason) => reason.reasonCode),
        evidence: { individuallyFeasible: true, engine: plan?.engine, solverStatus: plan?.meta?.solveStats?.status || "BEST_FOUND" },
        suggestedActions: ["人工复核组合约束", "调整车辆或配送波次"],
        solverStatus: plan?.meta?.solveStats?.status || "BEST_FOUND",
      };
    });
    return {
      assigned: numeric(plan?.metrics?.assigned),
      unassigned: plan?.unassignedOrders?.length || 0,
      blocked: plan?.blockedOrders?.length || 0,
      unassignedVolume: round(rows.reduce((sum, row) => sum + numeric(row.volume), 0), 3),
      unassignedWeight: round(rows.reduce((sum, row) => sum + numeric(row.weight), 0), 3),
      primaryConstraint: adequacy.primaryCapacityGap,
      scenarioReasons,
      orderReasons,
      suggestedActions: [...new Set(scenarioReasons.flatMap((reason) => reason.suggestedActions))],
      fleetAdequacy: adequacy,
    };
  }

  function planFingerprint(plan) {
    return text(plan?.planHash || plan?.meta?.planHash);
  }

  const verifierApi = {
    normalizeCoord,
    haversineMeters,
    haversineKm,
    roadMeters,
    travelMinutes,
    timeToMinutes,
    timeText,
    utilizationMetrics,
    recomputeRoute,
    recomputePlan,
    verify,
    serviceComparator,
    rankCandidatePool,
    fleetAdequacy,
    diagnostics,
    scenarioModel,
    planFingerprint,
    routeOrderIds,
  };
  Object.defineProperties(verifierApi, {
    TOLERANCE: { enumerable: true, get: () => contract().tolerances },
    BALANCED_WEIGHTS: { enumerable: true, get: () => contract().balancedPoolWeights },
    LOW_UTILIZATION_THRESHOLD: { enumerable: true, get: () => contract().utilization.lowRouteThresholdPercent },
  });
  window.STCTVerifier = verifierApi;
})();
