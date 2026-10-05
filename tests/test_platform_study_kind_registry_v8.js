#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const Contract = require("../network-contract-v18.js");
const Design = require("../supply-chain-design-v19.js");
const Supply = require("../supply-chain-controller-v19.js");
const Facility = require("../facility-location-mvp1-v19.js");
const Context = require("../platform-study-context-v8.js");
const Registry = require("../platform-study-kind-registry-v8.js");

function memoryRepository() {
  const rows = new Map(), key = (store, id) => `${store}:${id}`;
  return {
    record: (id, payload, refs = []) => ({ id, payload: structuredClone(payload), refs, contentHash: Contract.hashArtifact(payload) }),
    read: async (store, id) => id === undefined ? [...rows.entries()].filter(([name]) => name.startsWith(`${store}:`)).map(([, row]) => structuredClone(row)) : structuredClone(rows.get(key(store, id)) || null),
    list: async (store) => [...rows.entries()].filter(([name]) => name.startsWith(`${store}:`)).map(([, row]) => structuredClone(row)),
    async commit({ records = {}, pointer, expectedRevision = 0 }) {
      const old = rows.get(key("pointers", pointer.id));
      assert.equal(old?.revision || 0, expectedRevision);
      for (const [store, items] of Object.entries(records)) for (const item of items) rows.set(key(store, item.id), structuredClone(item));
      const saved = { ...pointer, revision: expectedRevision + 1 };
      rows.set(key("pointers", pointer.id), structuredClone(saved));
      return { status: "SAVED", pointer: saved };
    },
    seed(pointer) { rows.set(key("pointers", pointer.id), structuredClone(pointer)); },
  };
}

const study = { studyId: "SUPPLY-A", name: "A study", classification: "SYNTHETIC_TEST", nodes: [{ nodeId: "A", role: "DC", coordinate: [120, 30] }, { nodeId: "C", role: "CUSTOMER", coordinate: [121, 30] }], periodDemand: [{ demandId: "D", customerNodeId: "C", currentSiteId: "A", period: "P1", quantity: 5, unit: "m3" }], coordinateUse: "ASSUMED_WGS84_SCREENING" };
const scenario = { scenarioId: "CASE", type: "NETWORK_CANDIDATE", objective: "VOLUME_KM", distanceBasis: "GEOGRAPHIC_SCREENING", facilityCounts: [1], selectedSiteIds: ["A"] };

(async () => {
  const repository = memoryRepository(), supplyController = Supply.createController({ repository }), context = Context.createContext();
  let legacyOpenCalls = 0, legacySaveCalls = 0, hydrateCalls = 0, demoCalls = 0, legacyStore = null;
  const legacyService = {
    async openStudy(id) { legacyOpenCalls++; return { pointer: await repository.read("pointers", id), store: { snapshot: () => ({ studyId: "LEGACY-1", activeInputHash: "sha256:legacy", activeScenarioId: "S-1", dataSource: { sourceRef: "DATASET-1", dataClassification: "SYNTHETIC" } }) } }; },
    async saveStudy() { legacySaveCalls++; return { pointer: { id: "DESIGN:LEGACY-1:S-1", studyId: "LEGACY-1", type: "DESIGN_STUDY", datasetVersionId: "DATASET-1" } }; },
    inspectPackage: () => ({ status: "LEGACY_READ_ONLY", payload: { pointers: [] } }),
    importPackage: async () => ({ status: "LEGACY_IMPORT_DELEGATED" }),
    exportPackage: async (ids) => ({ exported: ids }),
    metadata: async (id, patch) => ({ id, patch }),
  };
  const designAdapter = { hydrateSupplyView() { hydrateCalls++; }, hasStudy: () => Boolean(legacyStore), createStrategicStudy() { demoCalls++; return legacyStore; }, adoptStudy(store) { legacyStore = store; } };
  const registry = Registry.createRegistry({ repository, legacyService, supplyController, designAdapter, context });

  supplyController.loadStudy(study);
  supplyController.calculateBaseline("GEOGRAPHIC_SCREENING");
  supplyController.configureScenario(scenario);
  supplyController.evaluateConfigured([{ demandId: "D", siteId: "A" }]);
  supplyController.compare();
  context.select({ studyKind: "SUPPLY_CHAIN_PERIOD", studyId: "SUPPLY-A", inputHash: supplyController.snapshot().study.inputHash });
  const saved = await registry.saveCurrent();
  assert.equal(saved.pointer.type, "SUPPLY_CHAIN_STUDY");
  assert.equal((await registry.list()).find((row) => row.id === saved.pointer.id).studyKind, "SUPPLY_CHAIN_PERIOD");
  const packageText = await registry.exportPackage(saved.pointer.id);
  assert.equal(registry.inspectPackage(packageText).kind, "SUPPLY_CHAIN_PERIOD");
  const brokenHash = JSON.parse(packageText); brokenHash.study.name = "tampered";
  assert.throws(() => registry.inspectPackage(brokenHash), { code: "SUPPLY_PACKAGE_INVALID" });
  const brokenSnapshot = JSON.parse(packageText); brokenSnapshot.snapshot.recommendation = "WRONG";
  brokenSnapshot.packageHash = Design.hash(Object.fromEntries(Object.entries(brokenSnapshot).filter(([key]) => key !== "packageHash")));
  assert.throws(() => registry.inspectPackage(brokenSnapshot), { code: "SUPPLY_SNAPSHOT_STALE" });

  const copied = await registry.copyCurrent("B copy");
  assert.equal(copied.status, "SAVED");
  assert.notEqual(copied.pointer.id, saved.pointer.id);
  assert.equal(copied.pointer.status, "DRAFT");
  assert.equal((await repository.read("pointers", saved.pointer.id)).snapshotHash, saved.pointer.snapshotHash);
  assert.equal(context.snapshot().current.studyId, copied.pointer.id.replace(/^SUPPLY:/, ""));
  assert.equal(supplyController.snapshot().snapshot, null);
  const copyContext = context.snapshot(), copyController = supplyController.snapshot();
  assert.equal(await registry.exportPackage(saved.pointer.id), packageText, "catalog export reads the saved A study while B remains current");
  assert.deepEqual(context.snapshot(), copyContext);
  assert.deepEqual(supplyController.snapshot(), copyController);
  await assert.rejects(registry.exportPackage(copied.pointer.id), { code: "SUPPLY_SNAPSHOT_NOT_READY" });
  repository.seed({ ...saved.pointer, inputHash: "sha256:wrong" });
  await assert.rejects(registry.exportPackage(saved.pointer.id), { code: "SUPPLY_SAVED_GRAPH_INVALID" });
  repository.seed(saved.pointer);
  const opened = await registry.open(saved.pointer.id);
  assert.equal(opened.kind, "SUPPLY_CHAIN_PERIOD");
  assert.equal(context.snapshot().current.resultHash, saved.pointer.snapshotHash);
  assert.ok(hydrateCalls >= 2);

  repository.seed({ id: "BROKEN", type: "SUPPLY_CHAIN_STUDY", refs: [{ store: "studyVersions", id: "WRONG" }] });
  await assert.rejects(registry.open("BROKEN"), { code: "STUDY_POINTER_GRAPH_INVALID" });
  assert.equal(legacyOpenCalls, 0, "Supply pointer must never fall through legacy openStudy");
  repository.seed({ id: "UNKNOWN", type: "FUTURE_STUDY", refs: [] });
  assert.equal((await registry.list()).find((row) => row.id === "UNKNOWN").openable, false);
  await assert.rejects(registry.open("UNKNOWN"), { code: "STUDY_KIND_NOT_OPENABLE" });

  context.select({ studyKind: "NETWORK_ORDERS", studyId: "LEGACY-1", inputHash: "sha256:legacy" });
  await assert.rejects(registry.saveCurrent(), { code: "CURRENT_STUDY_NOT_LOADED" });
  assert.equal(demoCalls, 0, "registry must not instantiate a synthetic study");
  repository.seed({ id: "LEGACY", type: "DESIGN_STUDY", refs: [{ store: "studyVersions", id: "VERSION" }] });
  assert.equal((await registry.open("LEGACY")).kind, "NETWORK_ORDERS");
  await registry.saveCurrent();
  assert.equal(legacyOpenCalls, 1);
  assert.equal(legacySaveCalls, 1);
  assert.equal(await registry.exportPackage(saved.pointer.id), packageText, "catalog export also works with a different study kind selected");

  const freshRepo = memoryRepository(), freshSupply = Supply.createController({ repository: freshRepo }), freshContext = Context.createContext();
  const fresh = Registry.createRegistry({ repository: freshRepo, legacyService, supplyController: freshSupply, designAdapter, context: freshContext });
  assert.equal((await fresh.importPackage(packageText)).status, "SAVED");
  assert.equal(freshContext.snapshot().current.studyId, "SUPPLY-A");
  assert.equal((await freshRepo.list("pointers")).length, 1);
  assert.equal((await fresh.importPackage(packageText)).status, "DUPLICATE");
  freshRepo.seed({ ...(await freshRepo.read("pointers", "SUPPLY:SUPPLY-A")), inputHash: "sha256:other" });
  await assert.rejects(fresh.importPackage(packageText), { code: "PACKAGE_CATALOG_ID_COLLISION" });
  assert.equal(registry.inspectPackage({ schemaVersion: "unknown-package" }).status, "LEGACY_READ_ONLY");

  const facilityStudy = Facility.normalizeStudy({ studyId: "FACILITY-A", name: "Facility A", coordinateSystem: "WGS84", demands: [{ demandId: "D", coordinate: [120, 30], demand: { quantity: 1, weight: 0, volume: 0 } }], sites: [{ siteId: "S", coordinate: [120, 30], capacity: { quantity: 1, weight: 0, volume: 0 }, fixedCost: 0 }], options: { facilityCounts: [1], costPeriod: "P1", currency: "CNY", transportCostPerUnitKm: 0 } });
  const facilityMatrix = Facility.buildMatrix(facilityStudy);
  const facilityResult = { schemaVersion: Facility.RESULT_SCHEMA, requestId: "TEST-REQUEST", studyHash: facilityStudy.studyHash, engine: { id: "OR_TOOLS_CP_SAT", version: "synthetic-test", workers: 1, randomSeed: 1909 }, currentBaseline: null, results: [{ status: "OPTIMAL", facilityCount: 1, rank: 1, selectedSiteIds: ["S"], assignments: [{ demandId: "D", siteId: "S", distanceMeters: 0, travelSeconds: 0 }], serviceRate: 1, cost: { total: 0, fixed: 0, handling: 0, transport: 0, currency: "CNY", period: "P1" }, objectiveValue: 0, bestBound: 0 }] };
  // A Python solver hash need not equal a JS hash after JSON parses 1.0 as 1.
  facilityResult.resultSetHash = `sha256:${"1".repeat(64)}`;
  assert.notEqual(facilityResult.resultSetHash, Facility.hash(facilityResult, "resultSetHash"));
  const facilityVerification = Facility.verifyResult(facilityStudy, facilityMatrix, facilityResult);
  assert.equal(facilityVerification.status, "PASS");
  const facilityPointer = { id: `FACILITY:${facilityStudy.studyHash}`, scope: "DESIGN", type: "FACILITY_STUDY", name: facilityStudy.name, studyId: facilityStudy.studyId, inputHash: facilityStudy.studyHash, verification: "PASS", route: "/design/facility-location", refs: [{ store: "facilityStudies", id: facilityStudy.studyHash }, { store: "facilityMatrices", id: facilityMatrix.matrixHash }, { store: "facilityResults", id: facilityResult.resultSetHash }, { store: "facilityVerifications", id: facilityVerification.verificationHash }] };
  const facilityRecords = { facilityStudies: [repository.record(facilityStudy.studyHash, facilityStudy)], facilityMatrices: [repository.record(facilityMatrix.matrixHash, facilityMatrix)], facilityResults: [repository.record(facilityResult.resultSetHash, facilityResult)], facilityVerifications: [repository.record(facilityVerification.verificationHash, facilityVerification)] };
  const facilityRepo = memoryRepository(), facilityContext = Context.createContext({ studyKind: "SUPPLY_CHAIN_PERIOD", studyId: "OTHER" });
  await facilityRepo.commit({ records: facilityRecords, pointer: facilityPointer, expectedRevision: 0 });
  facilityRepo.seed({ ...(await facilityRepo.read("pointers", facilityPointer.id)), savedAt: "2026-09-27T00:00:00Z" });
  const facilityController = Facility.createController({ repository: facilityRepo });
  const facilityRegistry = Registry.createRegistry({ repository: facilityRepo, legacyService, facilityController, designAdapter, context: facilityContext });
  assert.equal(facilityRegistry.capabilities("FACILITY").canExportPackage, true);
  assert.equal(facilityRegistry.capabilities("FACILITY").canImportPackage, true);
  const facilityBefore = facilityContext.snapshot();
  const facilityPackage = await facilityRegistry.exportPackage(facilityPointer.id);
  assert.equal(JSON.parse(facilityPackage).pointer.revision, undefined);
  assert.equal(JSON.parse(facilityPackage).pointer.savedAt, undefined);
  assert.equal(facilityContext.snapshot().current.studyId, facilityBefore.current.studyId);
  assert.equal(facilityRegistry.inspectPackage(facilityPackage).kind, "FACILITY");
  const facilityFreshRepo = memoryRepository(), facilityFreshContext = Context.createContext();
  const facilityFresh = Registry.createRegistry({ repository: facilityFreshRepo, legacyService, facilityController: Facility.createController({ repository: facilityFreshRepo }), designAdapter, context: facilityFreshContext });
  assert.equal((await facilityFresh.importPackage(facilityPackage)).status, "SAVED");
  assert.equal(facilityFreshContext.snapshot().current.studyId, "FACILITY-A");
  assert.equal((await facilityFresh.exportPackage(facilityPointer.id)), facilityPackage);
  assert.equal((await facilityFresh.importPackage(facilityPackage)).status, "DUPLICATE");
  const importedFacilityPointer = await facilityFreshRepo.read("pointers", facilityPointer.id);
  facilityFreshRepo.seed({ ...importedFacilityPointer, inputHash: "sha256:other" });
  await assert.rejects(facilityFresh.importPackage(facilityPackage), { code: "PACKAGE_CATALOG_ID_COLLISION" });
  facilityFreshRepo.seed(importedFacilityPointer);
  const facilityCorruptHash = JSON.parse(facilityPackage); facilityCorruptHash.records.facilityResults[0].payload.results[0].cost.total = 1;
  assert.throws(() => facilityFresh.inspectPackage(facilityCorruptHash), { code: "FACILITY_PACKAGE_INVALID" });
  const forgedResult = facilityCorruptHash.records.facilityResults[0];
  forgedResult.payload.resultSetHash = Facility.hash(forgedResult.payload, "resultSetHash");
  forgedResult.id = forgedResult.payload.resultSetHash;
  forgedResult.contentHash = Facility.hash(forgedResult.payload);
  facilityCorruptHash.pointer.refs.find((ref) => ref.store === "facilityResults").id = forgedResult.id;
  const forgedVerification = facilityCorruptHash.records.facilityVerifications[0];
  forgedVerification.payload.resultSetHash = forgedResult.id;
  forgedVerification.payload.verificationHash = Facility.hash(forgedVerification.payload, "verificationHash");
  forgedVerification.id = forgedVerification.payload.verificationHash;
  forgedVerification.contentHash = Facility.hash(forgedVerification.payload);
  facilityCorruptHash.pointer.refs.find((ref) => ref.store === "facilityVerifications").id = forgedVerification.id;
  facilityCorruptHash.packageHash = Facility.hash(Object.fromEntries(Object.entries(facilityCorruptHash).filter(([key]) => key !== "packageHash")));
  assert.throws(() => facilityFresh.inspectPackage(facilityCorruptHash), { code: "FACILITY_PACKAGE_RESULT_INVALID" });
  await assert.rejects(facilityFresh.importPackage(facilityCorruptHash), { code: "FACILITY_PACKAGE_RESULT_INVALID" });
  const facilityCollision = JSON.parse(facilityPackage); facilityCollision.pointer.name = "Conflicting metadata";
  facilityCollision.pointer.refs[2].id = "sha256:other";
  facilityCollision.packageHash = Facility.hash(Object.fromEntries(Object.entries(facilityCollision).filter(([key]) => key !== "packageHash")));
  assert.throws(() => facilityFresh.inspectPackage(facilityCollision), { code: "FACILITY_PACKAGE_GRAPH_INVALID" });

  const raceRepo = memoryRepository(), raceContext = Context.createContext({ studyKind: "NETWORK_ORDERS", studyId: "DEMO-A" });
  raceRepo.seed({ id: "SUPPLY:RACE", type: "SUPPLY_CHAIN_STUDY", refs: [{ store: "supplyStudies", id: "HASH" }] });
  let finishOpen;
  const raceSupply = { reopen: () => new Promise((resolve) => { finishOpen = resolve; }) };
  const racing = Registry.createRegistry({ repository: raceRepo, legacyService, supplyController: raceSupply, designAdapter, context: raceContext });
  const lateOpen = racing.open("SUPPLY:RACE");
  while (!finishOpen) await new Promise((resolve) => setImmediate(resolve));
  raceContext.select({ studyKind: "NETWORK_ORDERS", studyId: "DEMO-B" });
  finishOpen({ study: { studyId: "RACE", inputHash: "HASH" }, snapshot: null });
  assert.equal((await lateOpen).status, "SUPERSEDED");
  assert.equal(raceContext.snapshot().current.studyId, "DEMO-B");
  assert.deepEqual(registry.capabilities("OPERATIONS_PLAN").canOpen, false);
  const validationPointer = { id: "VALIDATION:SYNTHETIC", type: "OPERATIONAL_VALIDATION", refs: [] };
  repository.seed(validationPointer);
  const beforeValidationExport = context.snapshot();
  assert.equal(registry.kindForPointer(validationPointer), null, "validation is an attachment, not an editable supply study");
  assert.deepEqual(await registry.exportPackage(validationPointer.id), { exported: [validationPointer.id] });
  assert.deepEqual(context.snapshot(), beforeValidationExport);
  const refusedExport = Registry.createRegistry({ repository, legacyService: { ...legacyService, exportPackage: async () => { throw Object.assign(new Error("DEPENDENCY_MISSING"), { code: "DEPENDENCY_MISSING" }); } }, context });
  await assert.rejects(refusedExport.exportPackage(validationPointer.id), { code: "DEPENDENCY_MISSING" });
  console.log(JSON.stringify({ status: "PASS", test: "platform-study-kind-registry-v8", method: "SYNTHETIC_PUBLIC_CONTROLLER_NO_SOLVER", typedOpen: true, packageIntegrity: true, nonCurrentCatalogExport: true, facilityPackage: true, copyPreservesOriginal: true, noImplicitDemo: true }));
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
