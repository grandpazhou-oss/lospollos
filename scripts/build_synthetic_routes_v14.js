#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = process.argv[2] || path.join(root, "assets", "demo", "stct-synthetic-demo.json");
const destination = process.argv[3] || path.join(root, "data", "routes-data-synthetic-v14.js");
const raw = JSON.parse(fs.readFileSync(source, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
let applied = null;

global.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};
global.window = {
  crypto: globalThis.crypto,
  location: { search: "?forceHeuristic=1&optPort=65534" },
  dispatchEvent() {},
  STCTUtils: { clone },
  STCTCore: {
    getData: () => ({ routes: [], stopGeoJson: { type: "FeatureCollection", features: [] } }),
    setOptimizerPlan() {},
    applyPlan: (plan) => { applied = clone(plan); },
  },
};
global.document = { getElementById: () => null };

for (const file of ["config.js", "optimizer.js", "canonical.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
for (const file of ["verifier.js", "planning-v12.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}

function stableEvidence(value) {
  if (Array.isArray(value)) return value.map(stableEvidence);
  if (!value || typeof value !== "object") return value;
  const result = {};
  Object.entries(value).forEach(([key, child]) => {
    if (["createdAt", "generatedAt", "completedAt", "savedAt", "timestamp", "exportedAt", "checkedAt"].includes(key)) {
      result[key] = "2026-09-01T00:00:00.000Z";
    } else if (["solveMs", "clientElapsedMs", "requestBuildAndSolveMs"].includes(key)) {
      result[key] = 0;
    } else {
      result[key] = stableEvidence(child);
    }
  });
  return result;
}

async function main() {
  window.STCTPlanning.setRawData(raw, { batchId: "SYNTHETIC-DIST" });
  await window.STCTOptimizer.generateScenarios({ raw, date: "2026-09-01", limit: "ALL" });
  window.STCTPlanning.selectScenario("balanced");
  await window.STCTPlanning.applySelected();
  if (!applied?.verification || applied.verification.status !== "PASS") throw new Error("Synthetic route snapshot failed verifier.");
  const payload = stableEvidence({
    ...applied,
    meta: {
      ...(applied.meta || {}),
      source: "STCT v1.4 fully synthetic demo",
      synthetic: true,
      syntheticSeed: raw.meta.seed,
      dataClassification: "fully-synthetic",
    },
  });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `window.FLOWMAP_DATA = ${JSON.stringify(payload)};\n`, "utf8");
  process.stdout.write(`${destination}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
