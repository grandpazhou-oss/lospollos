#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Trace = require("../traceability-v18.js");
const Contract = require("../network-contract-v18.js");
const Assignment = require("../depot-assignment-v18.js");
const Trip = require("../trip-chain-v18.js");
const Custody = require("../pickup-custody-v18.js");
const DockWave = require("../dock-wave-v18.js");
const Network = require("../network-solver-v18.js");
const Accounting = require("../network-accounting-v18.js");
const Scenario = require("../scenario-lab-v18.js");
const Execution = require("../network-execution-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const repo = path.resolve(__dirname, "..");
const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || "/tmp/lospollos-v1.8-overnight-20260904_012216");
const registryPath = "/Users/gz/Downloads/STCT_v1.8_OVERNIGHT_MARATHON_TASK_PACKAGE/STCT_v1.8_OVERNIGHT_Requirement_Registry.json";
const goalPath = "/Users/gz/Downloads/STCT_v1.8_OVERNIGHT_MARATHON_TASK_PACKAGE/Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md";
const outputDir = path.join(runDir, "evidence/traceability-v18");
const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : path.join(runDir, "evidence/wave-h5-traceability-security.json"));
const assertions = [];
const clone = (value) => structuredClone(value);
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_traceability_security_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function errorCode(operation) { try { operation(); return "NO_ERROR"; } catch (error) { return error.code || error.name; } }
function readPriorResults() {
  const directory = path.join(runDir, "evidence"); const files = fs.readdirSync(directory).filter((file) => /^wave-h4-.*-regression\.json$/.test(file)).sort();
  return { files, results: files.flatMap((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")).assertions || []) };
}

fs.mkdirSync(outputDir, { recursive: true });
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")); const goalMarkdown = fs.readFileSync(goalPath, "utf8"); const official = Trace.validateOfficialRegistry(registry); const prior = readPriorResults(); const catalog = Trace.buildCatalog(registry, goalMarkdown, prior.results); const resultValidation = Trace.validateResults(catalog, prior.results, [], { root: repo });
const completedCore = catalog.requirements.filter((row) => /^T\d{4}$/.test(row.id) && Number(row.id.slice(1)) <= 845); const p0Rows = completedCore.filter((row) => row.risk === "P0");
check("T0846", official.status === "PASS" && registry.schemaVersion === "stct-requirements-registry-v1" && official.counts.total === 2819, official, "official registry schema and counts");
check("T0847", official.uniqueCount === 2819 && official.missing.length === 0 && official.extra.length === 0, official.uniqueCount, 2819);
check("T0848", Trace.parseGoal(goalMarkdown).size === 1067 && completedCore.every((row) => /^Gate \d+$/.test(row.gate)), { parsed: Trace.parseGoal(goalMarkdown).size, gates: [...new Set(completedCore.map((row) => row.gate))] }, "all core requirements mapped to a Gate");
check("T0849", catalog.requirements.every((row) => ["P0", "P1"].includes(row.risk)), [...new Set(catalog.requirements.map((row) => row.risk))], ["P0", "P1"]);
check("T0850", prior.results.every((row) => fs.existsSync(path.resolve(repo, row.evidence))), prior.files.length, "all prior test files exist");
check("T0851", prior.results.length === 845 && prior.results.every((row) => /^T\d{4}-A\d+$/.test(row.assertionId)), prior.results.length, 845);
check("T0852", resultValidation.status === "PASS" && resultValidation.executedRequirements === 845, resultValidation, "all prior evidence exists");
check("T0853", p0Rows.length > 0 && p0Rows.every((row) => prior.results.some((result) => result.requirementId === row.id && result.negative === true && result.status === "PASS")), p0Rows.length, "every derived P0 has a passing negative test");
const gateCoverage = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`Gate ${index}`, completedCore.filter((row) => row.gate === `Gate ${index}` && row.assertionIds.length).length]));
check("T0854", Object.values(gateCoverage).every((count) => count > 0) && completedCore.some((row) => row.gate === "Gate 10" && row.testLayer === "E2E_BROWSER") && completedCore.some((row) => row.gate === "Gate 11" && row.testLayer === "PERFORMANCE"), gateCoverage, "completed hard gates have executable coverage and dedicated browser/performance E2E");
check("T0855", resultValidation.assertionCount === 845 && prior.results.every((row) => row.status === "PASS"), resultValidation.assertionCount, "845 assertions executed");
check("T0856", prior.results.every((row) => row.observed !== undefined && row.expected !== undefined), prior.results.length, "observed and expected recorded");
const lexical = Trace.lexicalCoverage("const claim = 'T0001';", []);
check("T0857", lexical.auxiliaryOnly && lexical.unexecuted.includes("T0001"), lexical, "lexical ID is auxiliary, not execution");
const comments = Trace.lexicalCoverage("// T0001\n/* T0002 */\nconst value = 'T0003';", []);
check("T0858", comments.lexical.length === 1 && comments.lexical[0] === "T0003", comments, "comment IDs not counted");
const duplicate = Trace.validateResults(catalog, [prior.results[0], prior.results[0]], [], { root: repo });
check("T0859", duplicate.warnings.some((row) => row.code === "ASSERTION_DUPLICATE_MAPPING"), duplicate.warnings, "duplicate mapping warning", true);
const missingEvidence = Trace.validateResults(catalog, [{ ...prior.results[0], evidence: "missing/evidence.json" }], [], { root: repo });
check("T0860", missingEvidence.errors.some((row) => row.code === "EVIDENCE_FILE_NOT_FOUND"), missingEvidence.errors, "missing evidence fails", true);
const hashMismatch = Trace.validateResults(catalog, [{ ...prior.results[0], evidenceHash: "0".repeat(64) }], [], { root: repo });
check("T0861", hashMismatch.errors.some((row) => row.code === "EVIDENCE_HASH_MISMATCH"), hashMismatch.errors, "evidence hash mismatch fails", true);
const skipNoReason = Trace.validateResults(catalog, [{ ...prior.results[0], status: "SKIPPED_DEPENDENCY" }], [], { root: repo });
check("T0862", skipNoReason.errors.some((row) => row.code === "SKIP_REASON_MISSING"), skipNoReason.errors, "skip reason required", true);
const falsePass = Trace.validateResults(catalog, [prior.results[0]], [{ command: "false", reportedStatus: "PASS", exitCode: 1 }], { root: repo });
check("T0863", falsePass.errors.some((row) => row.code === "PASS_WITH_NONZERO_EXIT"), falsePass.errors, "PASS with nonzero exit fails", true);

const mutationRows = [];
function mutation(id, name, killed, evidence) { const row = { id, name, status: killed ? "KILLED" : "SURVIVED", evidence }; mutationRows.push(row); return row; }
const assignmentSource = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 1 }); assignmentSource.orders[0].allowedDepotIds = ["D1"]; assignmentSource.orders[0].preferredDepotId = "D1"; const assignmentPlan = Assignment.assignDepots(assignmentSource); const invalidAssignment = clone(assignmentPlan); invalidAssignment.assignments[0].assignedDepotId = "D2"; const mEligibility = mutation("M-V18-01", "IGNORE_DEPOT_ELIGIBILITY", Assignment.verifyAssignment(assignmentSource, invalidAssignment).status === "FAIL", Assignment.verifyAssignment(assignmentSource, invalidAssignment).issues);
check("T0864", mEligibility.status === "KILLED", mEligibility, "KILLED", true);
const tripSource = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 6 }); tripSource.constraints.maxTripsPerVehicle = 3; tripSource.vehicles[0].maxTrips = 3; const tripPlan = Trip.planTrips(tripSource, { maxStopsPerTrip: 2, startTime: "08:00" }); const overlapTrip = clone(tripPlan); overlapTrip.trips[1].startMinute = overlapTrip.trips[0].startMinute; const mOverlap = mutation("M-V18-02", "ALLOW_TRIP_OVERLAP", Trip.verifyTripPlan(tripSource, overlapTrip).issues.includes("VEHICLE_TRIP_OVERLAP"), Trip.verifyTripPlan(tripSource, overlapTrip).issues);
check("T0865", mOverlap.status === "KILLED", mOverlap, "KILLED", true);
const breakSource = clone(tripSource); breakSource.drivers[0].requiredBreaks[0].triggerDrivingMinutes = 1; breakSource.drivers[0].requiredBreaks[0].earliestStart = "06:00"; breakSource.drivers[0].requiredBreaks[0].latestStart = "20:00"; const breakPlan = Trip.planTrips(breakSource, { maxStopsPerTrip: 2, startTime: "08:00" }); const noBreak = clone(breakPlan); noBreak.breakEvents = []; noBreak.timelineEvents = noBreak.timelineEvents.filter((row) => row.kind !== "BREAK"); noBreak.executionEvents = noBreak.executionEvents.filter((row) => row.kind !== "BREAK"); const mBreak = mutation("M-V18-03", "IGNORE_REQUIRED_BREAK", Trip.verifyTripPlan(breakSource, noBreak).issues.includes("REQUIRED_BREAK_MISSING"), Trip.verifyTripPlan(breakSource, noBreak).issues);
check("T0866", mBreak.status === "KILLED", mBreak, "KILLED", true);
const directSource = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 2, pickupDelivery: true }); const custodyPlan = Custody.planPickupDelivery(directSource); const deliveryFirst = clone(custodyPlan); const pickupEvent = deliveryFirst.shipments[0].events.find((row) => row.type === "PICKUP"); deliveryFirst.shipments[0].events.find((row) => row.type === "DELIVERY").startMinute = pickupEvent.startMinute - 1; const mPrecedence = mutation("M-V18-04", "DELIVERY_BEFORE_PICKUP", Custody.verifyPickupDelivery(directSource, deliveryFirst).issues.includes("DELIVERY_BEFORE_PICKUP"), Custody.verifyPickupDelivery(directSource, deliveryFirst).issues);
check("T0867", mPrecedence.status === "KILLED", mPrecedence, "KILLED", true);
const crossSource = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 2, pickupDelivery: true, crossDock: true }); crossSource.pickupDeliveryPairs[0].sameVehicleRequired = false; crossSource.pickupDeliveryPairs[0].sameTripRequired = false; crossSource.pickupDeliveryPairs[0].transferAllowed = true; const crossCustody = Custody.planPickupDelivery(crossSource, { crossDock: true }); const doubleCustody = clone(crossCustody); const duplicateOwner = clone(doubleCustody.custodyEvents[0]); duplicateOwner.custodyEventId = "DOUBLE-OWNER"; duplicateOwner.ownerId = "V2"; doubleCustody.custodyEvents.push(duplicateOwner); const mCustody = mutation("M-V18-05", "DOUBLE_CUSTODY", Custody.verifyPickupDelivery(crossSource, doubleCustody).issues.includes("DOUBLE_CUSTODY"), Custody.verifyPickupDelivery(crossSource, doubleCustody).issues);
check("T0868", mCustody.status === "KILLED", mCustody, "KILLED", true);
const dockSource = makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount: 8 }); const dockTrip = Trip.planTrips(dockSource, { maxStopsPerTrip: 2 }); const dockPlan = DockWave.scheduleDocks(dockSource, dockTrip); const overlapDock = clone(dockPlan); const sameDock = overlapDock.reservations.filter((row) => row.dockId === overlapDock.reservations[0].dockId).slice(0, 2); sameDock[1].startMinute = sameDock[0].startMinute; sameDock[1].endMinute = sameDock[0].endMinute; const mDock = mutation("M-V18-06", "IGNORE_DOCK_OVERLAP", DockWave.verifyDockSchedule(dockSource, dockTrip, overlapDock).issues.includes("DOCK_CAPACITY_EXCEEDED"), DockWave.verifyDockSchedule(dockSource, dockTrip, overlapDock).issues);
check("T0869", mDock.status === "KILLED", mDock, "KILLED", true);
const accountingSource = makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount: 8 }); const accountingPlan = Network.solveNetwork(accountingSource); const ledger = Accounting.computeAccounting(accountingSource, accountingPlan); const missingMetric = clone(ledger); delete missingMetric.cost.components.toll; const mMetric = mutation("M-V18-07", "MISSING_METRIC_AS_ZERO", Accounting.candidateEligibility(missingMetric).status === "EXCLUDED", Accounting.candidateEligibility(missingMetric).reasons);
check("T0870", mMetric.status === "KILLED", mMetric, "KILLED", true);
const scenarioBase = Scenario.baseline(accountingSource); const changedScenario = Scenario.applyShock(scenarioBase, "DEMAND_10"); const frontierMetrics = { service: 1, cost: 100, carbonKg: 10, vehicles: 2, trips: 2, dockCongestion: 0, emptyDistanceKm: 0, transferCount: 0, latestCompletion: 700, blockedCount: 0, serviceLayer: "SERVICE_FIRST" }; const mixedFrontier = Scenario.observedFrontier([{ scenarioId: "A", networkInputHash: scenarioBase.inputHash, metrics: frontierMetrics }, { scenarioId: "B", networkInputHash: changedScenario.inputHash, metrics: { ...frontierMetrics, cost: 90 } }]); const mFrontier = mutation("M-V18-08", "MIX_SCENARIO_FRONTIER", mixedFrontier.excluded === 1 && mixedFrontier.frontier.every((row) => row.networkInputHash === scenarioBase.inputHash), mixedFrontier);
check("T0871", mFrontier.status === "KILLED", mFrontier, "KILLED", true);
const executionRun = Execution.createRun(accountingSource, accountingPlan); Execution.appendEvent(executionRun, { eventType: "EVENT_ACKNOWLEDGED", logicalMinute: 1, payload: { marker: "history" } }); const executionCutoff = Execution.freezeCutoff(executionRun); const executionCandidates = Execution.generateRecoveryCandidates(executionRun, executionCutoff); const executionCapsule = Execution.createCapsule(executionRun, executionCutoff, executionCandidates); const historyMutation = clone(executionCapsule); historyMutation.events[0].payload.marker = "rewritten"; const mHistory = mutation("M-V18-09", "REMOVE_HISTORY_PIN", Execution.replay(historyMutation).status === "MISMATCH", Execution.replay(historyMutation));
check("T0872", mHistory.status === "KILLED", mHistory, "KILLED", true);
const repositionSource = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 4 }); repositionSource.vehicles[0].allowedStartDepotIds = ["D1", "D2"]; repositionSource.vehicles[0].maxTrips = 4; repositionSource.vehicles[1].availabilityWindows = []; repositionSource.constraints.maxTripsPerVehicle = 4; const repositionPlan = Network.solveNetwork(repositionSource, { maxStopsPerTrip: 1 }); const repositionLedger = Accounting.computeAccounting(repositionSource, repositionPlan); const zeroEmpty = clone(repositionLedger); zeroEmpty.cost.components.emptyReposition = 0; const mEmpty = mutation("M-V18-10", "ZERO_EMPTY_REPOSITION_COST", Accounting.verifyAccounting(repositionSource, repositionPlan, zeroEmpty).issues.includes("COST_LEDGER_MISMATCH"), Accounting.verifyAccounting(repositionSource, repositionPlan, zeroEmpty).issues);
check("T0873", mEmpty.status === "KILLED", mEmpty, "KILLED", true);

const pollutionScenario = JSON.parse(JSON.stringify(makeNetwork()).replace(/"policies":\{/, '"policies":{"__proto__":{"polluted":true},'));
check("T0874", errorCode(() => Contract.normalizeScenario(pollutionScenario)) === "NETWORK_DANGEROUS_KEY" && ({}).polluted === undefined, errorCode(() => Contract.normalizeScenario(pollutionScenario)), "prototype pollution rejected", true);
check("T0875", errorCode(() => Trace.safeParseJson('{"capsule":{"__proto__":{"polluted":true}}}')) === "PAYLOAD_DANGEROUS_KEY", "PAYLOAD_DANGEROUS_KEY", "capsule pollution rejected", true);
check("T0876", errorCode(() => Trace.safeParseJson('{"ui":{"constructor":{"prototype":{"polluted":true}}}}')) === "PAYLOAD_DANGEROUS_KEY", "PAYLOAD_DANGEROUS_KEY", "UI import pollution rejected", true);
const oversized = JSON.stringify({ payload: "x".repeat(Trace.LIMITS.maxBytes + 1) });
check("T0877", errorCode(() => Trace.safeParseJson(oversized)) === "PAYLOAD_SIZE_LIMIT", errorCode(() => Trace.safeParseJson(oversized)), "capsule size limit", true);
let deep = {}; let cursor = deep; for (let index = 0; index < Trace.LIMITS.maxDepth + 2; index += 1) { cursor.next = {}; cursor = cursor.next; }
check("T0878", errorCode(() => Trace.safeParseJson(JSON.stringify(deep))) === "PAYLOAD_DEPTH_LIMIT", errorCode(() => Trace.safeParseJson(JSON.stringify(deep))), "capsule depth limit", true);
const manyEntities = Array.from({ length: Trace.LIMITS.maxEntities + 1 }, () => ({}));
check("T0879", errorCode(() => Trace.safeParseJson(JSON.stringify(manyEntities))) === "PAYLOAD_ENTITY_LIMIT", errorCode(() => Trace.safeParseJson(JSON.stringify(manyEntities))), "capsule entity limit", true);
check("T0880", Trace.externalReference("https://example.invalid/route").status === "BLOCKED_EXTERNAL_REFERENCE" && !Trace.externalReference("https://example.invalid/route").loaded, Trace.externalReference("https://example.invalid/route"), "external URL not loaded", true);
check("T0881", Object.values(Trace.providerPolicy()).every((value) => value === false || value === true) && Trace.providerPolicy().autoCall === false && !Trace.providerPolicy().publicOsrm && Trace.providerPolicy().coordinateTransmissionRequiresApproval, Trace.providerPolicy(), "provider auto-call disabled");
const fakeToken = `sk-${"A".repeat(24)}`; const redactedToken = Trace.redact(`token=${fakeToken}`);
check("T0882", !redactedToken.includes(fakeToken) && redactedToken.includes("REDACTED_OPENAI_TOKEN"), redactedToken, "token redacted", true);
const localPath = `/Users/${"gz"}/private/report.json`; const redactedPath = Trace.redact(localPath);
check("T0883", !redactedPath.includes("/Users/") && redactedPath.includes("<USER_HOME>"), redactedPath, "path redacted", true);
check("T0884", Trace.scanSecrets("clean synthetic report").status === "PASS" && Trace.scanSecrets(`secret=${fakeToken}`).status === "FAIL", { clean: Trace.scanSecrets("clean synthetic report"), dirty: Trace.scanSecrets(`secret=${fakeToken}`) }, "secret scan detects fixture", true);
check("T0885", !Trace.classifyPath("customer/orders.xlsx").distributable && Trace.classifyPath("customer/orders.xlsx").classification === "INTERNAL", Trace.classifyPath("customer/orders.xlsx"), "customer Excel excluded");
check("T0886", !Trace.classifyPath("templates/upload.xlsx").distributable && Trace.classifyPath("templates/upload.xlsx").reasonCode === "CUSTOMER_OR_TEMPLATE_DATA", Trace.classifyPath("templates/upload.xlsx"), "template classified");
check("T0887", Trace.safeCsvCell("=2+2").startsWith("\"'="), Trace.safeCsvCell("=2+2"), "CSV formula protected");
check("T0888", Trace.escapeHtml('<script>alert("x")</script>') === "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;", Trace.escapeHtml('<script>alert("x")</script>'), "HTML escaped");
check("T0889", !/[\\/:*?"<>|]/.test(Trace.safeFilename("../../unsafe:report?.json")) && !Trace.safeFilename("../../unsafe:report?.json").startsWith("."), Trace.safeFilename("../../unsafe:report?.json"), "safe filename");
check("T0890", Trace.scanBinary(Buffer.from([0, 1, 2])).status === "BINARY_REVIEW_REQUIRED" && Trace.scanBinary(Buffer.from("text")).status === "TEXT", { binary: Trace.scanBinary(Buffer.from([0, 1, 2])), text: Trace.scanBinary(Buffer.from("text")) }, "binary scan");

const provisional = Trace.buildReport(catalog, prior.results); const jsonPath = path.join(outputDir, "STCT-v1.8-TRACEABILITY.json"); const htmlPath = path.join(outputDir, "STCT-v1.8-TRACEABILITY.html"); const mutationPath = path.join(outputDir, "STCT-v1.8-MUTATION-SUMMARY.json"); const securityPath = path.join(outputDir, "STCT-v1.8-SECURITY-SUMMARY.json");
fs.writeFileSync(jsonPath, `${JSON.stringify(provisional, null, 2)}\n`); fs.writeFileSync(htmlPath, Trace.renderHtml(provisional)); fs.writeFileSync(mutationPath, `${JSON.stringify({ schemaVersion: "stct-mutation-summary-v1.8", status: mutationRows.every((row) => row.status === "KILLED") ? "PASS" : "FAIL", mutations: mutationRows }, null, 2)}\n`); fs.writeFileSync(securityPath, `${JSON.stringify({ schemaVersion: "stct-security-summary-v1.8", status: "PASS", providerPolicy: Trace.providerPolicy(), limits: Trace.LIMITS }, null, 2)}\n`);
let auditManifest = Trace.manifest([path.basename(jsonPath), path.basename(htmlPath), path.basename(mutationPath), path.basename(securityPath)], outputDir); const auditManifestPath = path.join(outputDir, "AUDIT-MANIFEST.json"); fs.writeFileSync(auditManifestPath, `${JSON.stringify({ schemaVersion: "stct-audit-manifest-v1.8", files: auditManifest }, null, 2)}\n`);
const distFiles = ["network-contract-v18.js", "network-solver-v18.js", "network-visualization-v18.js", "V18_SECURITY_AND_LICENSE_BOUNDARY.md"]; const distManifest = Trace.manifest(distFiles, repo); const distManifestPath = path.join(outputDir, "DIST-MANIFEST.json"); fs.writeFileSync(distManifestPath, `${JSON.stringify({ schemaVersion: "stct-dist-candidate-manifest-v1.8", status: "PRE_DELIVERY_ALLOWLIST", files: distManifest }, null, 2)}\n`);
check("T0891", auditManifest.length === 4 && auditManifest.every((row) => /^[a-f0-9]{64}$/.test(row.sha256)), auditManifest, "audit manifest");
check("T0892", distManifest.length === 4 && distManifest.every((row) => row.classification !== "INTERNAL" && /^[a-f0-9]{64}$/.test(row.sha256)), distManifest, "dist candidate manifest");
check("T0893", fs.existsSync(htmlPath) && fs.readFileSync(htmlPath, "utf8").includes("STCT v1.8 Requirement Traceability"), htmlPath, "requirement HTML export");
check("T0894", JSON.parse(fs.readFileSync(jsonPath, "utf8")).requirementCount === 2819, jsonPath, "requirement JSON export");
check("T0895", mutationRows.length === 10 && mutationRows.every((row) => row.status === "KILLED"), mutationRows, "10/10 mutations killed");
const summary = Trace.summarize(catalog, prior.results);
check("T0896", Object.keys(summary.byGate).length === 30 && summary.byGate["Gate 0"].passed === 40, summary.byGate, "traceability by Gate");
check("T0897", summary.byRisk.P0.requirements > 0 && summary.byRisk.P1.requirements > 0, summary.byRisk, "traceability by Risk");
check("T0898", ["SEMANTIC", "E2E_BROWSER", "PERFORMANCE", "OVERNIGHT"].every((key) => summary.byLayer[key]), summary.byLayer, "traceability by Layer");
const v17Registry = JSON.parse(fs.readFileSync(path.join(repo, "requirements-v17.json"), "utf8")); const migration = Trace.migrateV17(v17Registry);
check("T0899", migration.length === 674 && migration[0].from === "T001" && migration[0].to === "T0001" && migration.every((row) => row.status.includes("REVALIDATION_REQUIRED")), { count: migration.length, first: migration[0], last: migration.at(-1) }, "v1.7 requirement migration map");
check("T0900", catalog.requirements.filter((row) => /^T/.test(row.id)).every((row) => row.version === "v1.8") && catalog.requirements.filter((row) => /^OVN/.test(row.id)).every((row) => row.version === "v1.8-overnight"), [...new Set(catalog.requirements.map((row) => row.version))], "v1.8 requirement versioning");
const finalDraftPath = path.join(outputDir, "FINAL-REPORT-DRAFT.json"); const finalDraft = { schemaVersion: "stct-final-report-draft-v1.8", status: "IN_PROGRESS", evidence: [jsonPath, htmlPath, mutationPath, securityPath, auditManifestPath, distManifestPath].map((file) => path.relative(runDir, file)), limitations: ["LOCAL_DEMO", "NOT_CERTIFIED_OPTIMIZER", "NOT_PRODUCTION_SECURITY_CERTIFICATION"] }; fs.writeFileSync(finalDraftPath, `${JSON.stringify(finalDraft, null, 2)}\n`);
check("T0901", finalDraft.evidence.length === 6 && finalDraft.evidence.every((file) => fs.existsSync(path.join(runDir, file))), finalDraft.evidence, "final report references evidence");
check("T0902", prior.results.length === prior.files.reduce((sum, file) => sum + JSON.parse(fs.readFileSync(path.join(runDir, "evidence", file), "utf8")).checks, 0) && prior.results.length === 845, prior.results.length, "test count computed from evidence");
const boundary = fs.readFileSync(path.join(repo, "V18_SECURITY_AND_LICENSE_BOUNDARY.md"), "utf8");
check("T0903", boundary.includes("MapLibre GL JS") && boundary.includes("SheetJS") && boundary.includes("Google OR-Tools"), boundary.match(/MapLibre GL JS|SheetJS|Google OR-Tools/g), "open-source license ledger");
check("T0904", boundary.includes("No AGPL source code was copied"), "statement present", "AGPL code not copied statement");
check("T0905", boundary.includes("not a penetration test") && boundary.includes("no production identity provider"), "limitations disclosed", "security limitations disclosed");
check("T0906", boundary.includes("local deterministic demonstration") && boundary.includes("not a production control tower"), "local demo boundary", "local demo boundary");
const deterministicA = Trace.buildReport(catalog, prior.results); const deterministicB = Trace.buildReport(catalog, clone(prior.results));
check("T0907", deterministicA.reportHash === deterministicB.reportHash && deterministicA.assertionCount === 845, { first: deterministicA.reportHash, second: deterministicB.reportHash }, "audit reproducible from same registry and results");

assert.strictEqual(assertions.length, 62, "Gate 12 must contain exactly T0846-T0907");
const combinedResults = [...prior.results, ...assertions]; const finalReport = Trace.buildReport(catalog, combinedResults); finalReport.status = "PASS"; finalReport.gate12Status = "PASS"; finalReport.evidenceRoot = "<EXTERNAL_EXECUTION_DIR>/evidence/traceability-v18"; fs.writeFileSync(jsonPath, `${JSON.stringify(finalReport, null, 2)}\n`); fs.writeFileSync(htmlPath, Trace.renderHtml(finalReport));
auditManifest = Trace.manifest([path.basename(jsonPath), path.basename(htmlPath), path.basename(mutationPath), path.basename(securityPath), path.basename(finalDraftPath), path.basename(distManifestPath)], outputDir); fs.writeFileSync(auditManifestPath, `${JSON.stringify({ schemaVersion: "stct-audit-manifest-v1.8", files: auditManifest }, null, 2)}\n`);
const output = { status: "PASS", checks: assertions.length, requirementCount: 2819, executedCoreRequirements: 907, priorChecks: prior.results.length, mutationSummary: { killed: mutationRows.filter((row) => row.status === "KILLED").length, total: mutationRows.length }, outputDir, traceabilityHash: finalReport.reportHash, assertions };
fs.writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`); process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
