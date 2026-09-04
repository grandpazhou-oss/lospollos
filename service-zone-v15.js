(function (root, factory) {
  "use strict";
  const events = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const api = factory(events);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.serviceZones = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DomainEvents) {
  "use strict";

  const VERSION = "stct-service-zone-v1.5";
  const ZONE_TYPES = Object.freeze(["SERVICE_ZONE", "PRIORITY_ZONE", "RESTRICTED_SIMULATION_ZONE"]);
  const ENFORCEMENT = "DIAGNOSTIC_ONLY";
  const BOUNDARY = "Diagnostic-only zone / Not solver-enforced";

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function text(value) { return String(value ?? "").trim(); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  function hash(value) {
    if (!DomainEvents?.hashValue) throw error("SERVICE_ZONE_HASH_ENGINE_UNAVAILABLE", "Service Zone requires the unified SHA-256 identity engine.");
    return DomainEvents.hashValue(value);
  }
  function error(code, message, detail = {}) { const value = new Error(message); value.code = code; value.detail = clone(detail); return value; }

  function coordinate(value) {
    if (Array.isArray(value)) return [number(value[0]), number(value[1])];
    return [number(value?.lon ?? value?.lng ?? value?.longitude ?? value?.coordinate?.[0]), number(value?.lat ?? value?.latitude ?? value?.coordinate?.[1])];
  }
  function isCoordinate(value) { return Array.isArray(value) && value.length >= 2 && value.every((item, index) => index > 1 || Number.isFinite(Number(item))); }
  function rectangle(west, south, east, north) { return [[west, south], [east, south], [east, north], [west, north], [west, south]]; }
  function feature(id, type, coordinates, label) {
    return {
      type: "Feature",
      id,
      properties: {
        zoneId: id,
        zoneType: type,
        label,
        synthetic: true,
        enforcement: ENFORCEMENT,
        solverEnforced: false,
        boundary: BOUNDARY,
      },
      geometry: { type: "Polygon", coordinates: [coordinates] },
    };
  }

  function scenarioCoordinates(scenario = {}) {
    const values = [];
    [scenario.depot, ...(scenario.orders || [])].forEach((item) => {
      const point = coordinate(item);
      if (isCoordinate(point)) values.push(point.map(Number));
    });
    return values;
  }

  function createSyntheticZones(options = {}) {
    const points = scenarioCoordinates(options.scenario || {});
    const center = coordinate(options.center || (points.length ? {
      lon: points.reduce((sum, item) => sum + item[0], 0) / points.length,
      lat: points.reduce((sum, item) => sum + item[1], 0) / points.length,
    } : { lon: 117.2, lat: 39.12 }));
    const spanLon = points.length ? Math.max(0.03, Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]))) : 0.18;
    const spanLat = points.length ? Math.max(0.025, Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]))) : 0.12;
    const [lon, lat] = center.map(Number);
    const features = [
      feature("ZONE-SERVICE-01", "SERVICE_ZONE", rectangle(lon - spanLon * .62, lat - spanLat * .62, lon + spanLon * .62, lat + spanLat * .62), "Synthetic service area"),
      feature("ZONE-PRIORITY-01", "PRIORITY_ZONE", rectangle(lon - spanLon * .18, lat - spanLat * .22, lon + spanLon * .28, lat + spanLat * .24), "Synthetic priority area"),
      feature("ZONE-RESTRICTED-01", "RESTRICTED_SIMULATION_ZONE", rectangle(lon + spanLon * .18, lat - spanLat * .58, lon + spanLon * .48, lat - spanLat * .22), "Synthetic restricted simulation area"),
    ];
    const serviceZoneHash = hash(features);
    return {
      type: "FeatureCollection",
      features,
      metadata: {
        schemaVersion: "stct-service-zone-schema-v1.5",
        synthetic: true,
        enforcement: ENFORCEMENT,
        solverEnforced: false,
        boundary: BOUNDARY,
        serviceZoneHash,
        zoneHash: serviceZoneHash,
      },
    };
  }

  function validateZones(input) {
    try {
      if (input?.type !== "FeatureCollection" || !Array.isArray(input.features)) throw error("ZONE_GEOJSON_INVALID", "Service zones require a GeoJSON FeatureCollection.");
      const ids = new Set();
      input.features.forEach((item) => {
        const id = text(item?.properties?.zoneId || item?.id); const zoneType = text(item?.properties?.zoneType);
        if (!id || ids.has(id)) throw error("ZONE_ID_INVALID", `Zone id is missing or duplicated: ${id || "-"}`);
        if (!ZONE_TYPES.includes(zoneType)) throw error("ZONE_TYPE_UNSUPPORTED", `Unsupported zone type: ${zoneType}`);
        if (item?.properties?.synthetic !== true || item?.properties?.solverEnforced !== false || item?.properties?.enforcement !== ENFORCEMENT) throw error("ZONE_ENFORCEMENT_MISREPRESENTED", `${id} must remain synthetic and diagnostic-only.`);
        if (item?.geometry?.type !== "Polygon" || !Array.isArray(item.geometry.coordinates?.[0]) || item.geometry.coordinates[0].length < 4) throw error("ZONE_GEOMETRY_INVALID", `${id} requires a Polygon ring.`);
        if (!item.geometry.coordinates[0].every(isCoordinate)) throw error("ZONE_COORDINATE_INVALID", `${id} contains invalid coordinates.`);
        ids.add(id);
      });
      const expectedHash = hash(input.features);
      const suppliedHash = text(input.metadata?.serviceZoneHash || input.metadata?.zoneHash);
      if (suppliedHash && suppliedHash !== expectedHash) throw error("SERVICE_ZONE_HASH_MISMATCH", "Service Zone hash does not match feature content.", { expectedHash, actualHash: suppliedHash });
      return { status: "PASS", zones: clone(input), errors: [] };
    } catch (caught) {
      return { status: "FAIL", zones: null, errors: [{ code: text(caught.code || "ZONE_INVALID"), message: text(caught.message), detail: clone(caught.detail || {}) }] };
    }
  }

  function pointOnSegment(point, left, right, tolerance = 1e-10) {
    const cross = (point[1] - left[1]) * (right[0] - left[0]) - (point[0] - left[0]) * (right[1] - left[1]);
    if (Math.abs(cross) > tolerance) return false;
    return point[0] >= Math.min(left[0], right[0]) - tolerance && point[0] <= Math.max(left[0], right[0]) + tolerance && point[1] >= Math.min(left[1], right[1]) - tolerance && point[1] <= Math.max(left[1], right[1]) + tolerance;
  }

  function pointInRing(pointValue, ring) {
    const point = coordinate(pointValue).map(Number);
    if (!isCoordinate(point)) return false;
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const currentPoint = ring[index].map(Number); const previousPoint = ring[previous].map(Number);
      if (pointOnSegment(point, previousPoint, currentPoint)) return true;
      const intersects = currentPoint[1] > point[1] !== previousPoint[1] > point[1]
        && point[0] < (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInZone(point, zone) {
    const rings = zone?.geometry?.coordinates || [];
    if (!rings.length || !pointInRing(point, rings[0])) return false;
    return !rings.slice(1).some((ring) => pointInRing(point, ring));
  }

  function segmentIntersection(a, b, c, d) {
    function orientation(p, q, r) {
      const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
      if (Math.abs(value) < 1e-10) return 0;
      return value > 0 ? 1 : 2;
    }
    const values = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
    if (values[0] !== values[1] && values[2] !== values[3]) return true;
    return values[0] === 0 && pointOnSegment(c, a, b) || values[1] === 0 && pointOnSegment(d, a, b) || values[2] === 0 && pointOnSegment(a, c, d) || values[3] === 0 && pointOnSegment(b, c, d);
  }

  function lineCrossesZone(coordinates, zone) {
    const line = (coordinates || []).filter(isCoordinate).map((point) => point.map(Number));
    const ring = zone?.geometry?.coordinates?.[0] || [];
    if (!line.length || !ring.length) return false;
    if (line.some((point) => pointInZone(point, zone))) return true;
    for (let lineIndex = 1; lineIndex < line.length; lineIndex += 1) {
      for (let ringIndex = 1; ringIndex < ring.length; ringIndex += 1) {
        if (segmentIntersection(line[lineIndex - 1], line[lineIndex], ring[ringIndex - 1], ring[ringIndex])) return true;
      }
    }
    return false;
  }

  function orderMembership(orders = [], zones) {
    const valid = validateZones(zones);
    if (valid.status !== "PASS") throw error(valid.errors[0].code, valid.errors[0].message, valid.errors[0].detail);
    return orders.map((order, index) => {
      const orderId = text(order?.id || order?.orderId || order?.code || `ORDER-${index + 1}`);
      const point = coordinate(order);
      const matches = valid.zones.features.filter((zone) => pointInZone(point, zone)).map((zone) => ({ zoneId: zone.properties.zoneId, zoneType: zone.properties.zoneType }));
      return { orderId, coordinate: point, memberships: matches, insideServiceZone: matches.some((item) => item.zoneType === "SERVICE_ZONE"), diagnosticOnly: true, solverEnforced: false, boundary: BOUNDARY };
    });
  }

  function routeCrossings(plan = {}, zones) {
    const valid = validateZones(zones);
    if (valid.status !== "PASS") throw error(valid.errors[0].code, valid.errors[0].message, valid.errors[0].detail);
    return (plan.routeGeoJson?.features || []).flatMap((route, index) => {
      const routeId = text(route?.properties?.routeId || route?.properties?.vehicleId || `ROUTE-${index + 1}`);
      return valid.zones.features.filter((zone) => lineCrossesZone(route?.geometry?.coordinates || [], zone)).map((zone) => ({
        routeId,
        zoneId: zone.properties.zoneId,
        zoneType: zone.properties.zoneType,
        classification: "DIAGNOSTIC",
        solverEnforced: false,
        boundary: BOUNDARY,
      }));
    });
  }

  function explainMembership(orderId, orders, zones) {
    const result = orderMembership(orders, zones).find((row) => row.orderId === text(orderId));
    if (!result) throw error("ZONE_ORDER_NOT_FOUND", `Order not found for zone explanation: ${orderId}`);
    return {
      question: "SERVICE_ZONE_MEMBERSHIP",
      orderId: result.orderId,
      status: result.memberships.length ? "OBSERVED_IN_ZONE" : "OBSERVED_OUTSIDE_ZONES",
      evidence: clone(result.memberships),
      confidence: "DETERMINISTIC_GEOMETRY",
      enforcement: ENFORCEMENT,
      solverEnforced: false,
      claimBoundary: BOUNDARY,
    };
  }

  function incidentIntersections(impact = {}, scenario = {}, zones) {
    const affected = new Set((impact.affectedOrderIds || impact.impactedOrderIds || []).map(text));
    const rows = orderMembership((scenario.orders || []).filter((order) => affected.has(text(order.id || order.orderId))), zones);
    const zoneIds = [...new Set(rows.flatMap((row) => row.memberships.map((item) => item.zoneId)))].sort();
    return { incidentHash: text(impact.incidentHash), affectedOrderCount: rows.length, zoneIds, memberships: rows, diagnosticOnly: true, solverEnforced: false, boundary: BOUNDARY };
  }

  function filterZones(zones, zoneType = "ALL") {
    const valid = validateZones(zones);
    if (valid.status !== "PASS") throw error(valid.errors[0].code, valid.errors[0].message, valid.errors[0].detail);
    const type = text(zoneType).toUpperCase();
    if (type !== "ALL" && !ZONE_TYPES.includes(type)) throw error("ZONE_FILTER_UNSUPPORTED", `Unsupported zone filter: ${type}`);
    return { ...valid.zones, features: valid.zones.features.filter((zone) => type === "ALL" || zone.properties.zoneType === type) };
  }

  function mapLayerContext(zones, zoneType = "ALL") {
    const data = filterZones(zones, zoneType);
    return {
      sources: [{ id: "stct-v15-service-zones", data }],
      layers: [
        { id: "stct-v15-service-zone-fill", type: "fill", source: "stct-v15-service-zones", paint: { "fill-color": ["match", ["get", "zoneType"], "PRIORITY_ZONE", "#00a3e0", "RESTRICTED_SIMULATION_ZONE", "#e60012", "#147d64"], "fill-opacity": .12 } },
        { id: "stct-v15-service-zone-line", type: "line", source: "stct-v15-service-zones", paint: { "line-color": ["match", ["get", "zoneType"], "PRIORITY_ZONE", "#0076a8", "RESTRICTED_SIMULATION_ZONE", "#e60012", "#147d64"], "line-width": 2, "line-dasharray": [3, 2] } },
      ],
      metadata: { zoneType: text(zoneType).toUpperCase(), enforcement: ENFORCEMENT, solverEnforced: false, boundary: BOUNDARY },
    };
  }

  return { VERSION, ZONE_TYPES, ENFORCEMENT, BOUNDARY, createSyntheticZones, validateZones, pointInZone, lineCrossesZone, orderMembership, routeCrossings, explainMembership, incidentIntersections, filterZones, mapLayerContext };
});
