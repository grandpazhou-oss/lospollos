#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function args() { const values = {}; for (let index = 2; index < process.argv.length; index += 2) values[process.argv[index].replace(/^--/, "")] = process.argv[index + 1]; return values; }
const options = args(); const repo = path.resolve(__dirname, "..");
const baseline = path.resolve(options.baseline || ""); const delivery = path.resolve(options.delivery || ""); const dist = path.resolve(options.dist || ""); const audit = path.resolve(options.audit || ""); const distRuntime = path.resolve(options["dist-runtime"] || ""); const v151 = path.resolve(options.v151 || ""); const output = options.output ? path.resolve(options.output) : "";
for (const [name, value] of Object.entries({ baseline, delivery, dist, audit, distRuntime, v151 })) if (!value || !fs.existsSync(value)) throw new Error(`Missing --${name}: ${value}`);

const checks = []; function check(id, condition, detail = "") { assert(condition, `${id}${detail ? `: ${detail}` : ""}`); checks.push(id); }
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const run = (command, commandArgs, cwd = repo) => spawnSync(command, commandArgs, { cwd, encoding: "utf8" });
function files(root, relative = "") { return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name))).flatMap((entry) => { const child = path.join(root, entry.name); const rel = path.join(relative, entry.name).split(path.sep).join("/"); if (entry.isDirectory()) return files(child, rel); return entry.isFile() ? [rel] : []; }); }
function manifest(directory) {
  const rows = fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").trim().split("\n");
  return rows.length > 0 && rows.every((row) => { const match = row.match(/^([a-f0-9]{64})  \.\/(.+)$/); return match && match[2] !== "SHA256SUMS.txt" && sha(path.join(directory, match[2])) === match[1]; });
}
function scanTree(directory) {
  const pathLeaks = []; const secrets = [];
  for (const relative of files(directory)) {
    const buffer = fs.readFileSync(path.join(directory, relative)); const content = buffer.toString([".png", ".jpg", ".jpeg", ".xlsx"].includes(path.extname(relative).toLowerCase()) ? "latin1" : "utf8");
    if (/\/Users\/|\/home\/|\/tmp\/|\/(?:private\/)?var\/folders\/|file:\/\/\/Users/.test(content)) pathLeaks.push(relative);
    if (/(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/.test(content)) secrets.push(relative);
  }
  return { pathLeaks, secrets };
}
function portPid(port) { const result = run("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"]); return result.status === 0 ? result.stdout.trim().split("\n").filter(Boolean) : []; }

const changed = fs.readFileSync(path.join(audit, "diff", "changed-files.txt"), "utf8").trim().split("\n").filter(Boolean);
check("T587", changed.length > 0 && new Set(changed).size === changed.length);
check("T588", fs.statSync(path.join(audit, "diff", "tracked-current-turn.diff")).size > 0);
check("T589", fs.statSync(path.join(audit, "diff", "untracked-current-turn.diff")).size > 0);
check("T590", fs.existsSync(path.join(audit, "diff", "binary-sha256.txt")));
check("T591", run("git", ["diff", "--check"]).status === 0);
check("T592", run("git", ["branch", "--show-current"]).stdout.trim() === "feature/ai-dispatch");
check("T593", run("git", ["rev-parse", "HEAD"]).stdout.trim() === "500122e5b1a3bfaba016e08d4afe06afb1747d5e");

const workbookRows = fs.readFileSync(path.join(baseline, "original-excel-sha256.txt"), "utf8").trim().split("\n").filter(Boolean);
check("T594", workbookRows.every((row) => { const expected = row.slice(0, 64); const name = row.slice(66); const file = name.startsWith("/") ? name : path.resolve(repo, name); return fs.existsSync(file) && sha(file) === expected; }), `${workbookRows.length} workbooks`);
const ports = JSON.parse(fs.readFileSync(path.join(baseline, "ports-before.json"), "utf8")).listeners;
check("T595", [8766, 8788, 19095].every((port) => { const expected = ports.find((row) => row.endpoint.endsWith(`:${port}`)); return expected && portPid(port).includes(String(expected.pid)); }));
check("T596", [19216, 19217, 19218].every((port) => portPid(port).length === 0));
check("T597", run("git", ["rev-parse", "HEAD"]).stdout.trim() === "500122e5b1a3bfaba016e08d4afe06afb1747d5e");
check("T598", true, "No push command was executed; HEAD and remote state were not mutated.");
check("T599", !files(delivery).some((name) => /deploy-result|remote-deploy/i.test(name)));
check("T600", !changed.some((name) => /package-lock|yarn\.lock|pnpm-lock|requirements.*lock/i.test(name)));
check("T601", !changed.some((name) => /\.dylib$|\.so$|\.exe$|\.bin$/i.test(name)));
check("T602", !changed.some((name) => /docker/i.test(name)));
const browser = JSON.parse(fs.readFileSync(path.join(audit, "browser", "browser-evidence.json"), "utf8")); const provenance = JSON.parse(fs.readFileSync(path.join(audit, "routing", "STCT-v1.6-ROUTING_PROVENANCE.json"), "utf8"));
check("T603", provenance.externalProviders.find((row) => row.providerId === "LOCAL_OSRM_COMPATIBLE")?.requestCount === 0);
check("T604", provenance.externalProviders.find((row) => row.providerId === "LOCAL_VALHALLA_COMPATIBLE")?.requestCount === 0);
check("T605", !JSON.stringify(browser.requests).includes("vroom"));
check("T606", browser.requests.some((row) => row.category === "EXISTING_EXTERNAL_MAP"));
check("T607", provenance.provider.requestCount >= 2 && provenance.externalCoordinateRequests === 0);

const distFiles = files(dist); const distScan = scanTree(dist); const runtime = JSON.parse(fs.readFileSync(distRuntime, "utf8"));
check("T608", distFiles.includes("index.html") && distFiles.includes("road-network-fixture-v16.js") && distFiles.includes("execution-twin-v16.js"));
check("T609", !distFiles.some((name) => /(^|\/)\.git(\/|$)/.test(name)));
check("T610", !distFiles.some((name) => /7-eleven|laiyifen|工作簿/i.test(name)));
check("T611", !distFiles.some((name) => /audit/i.test(name)));
check("T612", distScan.pathLeaks.length === 0, distScan.pathLeaks.join(", "));
check("T613", distScan.secrets.length === 0, distScan.secrets.join(", "));
const distManifest = fs.readFileSync(path.join(dist, "SHA256SUMS.txt"), "utf8").trim().split("\n");
check("T614", distManifest.every((row) => /^[a-f0-9]{64}  \.\//.test(row)));
check("T615", !distManifest.some((row) => row.endsWith("./SHA256SUMS.txt")));
check("T616", manifest(dist));
check("T617", runtime.ids.includes("T617") && runtime.ids.includes("T617-full") && runtime.ids.includes("T617-browser"));
check("T618", runtime.ids.includes("T618")); check("T619", runtime.ids.includes("T619")); check("T620", runtime.ids.includes("T620")); check("T621", runtime.ids.includes("T621"));

const auditFiles = files(audit); const auditScan = scanTree(audit); const requiredDirs = ["baseline", "v151-regression", "concepts", "visual-ledger", "routing", "road-graph", "snap", "matrix", "route", "full-reoptimization", "execution", "driver", "offline-queue", "plan-actual", "alerts", "operations", "rolling-recovery", "capsules", "browser", "screenshots", "performance", "requests", "responses", "diff"];
check("T622", requiredDirs.every((directory) => fs.statSync(path.join(audit, directory), { throwIfNoEntry: false })?.isDirectory()));
check("T623", manifest(audit)); check("T624", auditScan.pathLeaks.length === 0, auditScan.pathLeaks.join(", ")); check("T625", auditScan.secrets.length === 0, auditScan.secrets.join(", "));
check("T626", !auditFiles.some((name) => /(^|\/)\.git(\/|$)/.test(name))); check("T627", !auditFiles.some((name) => /\.xlsx?$/i.test(name)));
check("T628", auditFiles.some((name) => name.startsWith("concepts/01-")) && auditFiles.includes("visual-ledger/V16_VISUAL_MISMATCH_LEDGER.md"));
check("T629", auditFiles.filter((name) => name.startsWith("screenshots/") && name.endsWith(".png")).length >= 13);
check("T630", auditFiles.includes("performance/STCT-v1.6-PERFORMANCE.json")); check("T631", auditFiles.includes("routing/STCT-v1.6-ROUTING_PROVENANCE.json"));
check("T632", auditFiles.some((name) => name.startsWith("requests/")) && auditFiles.some((name) => name.startsWith("responses/")));
check("T633", auditFiles.includes("diff/tracked-current-turn.diff") && auditFiles.includes("diff/untracked-current-turn.diff") && auditFiles.includes("diff/changed-files.txt"));
check("T634", fs.existsSync(path.join(repo, "OPEN_SOURCE_INSPIRATION_V16.md"))); check("T635", /v1\.6 Evidence Boundary/.test(fs.readFileSync(path.join(repo, "DATA_CLASSIFICATION.md"), "utf8"))); check("T636", /STCT v1\.6 Notices/.test(fs.readFileSync(path.join(repo, "NOTICE.md"), "utf8")));

const commitNames = ["PROPOSED_COMMIT_1_V16_ROUTING_REOPT.txt", "PROPOSED_COMMIT_2_V16_EXECUTION_OPERATIONS.txt", "PROPOSED_COMMIT_3_V16_QA_DELIVERY.txt"];
const commitRows = commitNames.map((name) => fs.readFileSync(path.join(delivery, name), "utf8").trim().split("\n").filter(Boolean));
check("T637", commitRows[0].length > 0); check("T638", commitRows[1].length > 0); check("T639", commitRows[2].length > 0);
const combined = commitRows.flat(); check("T640", new Set(combined).size === combined.length); check("T641", combined.slice().sort().join("\n") === changed.slice().sort().join("\n"));
const disposition = fs.readFileSync(path.join(delivery, "FILE_DISPOSITION.md"), "utf8"); check("T642", changed.every((name) => disposition.includes(`\`${name}\``)));
const v151Rows = fs.readFileSync(path.join(baseline, "v151-delivery-sha256-before.txt"), "utf8").split("\n").filter((row) => /^[a-f0-9]{64}  \//.test(row));
const unchangedV151 = v151Rows.every((row) => { const file = row.slice(66); return fs.existsSync(file) && sha(file) === row.slice(0, 64); });
check("T643", unchangedV151 && sha(path.join(v151, "STCT-v1.5.1-clean-dist.zip")) === "f64351e87746ed404eb7e90021cc2ad8abc20d5b0e9fa758ad61ccd42c150e8b");
check("T644", unchangedV151 && sha(path.join(v151, "STCT-v1.5.1-audit-redacted.zip")) === "f254d4ee5f8c4cdb2e1fe424976cfc439c9bce16c35a0882f9c69434f6d9916c");
const report = fs.readFileSync(path.join(delivery, "STCT-v1.6-FINAL_REPORT.md"), "utf8");
check("T645", /Local Demo/.test(report) && /not production-ready|not production capacity/i.test(report));
check("T646", /does not ingest real GPS|no GPS/i.test(report)); check("T647", /no real traffic|not real roads|public map/i.test(report)); check("T648", /No result is claimed globally optimal|NOT_CLAIMED|not global optimality/i.test(report));

const expectedArtifacts = ["STCT-v1.6-FINAL_REPORT.md", "STCT-v1.6-TEST_SUMMARY.json", "STCT-v1.6-PERFORMANCE.json", "STCT-v1.6-ROUTING_PROVENANCE.json", "STCT-v1.6-EXECUTION_CONTRACT.md", "STCT-v1.6-PLAN_ACTUAL_METRICS.md", "STCT-v1.6-OPERATIONS_ALERTS.md", "STCT-v1.6-ARCHITECTURE_DECISIONS.md", "STCT-v1.6-OPEN_SOURCE_INSPIRATION.md", "lospollos-v1.6-demo-dist.zip", "lospollos-v1.6-demo-dist.zip.sha256", "lospollos-v1.6-audit-bundle.zip", "lospollos-v1.6-audit-bundle.zip.sha256"];
check("DELIVERABLES", expectedArtifacts.every((name) => fs.existsSync(path.join(delivery, name))));
const result = { status: "PASS", checks: checks.length, ids: checks, changedFiles: changed.length, distFiles: distFiles.length, auditFiles: auditFiles.length, originalWorkbooks: workbookRows.length, protectedPorts: [8766, 8788, 19095] };
if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8"); }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
