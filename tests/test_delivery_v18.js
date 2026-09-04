#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || "/tmp/lospollos-v1.8-overnight-20260904_012216");
const evidencePath = path.join(runDir, "evidence/wave-h7-delivery-build.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const output = path.resolve(evidence.output);
const assertions = [];

function check(requirementId, condition, observed, expected, negative = false) {
  assertions.push({
    assertionId: `${requirementId}-A1`,
    requirementId,
    status: condition ? "PASS" : "FAIL",
    observed,
    expected,
    negative,
    evidence: "tests/test_delivery_v18.js",
  });
}

function exists(name) {
  return fs.existsSync(path.join(output, name));
}

function read(name) {
  return fs.readFileSync(path.join(output, name), "utf8");
}

function zipNames(zipPath) {
  return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n");
}

function sidecarValid(zipPath, sidecarPath) {
  const expected = fs.readFileSync(sidecarPath, "utf8").trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  return expected === actual;
}

const changed = JSON.parse(read("CHANGED_FILES.json"));
const finalReport = read("STCT-v1.8-FINAL-REPORT.md");
const disposition = read("FILE-DISPOSITION.md");
const deliveryIndex = JSON.parse(read("DELIVERY_INDEX.json"));
const distNames = zipNames(evidence.dist.zip);
const auditNames = zipNames(evidence.audit.zip);
const firstSmoke = evidence.replay[0].smoke;
const commitFiles = [1, 2, 3, 4].map((number) => read([
  "",
  "PROPOSED_COMMIT_1_V18_NETWORK_MODEL_SOLVER.txt",
  "PROPOSED_COMMIT_2_V18_DOCK_WAVE_SCENARIO.txt",
  "PROPOSED_COMMIT_3_V18_EXECUTION_VISUALS.txt",
  "PROPOSED_COMMIT_4_V18_QA_DELIVERY.txt",
][number]).trim().split("\n").filter(Boolean));
const commitUnion = commitFiles.flat();

check("T0985", exists("CHANGED_FILES.json") && changed.changes.length === evidence.changes.length, changed.changes.length, evidence.changes.length);
check("T0986", auditNames.includes("diff/TRACKED_DIFF.patch"), auditNames.includes("diff/TRACKED_DIFF.patch"), true);
check("T0987", auditNames.includes("diff/UNTRACKED_DIFF.patch"), auditNames.includes("diff/UNTRACKED_DIFF.patch"), true);
check("T0988", exists("BINARY_SHA256.json"), exists("BINARY_SHA256.json"), true);
check("T0989", evidence.diffs.diffCheckStatus === "PASS", evidence.diffs.diffCheckStatus, "PASS");
check("T0990", evidence.git.branch === evidence.git.baselineBranch, evidence.git.branch, evidence.git.baselineBranch);
check("T0991", evidence.git.head === evidence.git.baselineHead, evidence.git.head, evidence.git.baselineHead);
check("T0992", evidence.protected.excelUnchanged, evidence.protected.excelUnchanged, true);
check("T0993", evidence.protected.v17Unchanged, evidence.protected.v17Unchanged, true);
check("T0994", evidence.protected.v17Unchanged && auditNames.some((name) => name.startsWith("v17-acceptance/")), evidence.protected.v17Unchanged, true);
check("T0995", Object.values(evidence.protected.pids).every(Boolean), evidence.protected.pids, "all protected user services alive");
check("T0996", evidence.testServices.started === 0 && evidence.testServices.surviving === 0, evidence.testServices, { started: 0, surviving: 0 });
check("T0997", evidence.externalActions.commit === 0, evidence.externalActions.commit, 0, true);
check("T0998", evidence.externalActions.push === 0, evidence.externalActions.push, 0, true);
check("T0999", evidence.externalActions.deploy === 0, evidence.externalActions.deploy, 0, true);
check("T1000", evidence.externalActions.dependencyInstall === 0, evidence.externalActions.dependencyInstall, 0, true);
check("T1001", evidence.externalActions.binaryDownload === 0, evidence.externalActions.binaryDownload, 0, true);
check("T1002", evidence.externalActions.dockerPull === 0, evidence.externalActions.dockerPull, 0, true);
check("T1003", evidence.externalActions.publicOSRM === 0, evidence.externalActions.publicOSRM, 0, true);
check("T1004", evidence.externalActions.publicValhalla === 0, evidence.externalActions.publicValhalla, 0, true);
check("T1005", evidence.externalActions.publicVROOM === 0, evidence.externalActions.publicVROOM, 0, true);
check("T1006", evidence.providers.existingMap.includes("OpenStreetMap"), evidence.providers.existingMap, "map network disclosed");
check("T1007", evidence.providers.configuredRouting.includes("LOCAL") && evidence.providers.configuredRouting.includes("DISABLED_BY_DEFAULT"), evidence.providers.configuredRouting, "local provider disclosed and disabled by default");
const expectedDistNames = [...evidence.dist.whitelist, "MANIFEST.sha256"].sort();
check("T1008", JSON.stringify([...distNames].sort()) === JSON.stringify(expectedDistNames), [...distNames].sort(), expectedDistNames);
check("T1009", evidence.dist.noGit, evidence.dist.noGit, true, true);
check("T1010", evidence.dist.noCustomerExcel, evidence.dist.noCustomerExcel, true, true);
check("T1011", evidence.dist.templateClassification === "INTERNAL_TEMPLATE_EXCLUDED", evidence.dist.templateClassification, "INTERNAL_TEMPLATE_EXCLUDED");
check("T1012", evidence.dist.noAudit, evidence.dist.noAudit, true, true);
check("T1013", evidence.dist.noAbsolutePaths, evidence.dist.noAbsolutePaths, true, true);
check("T1014", evidence.dist.noSecrets, evidence.dist.noSecrets, true, true);
check("T1015", evidence.dist.manifestRelative, evidence.dist.manifestRelative, true);
check("T1016", evidence.dist.manifestExcludesSelf, evidence.dist.manifestExcludesSelf, true);
check("T1017", evidence.replay.length === 3 && evidence.replay.every((row) => row.manifest === "PASS"), evidence.replay.map((row) => row.pathClass), "three random extraction classes with valid manifests");
check("T1018", evidence.replay.every((row) => row.smoke.status === "PASS"), evidence.replay.map((row) => row.smoke.status), ["PASS", "PASS", "PASS"]);
check("T1019", evidence.fallback.status === "PASS" && evidence.fallback.mode === "FALLBACK", evidence.fallback.mode, "FALLBACK");
check("T1020", firstSmoke.singleDepot === "PASS", firstSmoke.singleDepot, "PASS");
check("T1021", firstSmoke.multiDepot === "PASS", firstSmoke.multiDepot, "PASS");
check("T1022", firstSmoke.multiTrip === "PASS", firstSmoke.multiTrip, "PASS");
check("T1023", firstSmoke.pickupDelivery === "PASS", firstSmoke.pickupDelivery, "PASS");
check("T1024", firstSmoke.crossDock === "PASS", firstSmoke.crossDock, "PASS");
check("T1025", firstSmoke.dockWave === "PASS", firstSmoke.dockWave, "PASS");
check("T1026", firstSmoke.networkScenario === "PASS", firstSmoke.networkScenario, "PASS");
check("T1027", firstSmoke.execution === "PASS", firstSmoke.execution, "PASS");
check("T1028", firstSmoke.recovery === "PASS", firstSmoke.recovery, "PASS");
check("T1029", firstSmoke.capsule === "PASS", firstSmoke.capsule, "PASS");
check("T1030", evidence.audit.whitelist.length === 38 && evidence.audit.whitelist.every((entry) => entry.includes(".") || auditNames.some((name) => name.startsWith(`${entry}/`))), evidence.audit.whitelist.length, 38);
check("T1031", evidence.audit.manifestRelative && evidence.audit.manifestExcludesSelf, [evidence.audit.manifestRelative, evidence.audit.manifestExcludesSelf], [true, true]);
check("T1032", evidence.audit.noAbsolutePaths, evidence.audit.noAbsolutePaths, true, true);
check("T1033", evidence.audit.noSecrets, evidence.audit.noSecrets, true, true);
check("T1034", evidence.audit.noGit, evidence.audit.noGit, true, true);
check("T1035", evidence.audit.noCustomerExcel, evidence.audit.noCustomerExcel, true, true);
check("T1036", evidence.changes.every((row) => Object.hasOwn(row, "before") && Object.hasOwn(row, "after")), evidence.changes.length, "all changes include before and after dispositions");
check("T1037", auditNames.includes("requests/network-solver-request.json") && auditNames.includes("responses/network-solver-response.json"), auditNames.filter((name) => /^(requests|responses)\//.test(name)), "request and response evidence");
check("T1038", auditNames.includes("canonical-fixtures/stct-synthetic-demo.json") && auditNames.includes("canonical-fixtures/network-v18-fixture.js"), auditNames.filter((name) => name.startsWith("canonical-fixtures/")), "two canonical fixtures");
check("T1039", auditNames.some((name) => name.endsWith(".png")), auditNames.filter((name) => name.endsWith(".png")).length, "> 0");
check("T1040", auditNames.some((name) => name.startsWith("performance/") && name.endsWith(".json")), auditNames.filter((name) => name.startsWith("performance/")).length, "> 0");
check("T1041", auditNames.includes("traceability/wave-h5-traceability-security.json"), auditNames.includes("traceability/wave-h5-traceability-security.json"), true);
check("T1042", auditNames.includes("mutation/STCT-v1.8-MUTATION-SUMMARY.json"), auditNames.includes("mutation/STCT-v1.8-MUTATION-SUMMARY.json"), true);
check("T1043", auditNames.includes("diff/TRACKED_DIFF.patch") && auditNames.includes("diff/UNTRACKED_DIFF.patch"), auditNames.filter((name) => name.startsWith("diff/")), "tracked and untracked full diffs");
check("T1044", exists("STCT-v1.8-OPEN-SOURCE-INSPIRATION.md"), exists("STCT-v1.8-OPEN-SOURCE-INSPIRATION.md"), true);
check("T1045", evidence.dist.whitelist.includes("DATA_CLASSIFICATION.md"), evidence.dist.whitelist.includes("DATA_CLASSIFICATION.md"), true);
check("T1046", evidence.dist.whitelist.includes("NOTICE.md"), evidence.dist.whitelist.includes("NOTICE.md"), true);
check("T1047", exists("STCT-v1.8-ARCHITECTURE-DECISIONS.md"), exists("STCT-v1.8-ARCHITECTURE-DECISIONS.md"), true);
check("T1048", exists("PROPOSED_COMMIT_1_V18_NETWORK_MODEL_SOLVER.txt") && commitFiles[0].length > 0, commitFiles[0].length, "> 0");
check("T1049", exists("PROPOSED_COMMIT_2_V18_DOCK_WAVE_SCENARIO.txt") && commitFiles[1].length > 0, commitFiles[1].length, "> 0");
check("T1050", exists("PROPOSED_COMMIT_3_V18_EXECUTION_VISUALS.txt") && commitFiles[2].length > 0, commitFiles[2].length, "> 0");
check("T1051", exists("PROPOSED_COMMIT_4_V18_QA_DELIVERY.txt") && commitFiles[3].length > 0, commitFiles[3].length, "> 0");
check("T1052", commitUnion.length === new Set(commitUnion).size, commitUnion.length - new Set(commitUnion).size, 0);
check("T1053", evidence.commitUnionMatches && commitUnion.length === evidence.changes.length, commitUnion.length, evidence.changes.length);
check("T1054", evidence.fileDispositionCount === evidence.changes.length && evidence.changes.every((row) => disposition.includes(`\`${row.path}\``)), evidence.fileDispositionCount, evidence.changes.length);
check("T1055", evidence.outer.zipClean, evidence.outer.zipClean, true);
check("T1056", finalReport.includes("do not label it production-ready"), finalReport.includes("production-ready"), "explicit non-production boundary");
check("T1057", finalReport.includes("certified optimizer") && finalReport.includes("do not label"), finalReport.includes("certified optimizer"), "explicit non-certified boundary");
check("T1058", finalReport.includes("live warehouse system") && finalReport.includes("do not label"), finalReport.includes("live warehouse system"), "explicit non-live boundary");
check("T1059", finalReport.includes("globally optimal") && finalReport.includes("do not label"), finalReport.includes("globally optimal"), "explicit non-global-optimum boundary");
check("T1060", Array.from({ length: 15 }, (_, index) => `Gate ${index}:`).every((label) => finalReport.includes(label)), "Gate 0 through Gate 14", "all gate statuses present");
check("T1061", sidecarValid(evidence.dist.zip, evidence.dist.sidecar) && sidecarValid(evidence.audit.zip, evidence.audit.sidecar) && sidecarValid(evidence.outer.zip, evidence.outer.sidecar), true, true);
check("T1062", deliveryIndex.schemaVersion === "stct-v1.8-delivery-index-v1" && deliveryIndex.artifacts.length > 0, deliveryIndex.artifacts.length, "> 0");
check("T1063", exists("README-REPLAY.md") && read("README-REPLAY.md").includes("smoke_release_v18.js"), exists("README-REPLAY.md"), true);
check("T1064", evidence.replay.length === 3 && new Set(evidence.replay.map((row) => row.pathClass)).size === 3, evidence.replay.map((row) => row.pathClass), "three distinct path classes");
check("T1065", evidence.sourceReconstruction.status === "PASS" && evidence.sourceReconstruction.expectedFiles === evidence.sourceReconstruction.actualFiles, evidence.sourceReconstruction, "PASS with equal manifests");
check("T1066", evidence.testServices.surviving === 0, evidence.testServices.surviving, 0);
check("T1067", finalReport.includes("Final recommendation:") && finalReport.includes("auditable local demonstration"), finalReport.includes("Final recommendation:"), true);

const failures = assertions.filter((row) => row.status !== "PASS");
const result = {
  schemaVersion: "stct-v1.8-delivery-test-v1",
  status: failures.length ? "FAIL" : "PASS",
  suite: "delivery-v18",
  assertions,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = failures.length ? 1 : 0;
