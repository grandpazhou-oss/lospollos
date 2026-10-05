#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const Scenario = require('../scenario-lab-v18.js');
const Custody = require('../pickup-custody-v18.js');
const Contract = require('../network-contract-v18.js');
const { makeNetwork } = require('./fixtures/network-v18-fixture.js');

const base = Scenario.baseline(makeNetwork({ depotCount: 2, vehicleCount: 4, orderCount: 20 }));
const first = Scenario.applyScenario(base, 'ROAD_CLOSURE', { from: 'A', to: 'B' });
const second = Scenario.applyScenario(base, 'ROAD_CLOSURE', { from: 'A', to: 'B' });
assert.equal(first.inputHash, second.inputHash);
assert.equal(first.scenario.routingContext.closures.at(-1).closureId, 'CLOSURE-1');

const source = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 2, pickupDelivery: true });
const normalized = Contract.normalizeScenario(source);
const pair = normalized.pickupDeliveryPairs[0];
const pickup = normalized.orders.find(row => row.orderId === pair.pickupOrderId);
const delivery = normalized.orders.find(row => row.orderId === pair.deliveryOrderId);
const [lonA, latA] = pickup.coordinate, [lonB, latB] = delivery.coordinate;
const rad = value => value * Math.PI / 180;
const arc = 2 * Math.asin(Math.sqrt(Math.sin(rad(latB - latA) / 2) ** 2 + Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(rad(lonB - lonA) / 2) ** 2));
const geographicKm = Math.round(6371.0088 * arc * 1000) / 1000;
const factor = normalized.vehicleTypes.find(row => row.vehicleTypeId === normalized.vehicles[0].vehicleTypeId).emission.loadedKgPerKm;
const expectedCarbon = Math.round(geographicKm * factor * 1000) / 1000;
const normal = Custody.planPickupDelivery(source, { directTravelMinutes: 15 }).shipments[0];
const slow = Custody.planPickupDelivery(source, { directTravelMinutes: 60 }).shipments[0];
assert.equal(normal.carbonKg, expectedCarbon);
assert.equal(slow.carbonKg, expectedCarbon);
assert.notEqual(slow.costToServe, normal.costToServe);
assert.equal(normal.carbonSource, 'ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR');
console.log(JSON.stringify({ status: 'PASS', closureId: first.scenario.routingContext.closures.at(-1).closureId, geographicKm, carbonKg: normal.carbonKg }));
