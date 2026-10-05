(function (root, factory) {
  "use strict";
  const ns = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const api = factory(typeof module === "object" && module.exports ? {
    Import: require("./platform-import-session-v19.js"),
    Design: require("./supply-chain-design-v19.js"),
    Report: require("./supply-chain-report-v19.js"),
    V5: require("./supply-chain-v5-results-v19.js"),
    Facility: require("./facility-location-mvp1-v19.js"),
  } : { Import: ns.importSession, Design: ns.supplyChainDesign, Report: ns.supplyChainReport, V5: ns.supplyChainV5Results, Facility: ns.facilityLocationMvp1 });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root.document) ns.studyKindRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (dependencies) {
  "use strict";
  const { Import, Design, Report, V5, Facility } = dependencies;

  const KIND_BY_TYPE = Object.freeze({
    SUPPLY_CHAIN_STUDY: "SUPPLY_CHAIN_PERIOD",
    FACILITY_STUDY: "FACILITY",
    DESIGN_STUDY: "NETWORK_ORDERS",
    DESIGN_PORTFOLIO: "NETWORK_ORDERS",
    BASELINE: "NETWORK_ORDERS",
    COMMAND_PLAN: "OPERATIONS_PLAN",
    COMMAND_EXECUTION: "OPERATIONS_PLAN",
  });
  const ROUTE_BY_KIND = Object.freeze({ SUPPLY_CHAIN_PERIOD: "/design/supply-chain-study", FACILITY: "/design/facility-location", NETWORK_ORDERS: "/design/network-scenarios", OPERATIONS_PLAN: "/command/overview" });
  const DESIGN_ROUTES = Object.freeze(["/design/overview", "/design/facility-location", "/design/supply-chain-study", "/design/network-scenarios", "/design/fleet-capacity", "/design/cost-to-serve", "/design/demand-growth", "/design/resilience", "/design/operational-validation"]);
  const SUPPLY_VIEWS = new Set(["/design/overview", "/design/supply-chain-study", "/design/network-scenarios", "/design/fleet-capacity", "/design/cost-to-serve", "/design/demand-growth", "/design/resilience"]);
  function routeCapability(kind, route) {
    if (!DESIGN_ROUTES.includes(route)) return { status: "NOT_IMPLEMENTED", reason: "DESIGN_ROUTE_UNKNOWN" };
    if (!kind) return route === "/design/supply-chain-study" ? { status: "APPLICABLE_WRITABLE", reason: null } : { status: "NEEDS_INPUT", reason: "SELECT_STUDY_REQUIRED" };
    if (kind === "SUPPLY_CHAIN_PERIOD") return SUPPLY_VIEWS.has(route)
      ? { status: route === "/design/supply-chain-study" || route === "/design/demand-growth" ? "APPLICABLE_WRITABLE" : "APPLICABLE_READ_ONLY", reason: null }
      : { status: "NOT_APPLICABLE", reason: route === "/design/operational-validation" ? "PERIOD_DEMAND_IS_NOT_DISPATCH_ORDERS" : "USE_SUPPLY_NETWORK_ANALYSIS" };
    if (kind === "FACILITY") return ["/design/overview", "/design/facility-location", "/design/cost-to-serve"].includes(route)
      ? { status: route === "/design/facility-location" ? "APPLICABLE_WRITABLE" : "APPLICABLE_READ_ONLY", reason: null }
      : { status: "NOT_APPLICABLE", reason: route === "/design/operational-validation" ? "FACILITY_REQUIRES_EXPLICIT_OPERATIONAL_BRIDGE" : "FACILITY_HAS_NO_PERIOD_ORDERS" };
    if (kind === "NETWORK_ORDERS") return { status: route === "/design/supply-chain-study" ? "NOT_APPLICABLE" : route === "/design/facility-location" ? "NEEDS_INPUT" : "APPLICABLE_WRITABLE", reason: route === "/design/facility-location" ? "EXPLICIT_FACILITY_DERIVATION_REQUIRED" : route === "/design/supply-chain-study" ? "USE_PERIOD_DEMAND_STUDY" : null };
    return { status: "NOT_APPLICABLE", reason: "USE_COMMAND_WORKSPACE" };
  }
  const REQUIRED_REF = Object.freeze({ SUPPLY_CHAIN_PERIOD: "supplyStudies", FACILITY: "facilityStudies", NETWORK_ORDERS: "studyVersions" });
  const FACILITY_PACKAGE_SCHEMA = "stct-facility-study-package-v8";
  const FACILITY_STORES = Object.freeze(["facilityStudies", "facilityMatrices", "facilityResults", "facilityVerifications"]);
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const kindForPointer = (pointer) => pointer && KIND_BY_TYPE[pointer.type] || null;

  function inspectSupply(input) {
    const value = typeof input === "string" ? Import.parseJson(input, 128 * 1024 * 1024) : Import.safe(structuredClone(input));
    if (value?.schemaVersion !== "stct-supply-chain-package-v1.9" || !value.study || !value.snapshot) fail("SUPPLY_PACKAGE_INVALID");
    const { packageHash, ...payload } = value;
    if (packageHash !== Design.hash(payload)) fail("SUPPLY_PACKAGE_INVALID");
    const study = Design.createStudy(value.study);
    (value.snapshot.schemaVersion === "stct-supply-chain-v5-snapshot-v1" ? V5 : Report).assertCurrent(study, value.snapshot);
    return { status: "READY", businessVerification: "PASS", kind: "SUPPLY_CHAIN_PERIOD", payload: value };
  }

  function inspectFacility(input) {
    const value = typeof input === "string" ? Import.parseJson(input, 128 * 1024 * 1024) : Import.safe(structuredClone(input));
    if (value?.schemaVersion !== FACILITY_PACKAGE_SCHEMA || !value.pointer || !value.records ||
        Object.keys(value.records).sort().join("|") !== [...FACILITY_STORES].sort().join("|")) fail("FACILITY_PACKAGE_INVALID");
    const { packageHash, ...payload } = value;
    if (packageHash !== Facility.hash(payload)) fail("FACILITY_PACKAGE_INVALID");
    const pointer = value.pointer, records = value.records, refs = pointer.refs || [];
    if (pointer.type !== "FACILITY_STUDY" || pointer.verification !== "PASS" || refs.length !== FACILITY_STORES.length || pointer.bindingRefs?.length) fail("FACILITY_PACKAGE_GRAPH_INVALID");
    const byStore = {};
    for (const store of FACILITY_STORES) {
      const row = records[store]?.[0], ref = refs.find((entry) => entry.store === store);
      if (records[store]?.length !== 1 || refs.filter((entry) => entry.store === store).length !== 1 || !row || !ref ||
          ref.id !== row.id || row.contentHash !== Facility.hash(row.payload) || row.refs?.length) fail("FACILITY_PACKAGE_GRAPH_INVALID");
      byStore[store] = row;
    }
    const study = byStore.facilityStudies.payload, matrix = byStore.facilityMatrices.payload;
    const resultSet = byStore.facilityResults.payload, verification = byStore.facilityVerifications.payload;
    if (Facility.normalizeStudy(study).studyHash !== study.studyHash ||
        Facility.hash(matrix, "matrixHash") !== matrix.matrixHash ||
        !/^sha256:[a-f0-9]{64}$/.test(resultSet.resultSetHash || "") ||
        byStore.facilityStudies.id !== study.studyHash || byStore.facilityMatrices.id !== matrix.matrixHash ||
        byStore.facilityResults.id !== resultSet.resultSetHash || byStore.facilityVerifications.id !== verification.verificationHash ||
        pointer.id !== `FACILITY:${study.studyHash}` || pointer.studyId !== study.studyId || pointer.inputHash !== study.studyHash) fail("FACILITY_PACKAGE_GRAPH_INVALID");
    const checked = Facility.verifyResult(study, matrix, resultSet);
    if (checked.status !== "PASS" || Facility.hash(checked) !== Facility.hash(verification)) fail("FACILITY_PACKAGE_RESULT_INVALID");
    return { status: "READY", businessVerification: "PASS", kind: "FACILITY", payload: value };
  }

  function createRegistry({ repository, legacyService, supplyController, facilityController, designAdapter, context }) {
    if (!repository || !legacyService || !context) fail("STUDY_REGISTRY_DEPENDENCY_REQUIRED");
    function capabilities(kind) {
      if (!ROUTE_BY_KIND[kind]) fail("STUDY_KIND_UNSUPPORTED");
      const canOpen = kind === "SUPPLY_CHAIN_PERIOD" ? Boolean(supplyController?.reopen) : kind === "FACILITY" ? Boolean(facilityController?.reopen) : kind === "NETWORK_ORDERS" ? Boolean(legacyService.openStudy && designAdapter?.adoptStudy) : false;
      const canSave = kind === "SUPPLY_CHAIN_PERIOD" ? Boolean(supplyController?.save) : kind === "FACILITY" ? Boolean(facilityController?.save) : kind === "NETWORK_ORDERS" ? Boolean(legacyService.saveStudy && designAdapter?.hasStudy) : false;
      const canExportPackage = kind === "SUPPLY_CHAIN_PERIOD" ? Boolean(supplyController?.exportPackage) : kind === "FACILITY" ? Boolean(repository.read && legacyService.exportPackage) : kind !== "OPERATIONS_PLAN" && Boolean(legacyService.exportPackage);
      const canImportPackage = kind === "SUPPLY_CHAIN_PERIOD" ? Boolean(supplyController?.importPackage) : kind === "FACILITY" ? Boolean(repository.commit && facilityController?.reopen) : Boolean(legacyService.importPackage);
      return Object.freeze({ kind, route: ROUTE_BY_KIND[kind], canOpen, canSave, canExportPackage, canImportPackage, costView: ["SUPPLY_CHAIN_PERIOD", "NETWORK_ORDERS"].includes(kind), demandGrowth: ["SUPPLY_CHAIN_PERIOD", "NETWORK_ORDERS"].includes(kind), reason: kind === "OPERATIONS_PLAN" ? "USE_COMMAND_WORKSPACE" : canOpen ? null : "STUDY_HANDLER_UNAVAILABLE" });
    }
    async function pointer(id) {
      const row = await repository.read("pointers", id);
      if (!row) fail("CATALOG_ENTRY_NOT_FOUND");
      return row;
    }
    function assertGraph(row, kind) {
      const required = REQUIRED_REF[kind];
      if (required && !row.refs?.some((ref) => ref.store === required && typeof ref.id === "string" && ref.id)) fail("STUDY_POINTER_GRAPH_INVALID");
    }
    function identity(kind, row, value) {
      const study = value.study || value;
      const snapshot = value.snapshot || value.resultSet || null;
      const legacy = value.store?.snapshot?.();
      const source = legacy || {};
      const studyId = study.studyId || source.studyId || row?.studyId || (kind === "SUPPLY_CHAIN_PERIOD" ? row?.id?.replace(/^SUPPLY:/, "") : null);
      return {
        studyKind: kind,
        studyId,
        projectId: row?.projectId || study.projectId || (studyId ? `PROJECT:${studyId}` : null),
        datasetVersion: row?.datasetVersionId || source.dataSource?.sourceRef || (kind === "SUPPLY_CHAIN_PERIOD" ? study.inputHash : null),
        scenarioId: source.activeScenarioId || snapshot?.scenario?.scenarioId || value.scenario?.scenarioId || row?.scenarioId || null,
        runId: value.job?.jobId || null,
        inputHash: study.inputHash || study.studyHash || source.activeInputHash || row?.inputHash || null,
        resultHash: snapshot?.snapshotHash || snapshot?.resultSetHash || source.evaluation?.artifactHash || row?.snapshotHash || null,
        classification: study.classification || study.dataClassification || source.dataSource?.dataClassification || null,
        backendIdentity: kind === "SUPPLY_CHAIN_PERIOD" ? snapshot?.backendIdentity || null : value.backendIdentity || null,
      };
    }
    function active(kind) {
      if (kind === "SUPPLY_CHAIN_PERIOD") return supplyController?.snapshot();
      if (kind === "FACILITY") return facilityController?.snapshot();
      if (kind === "NETWORK_ORDERS") {
        if (!designAdapter?.hasStudy?.()) fail("CURRENT_STUDY_NOT_LOADED");
        return { store: designAdapter.createStrategicStudy() };
      }
      fail("STUDY_KIND_NOT_OPENABLE");
    }
    function sameStudy(kind, value, selected) {
      const actual = identity(kind, null, value);
      if (actual.studyId !== selected?.studyId || selected.inputHash && actual.inputHash !== selected.inputHash) fail("CURRENT_STUDY_MISMATCH");
      return actual;
    }
    async function list() {
      return (await repository.list("pointers")).map((row) => {
        const studyKind = kindForPointer(row);
        return { ...row, studyKind, openable: Boolean(studyKind && capabilities(studyKind).canOpen && (!REQUIRED_REF[studyKind] || row.refs?.some((ref) => ref.store === REQUIRED_REF[studyKind]))) };
      });
    }
    async function open(pointerId) {
      const row = await pointer(pointerId), kind = kindForPointer(row);
      if (!kind || !capabilities(kind).canOpen) fail("STUDY_KIND_NOT_OPENABLE");
      assertGraph(row, kind);
      const ticket = context.beginSelection();
      try {
        let value;
        if (kind === "SUPPLY_CHAIN_PERIOD") value = await supplyController.reopen(pointerId);
        else if (kind === "FACILITY") value = await facilityController.reopen(pointerId, () => context.snapshot().generation === ticket.generation && context.snapshot().pending);
        else value = await legacyService.openStudy(pointerId);
        if (context.snapshot().generation !== ticket.generation || !context.snapshot().pending) return { status: "SUPERSEDED", code: "STUDY_SELECTION_SUPERSEDED" };
        if (kind === "NETWORK_ORDERS") designAdapter.adoptStudy(value.store, { selectContext: false });
        const selected = context.completeSelection(ticket, identity(kind, row, value));
        if (!selected.ok) return { status: "SUPERSEDED", code: selected.code };
        if (kind === "SUPPLY_CHAIN_PERIOD") designAdapter?.hydrateSupplyView?.();
        if (kind === "FACILITY") designAdapter?.hydrateFacility?.(row);
        return { status: "OPENED", pointer: row, kind, current: selected.snapshot.current };
      } catch (error) {
        context.abortSelection(ticket);
        throw error;
      }
    }
    function inspectPackage(input) {
      const parsed = typeof input === "string" ? Import.parseJson(input, 128 * 1024 * 1024) : Import.safe(structuredClone(input));
      if (parsed?.schemaVersion === "stct-supply-chain-package-v1.9") return inspectSupply(parsed);
      if (parsed?.schemaVersion === FACILITY_PACKAGE_SCHEMA) return inspectFacility(parsed);
      const result = legacyService.inspectPackage(parsed);
      return { ...result, kinds: [...new Set((result.payload?.pointers || []).map(kindForPointer).filter(Boolean))] };
    }
    async function importPackage(input) {
      const inspected = inspectPackage(input);
      if (inspected.status !== "READY") return inspected;
      if (inspected.kind === "FACILITY") {
        if (!facilityController?.reopen) fail("STUDY_KIND_NOT_OPENABLE");
        const incoming = inspected.payload, existing = await repository.read("pointers", incoming.pointer.id);
        if (existing) {
          const refId = (row, store) => row.refs?.find((ref) => ref.store === store)?.id;
          if (existing.type !== "FACILITY_STUDY" || existing.inputHash !== incoming.pointer.inputHash ||
              existing.studyId !== incoming.pointer.studyId || existing.verification !== "PASS" ||
              FACILITY_STORES.some((store) => refId(existing, store) !== refId(incoming.pointer, store))) fail("PACKAGE_CATALOG_ID_COLLISION");
          return { status: "DUPLICATE", pointer: existing };
        }
        const ticket = context.beginSelection();
        try {
          const saved = await repository.commit({ records: incoming.records, pointer: incoming.pointer, expectedRevision: 0, action: "IMPORT_FACILITY_PACKAGE" });
          if (context.snapshot().generation !== ticket.generation || !context.snapshot().pending) return { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
          const value = await facilityController.reopen(saved.pointer.id, () => context.snapshot().generation === ticket.generation && context.snapshot().pending);
          if (context.snapshot().generation !== ticket.generation || !context.snapshot().pending) return { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
          const selected = context.completeSelection(ticket, identity("FACILITY", saved.pointer, value));
          if (selected.ok) designAdapter?.hydrateFacility?.(saved.pointer);
          return selected.ok ? { status: "SAVED", pointer: saved.pointer, current: selected.snapshot.current } : { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
        } catch (error) {
          context.abortSelection(ticket);
          throw error;
        }
      }
      if (inspected.kind !== "SUPPLY_CHAIN_PERIOD") return legacyService.importPackage(inspected.payload);
      if (!supplyController) fail("STUDY_KIND_NOT_OPENABLE");
      const existing = await repository.read("pointers", `SUPPLY:${inspected.payload.study.studyId}`);
      if (existing) {
        if (existing.type !== "SUPPLY_CHAIN_STUDY" || existing.inputHash !== inspected.payload.study.inputHash || existing.snapshotHash !== inspected.payload.snapshot.snapshotHash) fail("PACKAGE_CATALOG_ID_COLLISION");
        return { status: "DUPLICATE", pointer: existing };
      }
      const ticket = context.beginSelection();
      try {
        supplyController.importPackage(inspected.payload);
        const saved = await supplyController.save();
        if (context.snapshot().generation !== ticket.generation || !context.snapshot().pending) return { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
        const selected = context.completeSelection(ticket, identity("SUPPLY_CHAIN_PERIOD", saved.pointer, supplyController.snapshot()));
        if (!selected.ok) return { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
        designAdapter?.hydrateSupplyView?.();
        return { status: "SAVED", pointer: saved.pointer, current: selected.snapshot.current };
      } catch (error) {
        context.abortSelection(ticket);
        throw error;
      }
    }
    async function saveCurrent(options = {}) {
      const selected = context.snapshot().current;
      if (!selected) fail("CURRENT_STUDY_REQUIRED");
      const kind = selected.studyKind, value = active(kind);
      sameStudy(kind, value, selected);
      const generation = context.snapshot().generation;
      let saved;
      if (kind === "SUPPLY_CHAIN_PERIOD") saved = await supplyController.save();
      else if (kind === "FACILITY") {
        const existing = await repository.read("pointers", `FACILITY:${selected.inputHash}`);
        saved = await facilityController.save(options.expectedRevision ?? existing?.revision ?? 0);
        designAdapter?.hydrateFacility?.(saved.pointer);
      }
      else saved = await legacyService.saveStudy(value.store, options);
      if (context.snapshot().generation === generation) context.select(identity(kind, saved.pointer, active(kind)));
      return saved;
    }
    async function copyCurrent(name) {
      const selected = context.snapshot().current;
      if (!selected) fail("CURRENT_STUDY_REQUIRED");
      if (selected.studyKind !== "SUPPLY_CHAIN_PERIOD") fail("STUDY_COPY_UNSUPPORTED");
      const current = active(selected.studyKind);
      sameStudy(selected.studyKind, current, selected);
      const title = String(name || `${current.study.name} (copy)`).trim();
      if (!title || title.length > 200) fail("STUDY_COPY_NAME_INVALID");
      const ticket = context.beginSelection();
      let originalPointer = current.savedPointer;
      try {
        if (!originalPointer || originalPointer.inputHash !== current.study.inputHash) originalPointer = (await supplyController.save()).pointer;
        if (context.snapshot().generation !== ticket.generation || !context.snapshot().pending) return { status: "SUPERSEDED", code: "STUDY_SELECTION_SUPERSEDED" };
        supplyController.updateStudy({ studyId: `SUPPLY-${globalThis.crypto.randomUUID()}`, name: title });
        const saved = await supplyController.save();
        if (context.snapshot().generation !== ticket.generation || !context.snapshot().pending) return { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
        const next = identity("SUPPLY_CHAIN_PERIOD", { ...saved.pointer, projectId: selected.projectId }, supplyController.snapshot());
        const selectedCopy = context.completeSelection(ticket, next);
        if (!selectedCopy.ok) return { status: "SAVED_NOT_CURRENT", pointer: saved.pointer };
        designAdapter?.hydrateSupplyView?.();
        return { status: "SAVED", originalPointer, pointer: saved.pointer, current: selectedCopy.snapshot.current };
      } catch (error) {
        if (context.snapshot().generation === ticket.generation && context.snapshot().pending && originalPointer?.id) await supplyController.reopen(originalPointer.id).catch(() => {});
        context.abortSelection(ticket);
        throw error;
      }
    }
    async function exportSavedSupply(row) {
      const ref = (store) => row.refs?.find((entry) => entry.store === store)?.id;
      const studyId = ref("supplyStudies"), snapshotId = ref("supplySnapshots"), profileId = ref("supplyProfiles");
      if (!row.snapshotHash) fail("SUPPLY_SNAPSHOT_NOT_READY");
      if (studyId !== row.inputHash || snapshotId !== row.snapshotHash) fail("SUPPLY_SAVED_GRAPH_INVALID");
      const [studyRecord, snapshotRecord, profileRecord] = await Promise.all([
        repository.read("supplyStudies", studyId),
        repository.read("supplySnapshots", snapshotId),
        profileId ? repository.read("supplyProfiles", profileId) : null,
      ]);
      if (!studyRecord || !snapshotRecord || profileId && !profileRecord ||
          studyRecord.contentHash !== Design.hash(studyRecord.payload) ||
          snapshotRecord.contentHash !== Design.hash(snapshotRecord.payload) ||
          profileRecord && profileRecord.contentHash !== Design.hash(profileRecord.payload)) fail("SUPPLY_SAVED_GRAPH_INVALID");
      const study = Design.createStudy(studyRecord.payload), snapshot = snapshotRecord.payload;
      if (row.id !== `SUPPLY:${study.studyId}` || row.inputHash !== study.inputHash || row.snapshotHash !== snapshot.snapshotHash) fail("SUPPLY_SAVED_GRAPH_INVALID");
      (snapshot.schemaVersion === "stct-supply-chain-v5-snapshot-v1" ? V5 : Report).assertCurrent(study, snapshot);
      const value = { schemaVersion: "stct-supply-chain-package-v1.9", study, profile: profileRecord?.payload || null, snapshot };
      value.packageHash = Design.hash(value);
      return JSON.stringify(value, null, 2) + "\n";
    }
    async function exportSavedFacility(row) {
      if (row.bindingRefs?.length) return legacyService.exportPackage([row.id]);
      const records = {};
      for (const store of FACILITY_STORES) {
        const id = row.refs?.find((ref) => ref.store === store)?.id;
        records[store] = [id ? await repository.read(store, id) : null];
      }
      const { revision, savedAt, ...pointerValue } = row;
      const value = { schemaVersion: FACILITY_PACKAGE_SCHEMA, pointer: pointerValue, records };
      value.packageHash = Facility.hash(value);
      inspectFacility(value);
      return JSON.stringify(value, null, 2) + "\n";
    }
    async function exportPackage(pointerId = null) {
      const selected = context.snapshot().current;
      if (!pointerId && !selected) fail("CURRENT_STUDY_REQUIRED");
      const row = pointerId ? await pointer(pointerId) : null;
      if (row?.type === "OPERATIONAL_VALIDATION") return legacyService.exportPackage([pointerId]);
      const kind = row ? kindForPointer(row) : selected.studyKind;
      if (!kind || !capabilities(kind).canExportPackage) fail("STUDY_KIND_NOT_EXPORTABLE");
      if (row) assertGraph(row, kind);
      if (kind === "SUPPLY_CHAIN_PERIOD") {
        if (row) return exportSavedSupply(row);
        if (!selected || selected.studyKind !== kind) fail("CURRENT_STUDY_MISMATCH");
        const value = active(kind);
        sameStudy(kind, value, selected);
        if (row && (row.id !== `SUPPLY:${value.study.studyId}` || row.inputHash !== value.study.inputHash || row.snapshotHash !== value.snapshot?.snapshotHash)) fail("CURRENT_STUDY_MISMATCH");
        return supplyController.exportPackage();
      }
      if (kind === "FACILITY") {
        if (row) return exportSavedFacility(row);
        const value = active(kind);
        sameStudy(kind, value, selected);
        const saved = await repository.read("pointers", `FACILITY:${selected.inputHash}`);
        if (!saved) fail("STUDY_NOT_SAVED");
        if (saved.refs?.find((ref) => ref.store === "facilityResults")?.id !== value.resultSet?.resultSetHash) fail("CURRENT_STUDY_MISMATCH");
        return exportSavedFacility(saved);
      }
      if (!pointerId) fail("STUDY_NOT_SAVED");
      return legacyService.exportPackage([pointerId]);
    }
    async function metadata(id, patch, expectedRevision) {
      await pointer(id);
      return legacyService.metadata(id, patch, expectedRevision);
    }
    return Object.freeze({ list, kindForPointer, open, inspectPackage, importPackage, exportPackage, saveCurrent, copyCurrent, metadata, capabilities });
  }

  return Object.freeze({ KIND_BY_TYPE, DESIGN_ROUTES, routeCapability, kindForPointer, createRegistry });
});
