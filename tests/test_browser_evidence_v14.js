#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");

const file = process.argv[2];
if (!file) throw new Error("Browser evidence path is required.");
const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
assert.strictEqual(evidence.version, "v1.4-trust-closure-mission-control");
assert.strictEqual(evidence.status, "PASS");
assert(["OR-Tools", "Demo Heuristic"].includes(evidence.engine));
for (const viewport of ["desktop", "mobilePortrait", "mobileLandscape"]) assert.strictEqual(evidence.viewports?.[viewport], "PASS", viewport);
for (const feature of ["replay", "arena", "timeline", "director", "fallback", "reducedMotion", "noWebGL"]) assert.strictEqual(evidence.features?.[feature], "PASS", feature);
assert.strictEqual(evidence.consoleErrors, 0);
assert.strictEqual(evidence.pageErrors, 0);
assert(Array.isArray(evidence.screenshots) && evidence.screenshots.length >= 3);
process.stdout.write(`${JSON.stringify({ status: "PASS", engine: evidence.engine, viewports: evidence.viewports, features: evidence.features }, null, 2)}\n`);
