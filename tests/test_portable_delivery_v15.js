"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const checks = [];

function check(id, condition, detail = "") {
  assert(condition, `${id}${detail ? `: ${detail}` : ""}`);
  checks.push(id);
}

function files(directory, relative = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
    .flatMap((entry) => {
      const childRelative = path.join(relative, entry.name);
      const childPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return files(childPath, childRelative);
      return entry.isFile() ? [childRelative.split(path.sep).join("/")] : [];
    });
}

function treeHash(directory) {
  const hash = crypto.createHash("sha256");
  files(directory).forEach((relativePath) => {
    hash.update(relativePath);
    hash.update(fs.readFileSync(path.join(directory, relativePath)));
  });
  return hash.digest("hex");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
}

function manifestIsPortable(directory) {
  const lines = fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").trim().split("\n");
  return lines.length > 0 && lines.every((line) => /^[a-f0-9]{64}  \.\//.test(line) && !line.endsWith("./SHA256SUMS.txt"));
}

function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "stct-v15-portable-"));
  const source = path.join(workspace, "source");
  const audit = path.join(workspace, "audit");
  fs.mkdirSync(source, { recursive: true });
  const currentUser = os.userInfo().username;
  const identityFixture = [
    `user=${currentUser}`,
    "user=gz",
    "username=root",
    "owner=demo_user",
    "project=/Users/gz/Documents/lospollos",
    "linux=/home/root/work",
    "runtime=/private/var/folders/aa/bb/T/session",
    "temporary=/tmp/stct/output",
    "business=root cause analysis remains valid",
  ].join("\n");
  fs.writeFileSync(path.join(source, "identity.txt"), `${identityFixture}\n`, "utf8");
  fs.writeFileSync(path.join(source, "evidence.json"), JSON.stringify({ account: "demo_user", message: "root cause analysis" }), "utf8");
  fs.writeFileSync(path.join(source, "original.xlsx"), "excluded workbook", "utf8");
  fs.writeFileSync(path.join(source, "safe.png"), Buffer.from("PNG SAFE"));
  const beforeHash = treeHash(source);

  const auditRun = run(process.execPath, ["scripts/build_audit_bundle_v15.js", source, audit]);
  assert.strictEqual(auditRun.status, 0, auditRun.stderr);
  const redacted = fs.readFileSync(path.join(audit, "identity.txt"), "utf8");
  const redactedJson = fs.readFileSync(path.join(audit, "evidence.json"), "utf8");
  check("T051", !fs.readFileSync(path.join(root, "tests", "test_portable_delivery_v15.js"), "utf8").includes("user=gz\nurl=file:///Users/gz"));
  check("T052", !/(^|\s)user=gz($|\s)/m.test(redacted));
  check("T053", !/(^|\s)username=root($|\s)/m.test(redacted));
  check("T054", !/(^|\s)owner=demo_user($|\s)/m.test(redacted) && !redactedJson.includes('"demo_user"'));
  check("T055", !/\/Users\/|\/home\/|\/tmp\/|\/private\/var\/folders\//.test(redacted));
  check("T056", redacted.includes("root cause analysis remains valid") && redactedJson.includes("root cause analysis"));

  const leakSource = path.join(workspace, "leak-source");
  const leakAudit = path.join(workspace, "leak-audit");
  fs.mkdirSync(leakSource);
  fs.writeFileSync(path.join(leakSource, "leak.png"), Buffer.from("PNG /Users/private_user/secret"));
  const leakRun = run(process.execPath, ["scripts/build_audit_bundle_v15.js", leakSource, leakAudit]);
  check("T057", leakRun.status !== 0 && /Binary redaction scan failed/.test(leakRun.stderr));
  check("T059", manifestIsPortable(audit));

  const secondAudit = path.join(workspace, "audit-other-home");
  const otherHome = path.join(workspace, "home-demo");
  fs.mkdirSync(otherHome);
  const otherRun = run(process.execPath, ["scripts/build_audit_bundle_v15.js", source, secondAudit], { env: { ...process.env, HOME: otherHome } });
  check("T061", otherRun.status === 0 && !fs.readFileSync(path.join(secondAudit, "identity.txt"), "utf8").includes("demo_user"));
  check("T062", treeHash(source) === beforeHash);
  check("T063", !files(audit).some((file) => file.endsWith(".xlsx")));

  const dist = path.join(workspace, "random-dist-name");
  const zip = path.join(workspace, "random-dist-name.zip");
  const distRun = run("bash", ["scripts/build_demo_dist_v15.sh"], { env: { ...process.env, DIST_DIR: dist, ZIP_PATH: zip } });
  assert.strictEqual(distRun.status, 0, `${distRun.stdout}\n${distRun.stderr}`);
  check("T058", manifestIsPortable(dist));
  const extract = path.join(workspace, "extract", `nested-${Date.now()}`);
  fs.mkdirSync(extract, { recursive: true });
  const unzipRun = run("unzip", ["-q", zip, "-d", extract]);
  assert.strictEqual(unzipRun.status, 0, unzipRun.stderr);
  const extractedRoot = path.join(extract, path.basename(dist));
  const manifestRun = run("shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], { cwd: extractedRoot });
  check("T060", manifestRun.status === 0 && manifestRun.stdout.split("\n").filter(Boolean).every((line) => line.endsWith(": OK")));
  const distFiles = files(dist);
  const forbiddenDirectory = distFiles.some((file) => /(^|\/)(\.git|\.claude|logs|tests)(\/|$)/.test(file));
  const originalWorkbook = distFiles.some((file) => /laiyifen|7-eleven|工作簿/i.test(file));
  const absolutePathLeak = distFiles.some((file) => {
    const extension = path.extname(file).toLowerCase();
    if (![".js", ".html", ".css", ".md", ".txt", ".py", ".sh", ".toml", ".json"].includes(extension)) return false;
    return /\/Users\/|\/home\/|\/tmp\/|\/private\/var\/folders\//.test(fs.readFileSync(path.join(dist, file), "utf8"));
  });
  check("T063-dist", !originalWorkbook);
  check("T064", !forbiddenDirectory && !absolutePathLeak);

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks, workspace, auditFiles: files(audit).length, distFiles: distFiles.length }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
