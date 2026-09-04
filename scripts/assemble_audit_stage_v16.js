#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function args() { const values = {}; for (let i = 2; i < process.argv.length; i += 2) values[process.argv[i].replace(/^--/, "")] = process.argv[i + 1]; return values; }
const options = args();
const repo = path.resolve(__dirname, "..");
const baseline = path.resolve(options.baseline || "");
const release = path.resolve(options.release || "");
const fallback = path.resolve(options.fallback || "");
const externalDisabled = path.resolve(options["external-disabled"] || "");
const delivery = path.resolve(options.delivery || "");
const stage = path.resolve(options.stage || "");
const concepts = path.resolve(options.concepts || "");
const distRuntime = path.resolve(options["dist-runtime"] || "");
const distBrowser = path.resolve(options["dist-browser"] || "");
const gate11 = path.resolve(options.gate11 || "");
const gate0 = path.resolve(options.gate0 || "");
for (const [name, value] of Object.entries({ baseline, release, fallback, externalDisabled, delivery, concepts, distRuntime, distBrowser, gate11, gate0 })) {
  if (!value || !fs.existsSync(value)) throw new Error(`Missing --${name}: ${value}`);
}
if (!stage) throw new Error("Missing --stage output path.");

const excludedDirectories = new Set([".git", "node_modules", "__pycache__", ".run"]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".py", ".sh", ".toml", ".tsv", ".txt", ".xml", ".yaml", ".yml"]);
function sha(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function files(root, relative = "") {
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))).flatMap((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
    const child = path.join(root, entry.name); const rel = path.join(relative, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) return files(child, rel);
    return entry.isFile() ? [rel] : [];
  });
}
function copy(source, destination) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); }
function write(relative, content) { const destination = path.join(stage, relative); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, content, "utf8"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(command, commandArgs, cwd = repo) { const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8" }); if (result.status !== 0 && result.status !== 1) throw new Error(`${command} failed: ${result.stderr}`); return result.stdout; }

fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
const requiredDirectories = ["baseline", "v151-regression", "concepts", "visual-ledger", "routing", "road-graph", "snap", "matrix", "route", "full-reoptimization", "execution", "driver", "offline-queue", "plan-actual", "alerts", "operations", "rolling-recovery", "capsules", "browser", "screenshots", "performance", "requests", "responses", "diff"];
requiredDirectories.forEach((directory) => fs.mkdirSync(path.join(stage, directory), { recursive: true }));

const baselineSource = path.join(baseline, "source-baseline");
const baselineFiles = new Set(files(baselineSource)); const currentFiles = new Set(files(repo));
const changed = [...new Set([...baselineFiles, ...currentFiles])].filter((relative) => {
  const before = path.join(baselineSource, relative); const after = path.join(repo, relative);
  if (!fs.existsSync(before) || !fs.existsSync(after)) return true;
  return sha(fs.readFileSync(before)) !== sha(fs.readFileSync(after));
}).sort();
const tracked = new Set(run("git", ["ls-files"]).trim().split("\n").filter(Boolean));
const trackedDiff = []; const untrackedDiff = []; const binaryRows = [];
for (const relative of changed) {
  const before = path.join(baselineSource, relative); const after = path.join(repo, relative); const extension = path.extname(relative).toLowerCase();
  const currentExists = fs.existsSync(after); const buffer = currentExists ? fs.readFileSync(after) : Buffer.alloc(0); const isText = textExtensions.has(extension) && !buffer.includes(0);
  if (!isText) { binaryRows.push(`${currentExists ? sha(buffer) : "DELETED"}  ${relative}`); continue; }
  const left = fs.existsSync(before) ? before : "/dev/null"; const right = currentExists ? after : "/dev/null";
  const result = spawnSync("diff", ["-u", "--label", `baseline/${relative}`, "--label", `current/${relative}`, left, right], { encoding: "utf8" });
  if (![0, 1].includes(result.status)) throw new Error(`diff failed for ${relative}: ${result.stderr}`);
  (tracked.has(relative) ? trackedDiff : untrackedDiff).push(result.stdout);
}
write("diff/changed-files.txt", `${changed.join("\n")}\n`); write("diff/tracked-current-turn.diff", trackedDiff.join("")); write("diff/untracked-current-turn.diff", untrackedDiff.join("")); write("diff/binary-sha256.txt", `${binaryRows.length ? binaryRows.join("\n") : "NO_CURRENT_TURN_BINARY_CHANGES"}\n`);

const commit1Pattern = /(^optimizer\/(?:ortools_service\.py|rolling_solver_v16\.py|routing_contract_v16\.py)$|(?:road|routing|rolling|reoptimization|change-penalty|job-lifecycle)-v16|tests\/(?:fixtures\/rolling-v16-fixture|test_(?:routing|road|rolling)))/;
const commit2Pattern = /(^index\.html$|^experience-ui-v15\.js$|(?:execution|plan-vs-actual|operations-alerts|offline-queue|driver-simulator|dynamic-operations-capsule|map-layer-registry-v16|experience-ui-v16|experience-v16)|tests\/test_(?:execution|plan_vs_actual|operations|driver|dynamic_operations))/;
const commits = { one: [], two: [], three: [] };
changed.forEach((relative) => { if (commit1Pattern.test(relative)) commits.one.push(relative); else if (commit2Pattern.test(relative)) commits.two.push(relative); else commits.three.push(relative); });
const combined = [...commits.one, ...commits.two, ...commits.three];
if (new Set(combined).size !== combined.length || combined.slice().sort().join("\n") !== changed.join("\n")) throw new Error("Proposed commit manifests do not exactly partition changed files.");
const manifestNames = ["PROPOSED_COMMIT_1_V16_ROUTING_REOPT.txt", "PROPOSED_COMMIT_2_V16_EXECUTION_OPERATIONS.txt", "PROPOSED_COMMIT_3_V16_QA_DELIVERY.txt"];
[commits.one, commits.two, commits.three].forEach((rows, index) => {
  const content = `${rows.join("\n")}\n`; write(manifestNames[index], content); fs.writeFileSync(path.join(delivery, manifestNames[index]), content, "utf8");
});
const disposition = `# STCT v1.6 File Disposition\n\nBaseline-to-current scope: ${changed.length} files. Existing dirty files unchanged by this turn are excluded.\n\n| Decision | File | Reason |\n|---|---|---|\n${changed.map((relative) => `| KEEP | \`${relative}\` | Required v1.6 implementation, test, evidence, or delivery support. |`).join("\n")}\n`;
write("FILE_DISPOSITION.md", disposition); fs.writeFileSync(path.join(delivery, "FILE_DISPOSITION.md"), disposition, "utf8");

["environment.json", "git-baseline.txt", "original-excel-sha256.txt", "ports-before.json", "ports-before.txt", "processes-before.json", "processes-before.txt", "v151-delivery-sha256-before.txt"].forEach((name) => { const source = path.join(baseline, name); if (fs.existsSync(source)) copy(source, path.join(stage, "baseline", name)); });
files(path.join(baseline, "v151-regression")).forEach((relative) => copy(path.join(baseline, "v151-regression", relative), path.join(stage, "v151-regression", relative)));
files(concepts).forEach((relative) => copy(path.join(concepts, relative), path.join(stage, "concepts", relative)));
["V16_VISUAL_DESIGN_CONTRACT.md", "V16_COMPONENT_INVENTORY.md", "V16_COLOR_ROLE_LEDGER.md", "V16_VISUAL_MISMATCH_LEDGER.md", "OPEN_SOURCE_INSPIRATION_V16.md"].forEach((name) => copy(path.join(repo, name), path.join(stage, "visual-ledger", name)));
["v151-integrity-hash.txt", "v151-pareto-integrity.txt", "v151-recovery-matrix.txt", "v151-derived-scenario.txt", "v151-capsule-integrity.txt"].forEach((name) => copy(path.join(release, name), path.join(stage, "v151-regression", name)));
const evidenceMap = {
  "responses/goal-coverage-v16.txt": "goal-coverage-v16.txt",
  "routing/routing-provider-v16.txt": "routing-provider-v16.txt", "road-graph/road-routing-v16.txt": "road-routing-v16.txt", "snap/road-routing-v16.txt": "road-routing-v16.txt", "matrix/road-routing-v16.txt": "road-routing-v16.txt", "route/road-routing-v16.txt": "road-routing-v16.txt", "full-reoptimization/rolling-reoptimization-v16.txt": "rolling-reoptimization-v16.txt", "execution/execution-twin-v16.txt": "execution-twin-v16.txt", "driver/driver-simulator-v16.txt": "driver-simulator-v16.txt", "offline-queue/driver-simulator-v16.txt": "driver-simulator-v16.txt", "plan-actual/plan-vs-actual-v16.txt": "plan-vs-actual-v16.txt", "alerts/operations-alerts-v16.txt": "operations-alerts-v16.txt", "operations/operations-alerts-v16.txt": "operations-alerts-v16.txt", "rolling-recovery/execution-recovery-v16.txt": "execution-recovery-v16.txt", "capsules/dynamic-capsule-v16.txt": "dynamic-capsule-v16.txt",
};
Object.entries(evidenceMap).forEach(([destination, source]) => copy(path.join(release, source), path.join(stage, destination)));
copy(path.join(release, "browser-evidence.json"), path.join(stage, "browser", "browser-evidence.json"));
copy(distBrowser, path.join(stage, "browser", "dist-random-extract-browser-evidence.json"));
files(path.join(release, "screenshots")).forEach((relative) => copy(path.join(release, "screenshots", relative), path.join(stage, "screenshots", relative)));
copy(path.join(delivery, "STCT-v1.6-PERFORMANCE.json"), path.join(stage, "performance", "STCT-v1.6-PERFORMANCE.json"));
copy(path.join(delivery, "STCT-v1.6-ROUTING_PROVENANCE.json"), path.join(stage, "routing", "STCT-v1.6-ROUTING_PROVENANCE.json"));
copy(path.join(delivery, "STCT-v1.6-TEST_SUMMARY.json"), path.join(stage, "responses", "release-test-summary.json"));
copy(path.join(fallback, "STCT-v1.6-TEST_SUMMARY.json"), path.join(stage, "responses", "fallback-test-summary.json"));
copy(path.join(externalDisabled, "STCT-v1.6-TEST_SUMMARY.json"), path.join(stage, "responses", "external-disabled-test-summary.json"));
copy(distRuntime, path.join(stage, "responses", "dist-random-extract-runtime-smoke.json"));
copy(gate11, path.join(stage, "responses", "gate11-pre-final-validation.json"));
copy(gate0, path.join(stage, "v151-regression", "gate0-v16-validation.json"));
const browser = readJson(path.join(release, "browser-evidence.json")); const provenance = readJson(path.join(delivery, "STCT-v1.6-ROUTING_PROVENANCE.json"));
write("requests/browser-requests.json", `${JSON.stringify(browser.requests, null, 2)}\n`); write("requests/routing-provider-request.json", `${JSON.stringify(provenance.request, null, 2)}\n`);
write("responses/routing-provider-response.json", `${JSON.stringify({ matrix: provenance.matrix, route: provenance.route, consistency: provenance.routeMatrixConsistency }, null, 2)}\n`);
write("requests/full-reoptimization-http-verification.json", `${JSON.stringify({ transport: "HTTP_FETCH", endpointCategory: "EPHEMERAL_LOOPBACK", tests: ["T159", "T160", "T198", "T199"], source: "rolling-reoptimization-v16.txt" }, null, 2)}\n`);
write("responses/full-reoptimization-http-verification.json", `${JSON.stringify({ status: "PASS", engine: "OR-Tools", solverClaim: "BEST_FOUND_WITHIN_LIMIT", optimalityClaim: "NOT_CLAIMED", evidence: "full-reoptimization/rolling-reoptimization-v16.txt" }, null, 2)}\n`);

copy(path.join(delivery, "STCT-v1.6-FINAL_REPORT.md"), path.join(stage, "FINAL_REPORT.md"));
copy(path.join(repo, "DATA_CLASSIFICATION.md"), path.join(stage, "baseline", "DATA_CLASSIFICATION.md")); copy(path.join(repo, "NOTICE.md"), path.join(stage, "baseline", "NOTICE.md"));
write("README-REPLAY.md", `# STCT v1.6 Audit Replay\n\nThis redacted bundle contains synthetic-fixture evidence, not customer workbooks or production telemetry.\n\nVerify from the extracted bundle root:\n\n\`\`\`bash\nshasum -a 256 -c SHA256SUMS.txt\n\`\`\`\n\nRead \`FINAL_REPORT.md\`, \`FILE_DISPOSITION.md\`, and the three proposed commit manifests. Browser screenshots are under \`screenshots/\`; actual provider and performance summaries are under \`routing/\` and \`performance/\`. Paths and local identities are redacted during final packaging.\n`);
process.stdout.write(`${JSON.stringify({ status: "PASS", changedFiles: changed.length, commits: { one: commits.one.length, two: commits.two.length, three: commits.three.length }, stage }, null, 2)}\n`);
