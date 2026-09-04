"use strict";

const Contract = require("./network-contract-v18.js");

const VERSION = "stct-synthetic-energy-v1.8";
const LABEL = "SYNTHETIC_SCENARIO_ENERGY_NOT_CERTIFIED";
const PROPULSION_TYPES = Object.freeze(["DIESEL", "GASOLINE", "ELECTRIC", "HYBRID"]);

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function planProjection(plan) {
  const { energyPlanHash, ...projection } = plan;
  return projection;
}

function tripEnergy(vehicle, trip) {
  const loaded = trip.loadedDistanceKm * vehicle.baseConsumptionKWhPerKm * (1 + vehicle.loadConsumptionFactor * trip.loadRatio);
  const empty = trip.emptyDistanceKm * vehicle.baseConsumptionKWhPerKm * 0.75;
  const auxiliary = trip.durationMinutes / 60 * vehicle.auxiliaryPowerKw;
  return { loaded: round(loaded), empty: round(empty), auxiliary: round(auxiliary), total: round(loaded + empty + auxiliary) };
}

function makeFixture(id, evCount, tripCount, chargerCount) {
  const vehicleTypes = PROPULSION_TYPES.map((propulsionType) => ({ vehicleTypeId: `TYPE-${propulsionType}`, propulsionType, label: LABEL }));
  const vehicles = Array.from({ length: evCount }, (_, index) => ({
    vehicleId: `EV-${index + 1}`,
    vehicleTypeId: "TYPE-ELECTRIC",
    propulsionType: "ELECTRIC",
    batteryCapacityKWh: 100,
    initialStateOfChargePercent: 45,
    minimumReservePercent: 20,
    baseConsumptionKWhPerKm: 0.55,
    loadConsumptionFactor: 0.2,
    auxiliaryPowerKw: 1.8,
    connectorType: "CCS2",
  }));
  const trips = Array.from({ length: tripCount }, (_, index) => ({
    tripId: `${id}-TRIP-${index + 1}`,
    vehicleId: vehicles[index % evCount].vehicleId,
    sequence: Math.floor(index / evCount) + 1,
    loadedDistanceKm: 22 + index % 5,
    emptyDistanceKm: 3 + index % 2,
    durationMinutes: 70 + index % 4 * 5,
    loadRatio: 0.6 + index % 3 * 0.1,
    nominalStartMinute: 480 + Math.floor(index / evCount) * 150,
  }));
  return {
    schemaVersion: "stct-energy-fixture-v1.8",
    fixtureId: id,
    label: LABEL,
    modelVersion: VERSION,
    vehicleTypes,
    vehicles,
    trips,
    station: {
      stationId: `${id}-STATION-1`,
      depotId: "D1",
      connectorTypes: ["CCS2"],
      simultaneousCapacity: chargerCount,
      powerKw: 70,
      operatingWindows: [{ startMinute: 360, endMinute: 1380 }],
      syntheticEnergyCarbonKgPerKWh: 0.42,
      syntheticEnergyCostPerKWh: 0.85,
    },
    policies: { chargeOccupiesDriverDuty: false, allowReloadChargeOverlap: false, allowBreakChargeOverlap: true },
  };
}

function planEnergy(fixture) {
  const states = new Map(fixture.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle.batteryCapacityKWh * vehicle.initialStateOfChargePercent / 100]));
  const trips = [];
  const chargeSessions = [];
  let sessionIndex = 0;
  for (const trip of fixture.trips) {
    const vehicle = fixture.vehicles.find((row) => row.vehicleId === trip.vehicleId);
    const energy = tripEnergy(vehicle, trip);
    const reserve = vehicle.batteryCapacityKWh * vehicle.minimumReservePercent / 100;
    let available = states.get(vehicle.vehicleId);
    let startMinute = trip.nominalStartMinute;
    if (available - energy.total < reserve) {
      const batch = Math.floor(sessionIndex / fixture.station.simultaneousCapacity);
      const slot = sessionIndex % fixture.station.simultaneousCapacity;
      const sessionStart = Math.max(360, startMinute - 35) + batch * 35;
      const sessionEnd = sessionStart + 30;
      const energyAddedKWh = round(Math.min(fixture.station.powerKw * 0.5, vehicle.batteryCapacityKWh - available));
      chargeSessions.push({
        sessionId: `${fixture.fixtureId}-CHARGE-${sessionIndex + 1}`,
        vehicleId: vehicle.vehicleId,
        stationId: fixture.station.stationId,
        connectorType: vehicle.connectorType,
        chargerSlot: slot + 1,
        startMinute: sessionStart,
        endMinute: sessionEnd,
        energyAddedKWh,
        occupiesDriverDuty: fixture.policies.chargeOccupiesDriverDuty,
        reserved: true,
      });
      available += energyAddedKWh;
      startMinute = Math.max(startMinute, sessionEnd);
      sessionIndex += 1;
    }
    const endKWh = round(available - energy.total);
    trips.push({ ...trip, startMinute, endMinute: startMinute + trip.durationMinutes, energy, startKWh: round(available), endKWh, endStateOfChargePercent: round(endKWh / vehicle.batteryCapacityKWh * 100) });
    states.set(vehicle.vehicleId, endKWh);
  }
  const energyAdded = round(chargeSessions.reduce((sum, row) => sum + row.energyAddedKWh, 0));
  const tripUsed = round(trips.reduce((sum, row) => sum + row.energy.total, 0));
  const result = {
    schemaVersion: "stct-energy-plan-v1.8",
    fixtureId: fixture.fixtureId,
    label: LABEL,
    trips,
    chargeSessions,
    metrics: {
      tripEnergyKWh: tripUsed,
      chargedEnergyKWh: energyAdded,
      chargingCost: round(energyAdded * fixture.station.syntheticEnergyCostPerKWh),
      chargingCarbonKg: round(energyAdded * fixture.station.syntheticEnergyCarbonKgPerKWh),
      chargerCongestion: chargeSessions.length ? round(chargeSessions.length / fixture.station.simultaneousCapacity) : 0,
    },
  };
  result.energyPlanHash = Contract.hashArtifact(planProjection(result));
  return result;
}

function verifyEnergy(fixture, plan) {
  const issues = [];
  const fail = (code) => { if (!issues.includes(code)) issues.push(code); };
  if (plan.label !== LABEL) fail("ENERGY_DISCLOSURE_MISSING");
  for (const session of plan.chargeSessions || []) {
    const vehicle = fixture.vehicles.find((row) => row.vehicleId === session.vehicleId);
    if (!vehicle || vehicle.propulsionType !== "ELECTRIC") fail("NON_EV_CHARGE");
    if (session.stationId !== fixture.station.stationId || session.reserved !== true) fail("CHARGER_RESERVATION_MISSING");
    if (!fixture.station.connectorTypes.includes(session.connectorType)) fail("CHARGER_CONNECTOR_MISMATCH");
    if (!fixture.station.operatingWindows.some((window) => session.startMinute >= window.startMinute && session.endMinute <= window.endMinute)) fail("CHARGER_WINDOW_VIOLATION");
    if (session.energyAddedKWh < 0 || session.energyAddedKWh > vehicle.batteryCapacityKWh) fail("CHARGE_ENERGY_INVALID");
    if (session.reloadOverlap === true && fixture.policies.allowReloadChargeOverlap !== true) fail("RELOAD_CHARGE_OVERLAP");
    if (session.driverBreakOverlap === true && fixture.policies.allowBreakChargeOverlap !== true) fail("BREAK_CHARGE_OVERLAP");
  }
  const boundaries = [...new Set((plan.chargeSessions || []).flatMap((row) => [row.startMinute, row.endMinute]))];
  for (const minute of boundaries) {
    const active = plan.chargeSessions.filter((row) => row.startMinute <= minute && minute < row.endMinute).length;
    if (active > fixture.station.simultaneousCapacity) fail("CHARGER_CAPACITY_EXCEEDED");
  }
  const states = new Map(fixture.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle.batteryCapacityKWh * vehicle.initialStateOfChargePercent / 100]));
  const appliedSessions = new Set();
  for (const trip of plan.trips || []) {
    const vehicle = fixture.vehicles.find((row) => row.vehicleId === trip.vehicleId);
    const session = plan.chargeSessions.find((row) => row.vehicleId === trip.vehicleId && row.endMinute <= trip.startMinute && !appliedSessions.has(row.sessionId));
    let start = states.get(trip.vehicleId);
    if (session) { start += session.energyAddedKWh; appliedSessions.add(session.sessionId); }
    const energy = tripEnergy(vehicle, trip);
    const end = round(start - energy.total);
    const reserve = vehicle.batteryCapacityKWh * vehicle.minimumReservePercent / 100;
    if (end < 0) fail("NEGATIVE_STATE_OF_CHARGE");
    if (end < reserve) fail("ENERGY_RESERVE_VIOLATION");
    if (round(trip.startKWh) !== round(start) || round(trip.endKWh) !== end || Contract.canonicalString(trip.energy) !== Contract.canonicalString(energy)) fail("ENERGY_RECOMPUTE_MISMATCH");
    states.set(trip.vehicleId, end);
  }
  const energyAdded = round(plan.chargeSessions.reduce((sum, row) => sum + row.energyAddedKWh, 0));
  if (round(plan.metrics.chargingCost) !== round(energyAdded * fixture.station.syntheticEnergyCostPerKWh)) fail("CHARGING_COST_MISMATCH");
  if (round(plan.metrics.chargingCarbonKg) !== round(energyAdded * fixture.station.syntheticEnergyCarbonKgPerKWh)) fail("CHARGING_CARBON_MISMATCH");
  if (Contract.hashArtifact(planProjection(plan)) !== plan.energyPlanHash) fail("ENERGY_PLAN_HASH_MISMATCH");
  return { schemaVersion: "stct-energy-verification-v1.8", status: issues.length ? "FAIL" : "PASS", issues, recomputedStateKWh: Object.fromEntries(states) };
}

function outageRecovery(fixture, plan) {
  return {
    incidentType: "SYNTHETIC_CHARGER_OUTAGE",
    sourceEnergyPlanHash: plan.energyPlanHash,
    affectedStationId: fixture.station.stationId,
    candidates: ["SWAP_VEHICLE", "ADD_CHARGE_AT_ALTERNATE_STATION", "REASSIGN_TRIP", "DELAY_WAVE"],
    autoApplied: false,
  };
}

function views(fixture, plan) {
  const rows = plan.trips.map((trip) => ({ tripId: trip.tripId, vehicleId: trip.vehicleId, startStateOfChargePercent: round(trip.startKWh / 100 * 100), endStateOfChargePercent: trip.endStateOfChargePercent }));
  return { noWebGLTable: rows, reducedMotionTable: rows, mobileChargeSessions: plan.chargeSessions, chargerCapacity: fixture.station.simultaneousCapacity, label: LABEL };
}

module.exports = { VERSION, LABEL, PROPULSION_TYPES, tripEnergy, planProjection, makeFixture, planEnergy, verifyEnergy, outageRecovery, views };
