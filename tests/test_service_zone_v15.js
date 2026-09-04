"use strict";

const assert = require("assert");
const Zones = require("../service-zone-v15.js");

const scenario = {
  depot: { id: "DEPOT", lon: 117.2, lat: 39.12 },
  orders: [
    { id: "ORDER-CENTER", lon: 117.2, lat: 39.12 },
    { id: "ORDER-EAST", lon: 117.235, lat: 39.09 },
    { id: "ORDER-OUT", lon: 117.5, lat: 39.4 },
  ],
};
const zones = Zones.createSyntheticZones({ scenario });
assert.strictEqual(Zones.validateZones(zones).status, "PASS");
assert.deepStrictEqual(zones.features.map((row) => row.properties.zoneType).sort(), [...Zones.ZONE_TYPES].sort());
assert(zones.features.every((row) => row.properties.synthetic && !row.properties.solverEnforced && row.properties.enforcement === "DIAGNOSTIC_ONLY"));

const membership = Zones.orderMembership(scenario.orders, zones);
assert(membership.find((row) => row.orderId === "ORDER-CENTER").insideServiceZone);
assert.strictEqual(membership.find((row) => row.orderId === "ORDER-OUT").memberships.length, 0);
const explanation = Zones.explainMembership("ORDER-CENTER", scenario.orders, zones);
assert.strictEqual(explanation.claimBoundary, "Diagnostic-only zone / Not solver-enforced");
assert.strictEqual(explanation.solverEnforced, false);

const plan = { routeGeoJson: { type: "FeatureCollection", features: [{ type: "Feature", properties: { routeId: "ROUTE-1" }, geometry: { type: "LineString", coordinates: [[117.0, 39.12], [117.4, 39.12]] } }] } };
assert(Zones.routeCrossings(plan, zones).length > 0);
const impact = Zones.incidentIntersections({ incidentHash: "incident-1", affectedOrderIds: ["ORDER-CENTER"] }, scenario, zones);
assert(impact.zoneIds.length > 0 && impact.diagnosticOnly && !impact.solverEnforced);
assert.strictEqual(Zones.filterZones(zones, "PRIORITY_ZONE").features.length, 1);
const mapContext = Zones.mapLayerContext(zones);
assert.strictEqual(mapContext.sources.length, 1);
assert.strictEqual(mapContext.layers.length, 2);

const dishonest = JSON.parse(JSON.stringify(zones));
dishonest.features[0].properties.solverEnforced = true;
assert.strictEqual(Zones.validateZones(dishonest).errors[0].code, "ZONE_ENFORCEMENT_MISREPRESENTED");
process.stdout.write("PASS Service Zone synthetic geometry, diagnostics, explanation, incident intersection, filter, and honesty boundary\n");
