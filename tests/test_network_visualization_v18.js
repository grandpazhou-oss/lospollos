#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Contract = require("../network-contract-v18.js");
const Network = require("../network-solver-v18.js");
const Visual = require("../network-visualization-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_network_visualization_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function sourceFixture(options = {}) { const source = makeNetwork(options); source.depots.forEach((depot) => { depot.capacity.dailyOrders = Math.max(4, Math.ceil(source.orders.length / source.depots.length)); depot.capacity.volume = 100000; depot.capacity.weight = 100000; depot.capacity.handlingMinutes = 100000; }); return source; }
function solve(source, options = {}) { source.docks.forEach((dock) => { dock.simultaneousCapacity = Math.max(dock.simultaneousCapacity, options.dockCapacity || 1); }); return Network.solveNetwork(source, options); }

const source = sourceFixture({ orderCount: 8, depotCount: 2, vehicleCount: 4, pickupDelivery: true, crossDock: true }); source.routingContext.closures = [{ closureId: "CLOSE-VIS-1", fromCoordinate: [117.12, 39.09], toCoordinate: [117.2, 39.14], status: "CLOSED" }]; const plan = solve(source, { maxStopsPerTrip: 2, crossDock: true, dockCapacity: 4 });
const alerts = [{ alertId: "ALERT-CRIT-1", severity: "CRITICAL", reasonCode: "DOCK_STRESS", message: "Dock queue threshold exceeded", depotId: "D1", dockId: "DOCK-1-A", recommendedAction: "RESCHEDULE_DOCK", sourceHash: plan.networkPlanHash }]; const execution = { trips: Object.fromEntries((plan.trip.trips || []).map((trip, index) => [trip.tripId, { state: index ? "PLANNED" : "DEPARTED" }])), conflicts: [{ type: "DOCK_CONFLICT", dockId: "DOCK-1-A", tripId: plan.trip.trips[0].tripId }], incidents: [{ incidentType: "MISSED_TRANSFER", transferId: plan.custody.transfers[0].transferId }] };
const model = Visual.buildModel(source, plan, { alerts, execution, delays: [{ tripId: plan.trip.trips[0].tripId, minutes: 15, propagation: ["DOCK", "WAVE", "TRANSFER"] }] });
check("T0702", model.layers.depots.length === source.depots.length && model.layers.depots.every((row) => row.verified), model.layers.depots, "network map depot layer");
check("T0703", model.layers.zones.length === source.zones.length && model.layers.zones.every((row) => row.verified), model.layers.zones, "zone layer");
check("T0704", model.layers.interDepotFlows.length > 0 && model.layers.interDepotFlows.every((row) => row.properties.dataBacked), model.layers.interDepotFlows, "inter-depot flow layer");
check("T0705", model.layers.tripRoutes.length === plan.trip.routes.length && model.layers.tripRoutes.every((row) => row.properties.roadRouteHash), model.layers.tripRoutes.slice(0, 2), "trip route layer");
const repositionSource = sourceFixture({ orderCount: 4, depotCount: 2, vehicleCount: 2 }); repositionSource.vehicles[0].allowedStartDepotIds = ["D1", "D2"]; repositionSource.vehicles[0].maxTrips = 4; repositionSource.constraints.maxTripsPerVehicle = 4; const repositionPlan = solve(repositionSource, { maxStopsPerTrip: 1, tripOptions: { vehicleIds: ["V1"] }, dockCapacity: 4 }); const repositionModel = Visual.buildModel(repositionSource, repositionPlan);
check("T0706", repositionModel.layers.reposition.length > 0 && repositionModel.layers.reposition.every((row) => row.kind === "EMPTY_REPOSITION"), repositionModel.layers.reposition, "empty reposition layer");
check("T0707", model.layers.transfers.length === plan.custody.transfers.length && model.layers.transfers.length > 0, model.layers.transfers, "transfer layer");
check("T0708", model.layers.closures.length === 1 && model.layers.closures[0].properties.status === "CLOSED", model.layers.closures, "closure layer");
check("T0709", model.layers.capacityStress.length === source.depots.length && model.layers.capacityStress.every((row) => Number.isFinite(row.properties.utilization)), model.layers.capacityStress, "capacity stress layer");
check("T0710", JSON.stringify(model.zOrder) === JSON.stringify(Object.entries(Visual.LAYERS).sort((a, b) => a[1].z - b[1].z).map(([id]) => id)), model.zOrder, "layer z-order");
check("T0711", model.layers.depots.every((row) => row.properties.coordinateSpace === "SCREEN_STABLE" && row.properties.label), model.layers.depots, "screen-stable depot labels");
check("T0712", model.layers.tripRoutes.every((row) => row.properties.coordinateSpace === "MAP" && row.geometry.coordinates.length >= 3), model.layers.tripRoutes.slice(0, 2), "map-space route geometry");
check("T0713", Visual.lod(model, 6).mode === "NETWORK_OVERVIEW" && Visual.lod(model, 6).aggregateFlows && !Visual.lod(model, 6).showStops, Visual.lod(model, 6), "LOD low zoom");
check("T0714", Visual.lod(model, 13).mode === "OPERATION_DETAIL" && Visual.lod(model, 13).showStops && Visual.lod(model, 13).routeCount === model.layers.tripRoutes.length, Visual.lod(model, 13), "LOD high zoom");
const selection = Visual.select(model, { depotId: "D1", tripId: plan.trip.trips[0].tripId, dockId: "DOCK-1-A", waveId: plan.waves.waves[0].waveId, alertId: alerts[0].alertId });
check("T0715", [selection.map, selection.heatmap, selection.tripChain, selection.dockGantt, selection.wave].every((row) => JSON.stringify(row) === JSON.stringify(selection.selection)), selection, "selection sync");
check("T0716", Visual.stepThrough(model, "DEPOT", -1, 1).item.id === model.layers.depots[0].id, Visual.stepThrough(model, "DEPOT", -1, 1), "depot step-through");
check("T0717", Visual.stepThrough(model, "TRIP", -1, 1).focusTarget === "MAP_AND_TRIP_CHAIN", Visual.stepThrough(model, "TRIP", -1, 1), "trip step-through");
check("T0718", Visual.stepThrough(model, "DOCK", -1, 1).focusTarget === "MAP_AND_DOCK_GANTT", Visual.stepThrough(model, "DOCK", -1, 1), "dock step-through");
check("T0719", Visual.stepThrough(model, "WAVE", -1, 1).item.waveId === plan.waves.waves[0].waveId, Visual.stepThrough(model, "WAVE", -1, 1), "wave step-through");
check("T0720", Visual.seekAlert(model, alerts[0].alertId).status === "FOUND" && Visual.seekAlert(model, alerts[0].alertId).selection.selection.alertId === alerts[0].alertId, Visual.seekAlert(model, alerts[0].alertId), "alert seek");
const morph = Visual.flowMorph(model, execution);
check("T0721", morph.dataBacked && morph.frames.length === model.layers.tripRoutes.length && morph.sourceHash === plan.networkPlanHash, morph.frames.slice(0, 2), "Network Flow Morph data-backed");
check("T0722", Visual.depotPulse(model, "D1").stress >= 0 && Visual.depotPulse(model, "D1").nonColorLabel.endsWith("%"), Visual.depotPulse(model, "D1"), "depot pulse encodes stress");
check("T0723", Visual.tripHandover(model, execution, plan.trip.trips[0].tripId).state === "DEPARTED" && Visual.tripHandover(model, execution, plan.trip.trips[0].tripId).marker === "ARROW", Visual.tripHandover(model, execution, plan.trip.trips[0].tripId), "trip handover encodes state");
check("T0724", Visual.dockQueuePropagation(model).length === plan.dock.reservations.length && Visual.dockQueuePropagation(model).every((row) => Number.isFinite(row.waitMinutes) && row.dataBacked), Visual.dockQueuePropagation(model).slice(0, 3), "dock queue propagation data-backed");
check("T0725", Visual.crossDockHandoffs(model).length === plan.custody.transfers.length && Visual.crossDockHandoffs(model).every((row) => row.dataBacked), Visual.crossDockHandoffs(model), "cross-dock handoff data-backed");
check("T0726", Visual.reducedMotion(model).animate === false && Object.keys(Visual.reducedMotion(model).alternatives).length === 5, Visual.reducedMotion(model), "reduced Motion alternatives");
check("T0727", Visual.noWebGL(model).operational && Visual.noWebGL(model).mode === "SVG_AND_TABLE" && Visual.noWebGL(model).tables.routes.length === model.layers.tripRoutes.length, Visual.noWebGL(model), "no-WebGL SVG/network table");
const depotHeat = Visual.heatmapView(model, "depotTime"); const dockHeat = Visual.heatmapView(model, "dockTime"); const vehicleHeat = Visual.heatmapView(model, "vehicleDay");
check("T0728", depotHeat.cells.length === source.depots.length * 3, depotHeat.cells, "capacity heatmap depot-time");
check("T0729", dockHeat.cells.length === source.docks.length, dockHeat.cells, "capacity heatmap dock-time");
check("T0730", vehicleHeat.cells.length === source.vehicles.length, vehicleHeat.cells, "capacity heatmap vehicle-day");
check("T0731", [depotHeat, dockHeat, vehicleHeat].every((view) => view.visibleValues), { depot: depotHeat.visibleValues, dock: dockHeat.visibleValues, vehicle: vehicleHeat.visibleValues }, "heatmap values visible");
check("T0732", [depotHeat, dockHeat, vehicleHeat].every((view) => view.notColorOnly), { depot: depotHeat.notColorOnly, dock: dockHeat.notColorOnly, vehicle: vehicleHeat.notColorOnly }, "heatmap not color-only");
check("T0733", [depotHeat, dockHeat, vehicleHeat].every((view) => view.keyboard), { depot: depotHeat.keyboard, dock: dockHeat.keyboard, vehicle: vehicleHeat.keyboard }, "heatmap keyboard");
check("T0734", Visual.heatmapView(model, "depotTime", true).layout === "HORIZONTAL_SCROLL_TABLE", Visual.heatmapView(model, "depotTime", true).layout, "heatmap mobile");

const chainSource = sourceFixture({ orderCount: 20, depotCount: 2, vehicleCount: 2 }); chainSource.drivers.forEach((driver) => { driver.requiredBreaks[0].triggerDrivingMinutes = 1; driver.requiredBreaks[0].earliestStart = "06:00"; driver.requiredBreaks[0].latestStart = "22:00"; }); const chainPlan = solve(chainSource, { maxStopsPerTrip: 2, dockCapacity: 8 }); const chainExecution = { conflicts: [{ type: "DOCK_CONFLICT", tripId: chainPlan.trip.trips[0].tripId, dockId: "DOCK-1-A" }] }; const chainModel = Visual.buildModel(chainSource, chainPlan, { execution: chainExecution }); const chainView = Visual.tripChainView(chainModel);
check("T0735", chainView.lanes.length === chainPlan.trip.tripChains.length && chainView.lanes.every((row) => row.vehicleId && row.tripIds.length), chainView.lanes.map((row) => ({ vehicleId: row.vehicleId, trips: row.tripIds.length })), "trip chain vehicle lanes");
check("T0736", chainView.lanes.some((row) => row.reloads.length > 0), chainView.lanes.map((row) => row.reloads.length), "trip chain reload");
check("T0737", chainView.lanes.some((row) => row.breaks.length > 0), chainView.lanes.map((row) => row.breaks.length), "trip chain break");
check("T0738", Visual.tripChainView(repositionModel).lanes.some((row) => row.reposition.length > 0), Visual.tripChainView(repositionModel).lanes.map((row) => row.reposition.length), "trip chain reposition");
check("T0739", chainView.lanes.some((row) => row.conflicts.length > 0), chainView.lanes.map((row) => row.conflicts.length), "trip chain conflict");
check("T0740", chainView.keyboard === true && chainView.summaries.every(Boolean), chainView.summaries, "trip chain keyboard");
check("T0741", Visual.tripChainView(chainModel, true).layout === "VERTICAL_VEHICLE_LANES", Visual.tripChainView(chainModel, true).layout, "trip chain mobile");
const timeSpace = Visual.timeSpaceView(model); const chainTimeSpace = Visual.timeSpaceView(chainModel);
check("T0742", timeSpace.departures.length === plan.trip.trips.length, timeSpace.departures.slice(0, 3), "time-space departure");
check("T0743", timeSpace.transfers.length === plan.custody.transfers.length && timeSpace.transfers.length > 0, timeSpace.transfers, "time-space transfer");
check("T0744", chainTimeSpace.reloads.length === chainPlan.trip.reloadEvents.length && chainTimeSpace.reloads.length > 0, chainTimeSpace.reloads.slice(0, 3), "time-space reload");
check("T0745", timeSpace.delays[0].propagation.length === 3, timeSpace.delays, "time-space delay propagation");
check("T0746", timeSpace.missedConnections.length === 1 && timeSpace.missedConnections[0].incidentType === "MISSED_TRANSFER", timeSpace.missedConnections, "time-space missed connection");
check("T0747", timeSpace.tableEquivalent.some((row) => row.type === "DEPARTURE") && timeSpace.tableEquivalent.some((row) => row.type === "TRANSFER") && timeSpace.tableEquivalent.some((row) => row.type === "MISSED_CONNECTION"), timeSpace.tableEquivalent.slice(-4), "time-space table equivalent");
check("T0748", model.dockGantt.reservations.length === plan.dock.reservations.length && model.dockGantt.reservations.length > 0, model.dockGantt.reservations.slice(0, 3), "dock Gantt reservations");
check("T0749", model.dockGantt.queues.length === plan.dock.tripStates.filter((row) => Number(row.queueMinutes || row.queueWaitMinutes) > 0).length, model.dockGantt.queues, "dock Gantt queues");
check("T0750", model.dockGantt.conflicts.length === 1 && model.dockGantt.conflicts[0].type === "DOCK_CONFLICT", model.dockGantt.conflicts, "dock Gantt conflict");
check("T0751", model.dockGantt.cutoffs.length === plan.waves.waves.length && model.dockGantt.cutoffs.every((row) => Number.isFinite(row.cutoffMinute)), model.dockGantt.cutoffs, "dock Gantt cutoff");
check("T0752", model.dockGantt.departures.length === plan.trip.trips.length, model.dockGantt.departures.slice(0, 3), "dock Gantt trip depart");
const reservation = model.dockGantt.reservations[0]; const dragProposal = Visual.dragDockReservation(model, reservation.reservationId, Math.max(...model.dockGantt.reservations.map((row) => row.endMinute)) + 60);
check("T0753", dragProposal.status === "PROPOSAL" && dragProposal.autoApply === false && dragProposal.proposed.startMinute > reservation.startMinute, dragProposal, "dock Gantt drag proposal");
const invalidDrag = Visual.dragDockReservation(model, reservation.reservationId, -1);
check("T0754", invalidDrag.status === "ROLLED_BACK" && invalidDrag.original.reservationId === reservation.reservationId, invalidDrag, "invalid drag rollback", true);
check("T0755", Visual.scenarioSemantics(model, model).wording === "SAME_INPUT_OPTIMIZATION" && Visual.scenarioSemantics(model, { networkInputHash: "different" }).wording === "SCENARIO_CHANGED", { same: Visual.scenarioSemantics(model, model), different: Visual.scenarioSemantics(model, { networkInputHash: "different" }) }, "Scenario Arena same/different semantics");
const room = Visual.decisionRoom(model);
check("T0756", room.firstScan.join("|") === "CRITICAL_ALERTS|SERVICE_RISK|CAPACITY_STRESS|RECOMMENDED_ACTION|EVIDENCE", room.firstScan, "Decision Room first scan hierarchy");
check("T0757", room.criticalAlerts.length === 1 && room.criticalAlerts[0].alertId === alerts[0].alertId, room.criticalAlerts, "critical alerts visible");
check("T0758", room.recommendedActions[0].evidence.reasonCode === alerts[0].reasonCode && Contract.isSha256(room.recommendedActions[0].evidence.sourceHash), room.recommendedActions[0], "recommended action evidence");
check("T0759", room.presentationMode.autoApply === false && room.recommendedActions.every((row) => !row.autoApply), room.presentationMode, "presentation mode no auto apply");
check("T0760", model.attribution.renderer === "MapLibre GL JS" && model.attribution.tiles === "OpenFreeMap" && model.attribution.data.includes("OpenStreetMap"), model.attribution, "map attribution");
check("T0761", Visual.classifyWarning("MapLibre tile glyph request failed") === "EXTERNAL_MAP_DEPENDENCY" && Visual.classifyWarning("Unhandled app reducer error") === "APPLICATION", { external: Visual.classifyWarning("MapLibre tile glyph request failed"), application: Visual.classifyWarning("Unhandled app reducer error") }, "external tile warning classified");

const route240Source = sourceFixture({ orderCount: 480, depotCount: 1, vehicleCount: 100 }); const route240Plan = solve(route240Source, { maxStopsPerTrip: 2, maxOrders: 500, dockCapacity: 100 }); const route240Model = Visual.buildModel(route240Source, route240Plan);
check("T0762", route240Model.layers.tripRoutes.length >= 240 && (Visual.renderHTML(route240Model).match(/<polyline /g) || []).length === 240, { availableRoutes: route240Model.layers.tripRoutes.length, renderedRoutes: (Visual.renderHTML(route240Model).match(/<polyline /g) || []).length }, "240 route rendering");
const chain100Source = sourceFixture({ orderCount: 200, depotCount: 1, vehicleCount: 100 }); const chain100Plan = solve(chain100Source, { maxStopsPerTrip: 2, maxOrders: 500, dockCapacity: 100 }); const chain100Model = Visual.buildModel(chain100Source, chain100Plan);
check("T0763", chain100Model.tripChains.length === 100, chain100Model.tripChains.length, "100 trip chain rendering");
const dock20Source = sourceFixture({ orderCount: 40, depotCount: 10, vehicleCount: 20 }); const dock20Plan = solve(dock20Source, { maxStopsPerTrip: 2, dockCapacity: 10 }); const dock20Model = Visual.buildModel(dock20Source, dock20Plan);
check("T0764", dock20Model.heatmaps.dockTime.length === 20 && new Set(dock20Model.heatmaps.dockTime.map((row) => row.column)).size === 20, { cells: dock20Model.heatmaps.dockTime.length, docks: new Set(dock20Model.heatmaps.dockTime.map((row) => row.column)).size }, "20 dock Gantt rendering");

const repoRoot = path.resolve(__dirname, ".."); const mismatchLedger = fs.readFileSync(path.join(repoRoot, "V18_VISUAL_MISMATCH_LEDGER.md"), "utf8"); const colorLedger = fs.readFileSync(path.join(repoRoot, "V18_COLOR_ROLE_LEDGER.md"), "utf8"); const componentInventory = fs.readFileSync(path.join(repoRoot, "V18_COMPONENT_INVENTORY.md"), "utf8"); const motionLedger = fs.readFileSync(path.join(repoRoot, "V18_MOTION_MEANING_LEDGER.md"), "utf8");
check("T0768", mismatchLedger.includes("VM-004") && mismatchLedger.includes("Closed"), mismatchLedger.split("\n").filter((row) => row.startsWith("| VM-")), "visual mismatch ledger");
check("T0769", Object.keys(Visual.COLORS).length === 8 && colorLedger.includes("Redundant Encoding"), Visual.COLORS, "color role ledger");
check("T0770", Visual.ledgers().components.length === 8 && componentInventory.includes("Canonical Source"), Visual.ledgers().components, "component inventory");
check("T0771", Visual.ledgers().motionMeaning.length === 4 && motionLedger.includes("Reduced Motion Alternative"), Visual.ledgers().motionMeaning, "motion meaning ledger");
check("T0772", Visual.screenReaderSummary(model).includes(`${model.layers.depots.length} depots`) && Visual.screenReaderSummary(model).includes(`${model.layers.tripRoutes.length} trip routes`), Visual.screenReaderSummary(model), "screen-reader summaries");
const localeHtml = ["zh", "en", "ja"].map((locale) => Visual.renderHTML(model, { locale, mobile: locale === "ja" }));
check("T0773", localeHtml.every((html, index) => html.includes(`lang="${["zh", "en", "ja"][index]}"`) && html.includes("viewport")) && localeHtml[0].includes(Visual.term("TITLE", "zh")) && localeHtml[2].includes(Visual.term("TITLE", "ja")), localeHtml.map((html) => html.match(/<title>(.*?)<\/title>/)?.[1]), "Chinese English Japanese layout");
const visualExport = JSON.parse(Visual.exportVisual(model));
check("T0774", visualExport.networkPlanHash === model.networkPlanHash && visualExport.visualHash === model.visualHash && Contract.isSha256(visualExport.exportHash), { networkPlanHash: visualExport.networkPlanHash, visualHash: visualExport.visualHash, exportHash: visualExport.exportHash }, "network visual export");
check("T0775", Visual.verifySources(model).status === "PASS" && Visual.verifySources(model).verifiedHashes.length === 3, Visual.verifySources(model), "all visuals use verified data");
check("T0776", model.dataClassification === "SYNTHETIC" && model.syntheticLabel === "Synthetic test data" && localeHtml.every((html) => /Synthetic test data|合成测试数据|合成テストデータ/.test(html)), { classification: model.dataClassification, label: model.syntheticLabel }, "static fixture clearly labeled Synthetic");
const controller = Visual.createController(); controller.open(model); const clean = controller.close();
check("T0777", clean.sources === 0 && clean.layers === 0 && clean.handlers === 0 && clean.leakFree, clean, "visual source cleanup");
for (let index = 0; index < 100; index += 1) { controller.open(model); controller.close(); }
check("T0778", controller.snapshot().generation === 101 && controller.snapshot().leakFree && controller.snapshot().sources + controller.snapshot().layers + controller.snapshot().handlers === 0, controller.snapshot(), "repeat open/close no leak");
const renderStarted = performance.now(); const desktopHtml = Visual.renderHTML(route240Model, { locale: "en" }); const renderElapsed = performance.now() - renderStarted;
check("T0779", desktopHtml.includes("data-visual-hash") && desktopHtml.length > 10000 && Number.isFinite(renderElapsed), { htmlBytes: Buffer.byteLength(desktopHtml), elapsedMs: renderElapsed }, "visualization performance measured");

const evidenceDir = process.env.STCT_V18_VISUAL_DIR || "/tmp/stct-v18-network-visual"; fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, "desktop.html"), Visual.renderHTML(model, { locale: "en" })); fs.writeFileSync(path.join(evidenceDir, "mobile.html"), Visual.renderHTML(model, { locale: "ja", mobile: true })); fs.writeFileSync(path.join(evidenceDir, "no-webgl.html"), Visual.renderHTML(model, { locale: "zh", noWebGL: true })); fs.writeFileSync(path.join(evidenceDir, "model.json"), JSON.stringify(model, null, 2) + "\n");

assert.strictEqual(assertions.length, 75, "Gate 10 semantic suite must contain 75 requirements; browser suite owns T0765-T0767 and T0780");
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, visualPerformanceMs: renderElapsed, evidenceDir, routeCount: route240Model.layers.tripRoutes.length, tripChainCount: chain100Model.tripChains.length, dockCount: dock20Model.heatmaps.dockTime.length, modelHash: model.visualHash, assertions }, null, 2)}\n`);
