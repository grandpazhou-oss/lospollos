#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Registry = require("../routing-provider-registry-v16.js");
const Routing = require("../road-routing-v16.js");
const Provenance = require("../routing-provenance-v16.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(callback, expected) { try { callback(); } catch (error) { return expected.includes(error.code); } return false; }
async function rejectsCode(promise, expected) { try { await promise; } catch (error) { return expected.includes(error.code); } return false; }
function point(pointId, lon, lat) { return { pointId, lon, lat }; }
function request(providerId = "SYNTHETIC_ROAD_FIXTURE", overrides = {}) {
  return {
    schemaVersion: "stct-routing-request-v1.6",
    providerId,
    profile: "light-truck",
    points: [point("DEPOT", 121.4500, 31.2000), point("C", 121.4650, 31.2000)],
    distanceUnit: "km",
    durationUnit: "minutes",
    snapToleranceMeters: 120,
    ...overrides,
  };
}

async function main() {
  check("T026", throwsCode(() => Registry.createProvider({ version: "1", mode: "ESTIMATED", availability: "READY" }), ["PROVIDER_ID_REQUIRED"]));
  check("T027", throwsCode(() => Registry.createProvider({ id: "X", mode: "ESTIMATED", availability: "READY" }), ["PROVIDER_VERSION_REQUIRED"]));
  check("T028", throwsCode(() => Registry.createProvider({ id: "X", version: "1", availability: "READY" }), ["PROVIDER_MODE_INVALID"]));
  check("T029", throwsCode(() => Registry.createProvider({ id: "X", version: "1", mode: "ESTIMATED", availability: "LIVE" }), ["PROVIDER_AVAILABILITY_INVALID"]));

  const registry = Registry.createRegistry();
  const fixture = registry.get("SYNTHETIC_ROAD_FIXTURE");
  const capabilities = fixture.capabilities();
  check("T030", Registry.CAPABILITY_KEYS.every((key) => typeof capabilities[key] === "boolean") && capabilities.traffic === false && capabilities.sideOfStreet === false, capabilities);
  const estimated = registry.get("ESTIMATED_HAVERSINE_FALLBACK");
  check("T031", await rejectsCode(estimated.route(request(estimated.id, { closures: ["E_B_C"] })), ["UNSUPPORTED_CAPABILITY"]));
  const health = fixture.health();
  check("T032", ["schemaVersion", "providerId", "providerVersion", "availability", "mode", "checkedAt", "requestCount", "pointCount", "message"].every((key) => Object.hasOwn(health, key)), health);
  const owned = fixture.provenance({ profile: "light-truck" });
  check("T033", owned.providerOwned === true && Provenance.validate(owned, fixture).status === "PASS", owned);
  const spoofed = fixture.provenance({ providerId: "FORGED", providerVersion: "evil", mode: "LOCAL_EXTERNAL" });
  check("T034", spoofed.providerId === fixture.id && spoofed.providerVersion === fixture.version && spoofed.mode === fixture.mode, spoofed);
  check("T035", registry.list().some((row) => row.id === "ESTIMATED_HAVERSINE_FALLBACK" && row.mode === "ESTIMATED"));
  check("T036", registry.list().some((row) => row.id === "SYNTHETIC_ROAD_FIXTURE" && row.availability === "READY"));
  check("T037", registry.get("LOCAL_OSRM_COMPATIBLE").availability === "DISABLED_BY_CONFIGURATION");
  check("T038", registry.get("LOCAL_VALHALLA_COMPATIBLE").availability === "DISABLED_BY_CONFIGURATION");
  check("T039", registry.get("LOCAL_OSRM_COMPATIBLE").requestLog().length === 0 && registry.get("LOCAL_VALHALLA_COMPATIBLE").requestLog().length === 0);

  let externalCalls = 0;
  const blockedExternal = Registry.externalProvider("LOCAL_OSRM_COMPATIBLE", { enabled: true, endpoint: "http://127.0.0.1:9999", coordinatesExternalApproved: false, capabilities: { route: true }, adapter: async () => { externalCalls += 1; return {}; } });
  check("T040", await rejectsCode(blockedExternal.route(request(blockedExternal.id)), ["DISABLED_BY_CONFIGURATION", "COORDINATE_TRANSMISSION_NOT_APPROVED"]) && externalCalls === 0);
  const approvedExternal = Registry.externalProvider("LOCAL_OSRM_COMPATIBLE", {
    enabled: true,
    endpoint: "http://127.0.0.1:9999",
    coordinatesExternalApproved: true,
    token: "MUST_NOT_APPEAR",
    capabilities: { route: true },
    adapter: async ({ action, request: normalized }) => {
      externalCalls += 1;
      return { schemaVersion: "external-fixture", action, pointIds: normalized.points.map((row) => row.pointId), requestHash: Routing.requestHash(normalized), routeHash: "sha256:external-fixture", graphHash: "sha256:configured-local", trafficMode: "CONFIGURED", departureTimeApplied: false };
    },
  });
  const externalResult = await approvedExternal.route(request(approvedExternal.id));
  check("T041", externalCalls === 1 && externalResult.providerId === approvedExternal.id && externalResult.providerProvenance.privacyMode === "EXPLICIT_COORDINATE_TRANSMISSION_APPROVAL", externalResult.providerProvenance);
  check("T042", !JSON.stringify(approvedExternal.requestLog()).includes("MUST_NOT_APPEAR") && !JSON.stringify(externalResult.providerProvenance).match(/token|authorization|apiKey/i));
  check("T043", approvedExternal.requestLog()[0].pointCount === 2, approvedExternal.requestLog());
  check("T044", approvedExternal.requestLog()[0].profile === "light-truck");
  check("T045", approvedExternal.requestLog()[0].privacyMode === "EXPLICIT_COORDINATE_TRANSMISSION_APPROVAL");
  check("T046", fixture.validateRequest("bad").status === "FAIL");
  check("T047", fixture.validateRequest(request(fixture.id, { unexpected: true })).errors[0].code === "ROUTING_UNKNOWN_FIELD");
  const limited = Registry.externalProvider("LOCAL_OSRM_COMPATIBLE", { enabled: true, endpoint: "http://127.0.0.1:9998", coordinatesExternalApproved: true, maxPoints: 2, capabilities: { route: true }, adapter: async () => ({}) });
  check("T048", limited.validateRequest(request(limited.id, { points: [...request().points, point("B", 121.46, 31.2)] })).errors[0].code === "ROUTING_POINT_LIMIT");
  check("T049", fixture.validateRequest(request(fixture.id, { points: [point("A", 999, 31), point("B", 121, 31)] })).errors[0].code === "ROUTING_POINT_COORDINATE_INVALID");
  check("T050", fixture.validateRequest(request(fixture.id, { points: [point("A", 121.45, 31.2), point("A", 121.46, 31.2)] })).errors[0].code === "ROUTING_POINT_ID_DUPLICATE");
  check("T051", fixture.validateRequest(request(fixture.id, { profile: "" })).errors[0].code === "ROUTING_PROFILE_REQUIRED");
  check("T052", fixture.validateRequest({ ...request(fixture.id), distanceUnit: "" }).errors[0].code === "ROUTING_UNITS_REQUIRED");
  check("T053", fixture.validateRequest(request(fixture.id, { vehicleProfile: { heightM: -1 } })).errors[0].code.endsWith("_INVALID"));
  check("T054", fixture.validateRequest(request(fixture.id, { vehicleProfile: { grossWeightKg: 0 } })).errors[0].code.endsWith("_INVALID"));
  const closureNormalized = fixture.validateRequest(request(fixture.id, { closures: ["E_B_C", { edgeId: "E_B_C" }] })).normalized;
  check("T055", closureNormalized.closures.length === 1 && closureNormalized.closures[0].edgeId === "E_B_C", closureNormalized.closures);
  check("T056", fixture.cancel().status === "CANCELLED" && fixture.cancel().status === "CANCELLED");

  const deferred = [];
  const staleProvider = Registry.createProvider({ id: "STALE_TEST", version: "1", mode: "ROAD_FIXTURE", availability: "READY", capabilities: { route: true }, route: async () => new Promise((resolve) => deferred.push(resolve)) });
  const staleRequest = request("STALE_TEST");
  const first = staleProvider.route(staleRequest); const second = staleProvider.route(staleRequest);
  deferred[1]({ routeHash: "sha256:second", graphHash: "sha256:g", trafficMode: "NONE", departureTimeApplied: false });
  await second;
  deferred[0]({ routeHash: "sha256:first", graphHash: "sha256:g", trafficMode: "NONE", departureTimeApplied: false });
  check("T057", await rejectsCode(first, ["PROVIDER_STALE_RESPONSE"]));

  let availabilityEvents = 0; const unsubscribe = registry.subscribe(() => { availabilityEvents += 1; });
  registry.setAvailability("SYNTHETIC_ROAD_FIXTURE", "DEGRADED"); registry.setAvailability("SYNTHETIC_ROAD_FIXTURE", "READY"); unsubscribe();
  check("T058", availabilityEvents === 2);
  check("T059", registry.list().some((row) => row.id === estimated.id && row.availability === "DEGRADED"));
  check("T060", Routing.requestHash(request(fixture.id)) !== Routing.requestHash(request(estimated.id)));

  const baseMatrix = await fixture.matrix(request(fixture.id, { points: [point("DEPOT", 121.45, 31.2), point("H", 121.47, 31.2)] }));
  const profileMatrix = await fixture.matrix(request(fixture.id, { profile: "alternate-profile", points: request().points }));
  const closureMatrix = await fixture.matrix(request(fixture.id, { closures: ["E_B_C"] }));
  const vehicleMatrix = await fixture.matrix(request(fixture.id, { vehicleProfile: { vehicleType: "HEAVY_TRUCK", heightM: 3.6, widthM: 2.5, lengthM: 9, grossWeightKg: 12000, axleWeightKg: 7000 } }));
  const tollMatrix = await fixture.matrix(request(fixture.id, { points: [point("C", 121.465, 31.2), point("ZONE_B", 121.475, 31.2)], avoidTolls: true }));
  check("T061", baseMatrix.matrixHash !== profileMatrix.matrixHash);
  check("T062", baseMatrix.matrixHash !== closureMatrix.matrixHash && closureMatrix.closureIds.includes("E_B_C"));
  check("T063", baseMatrix.matrixHash !== vehicleMatrix.matrixHash && vehicleMatrix.vehicleProfile.vehicleType === "HEAVY_TRUCK");
  check("T064", tollMatrix.avoidTolls === true && tollMatrix.matrixHash !== (await fixture.matrix(request(fixture.id, { points: [point("C", 121.465, 31.2), point("ZONE_B", 121.475, 31.2)] }))).matrixHash);
  check("T065", baseMatrix.departureTimeApplied === false);
  check("T066", ["NONE", "SYNTHETIC", "CONFIGURED"].includes(baseMatrix.trafficMode) && baseMatrix.trafficMode === "SYNTHETIC");
  const fixtureV2 = Registry.fixtureProvider({ version: "1.6.1-fixture" });
  check("T067", fixture.provenance().provenanceHash !== fixtureV2.provenance().provenanceHash);
  const capabilityJSON = registry.capabilityJSON();
  check("T068", capabilityJSON.providers.length === 4 && capabilityJSON.providers.every((row) => Registry.CAPABILITY_KEYS.every((key) => typeof row.capabilities[key] === "boolean")), capabilityJSON);
  check("T069", ["zh", "en", "ja"].every((language) => registry.localizedStatus(fixture.id, language).label), ["zh", "en", "ja"].map((language) => registry.localizedStatus(fixture.id, language)));
  check("T070", registry.noWebGLInfo().mode === "NO_WEBGL_OPERATIONAL" && registry.noWebGLInfo().providers.length === 4);

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
