#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const testsDir = __dirname;
const sources = fs.readdirSync(testsDir)
  .filter((name) => /^test_.*v16\.(?:js|py|sh)$/.test(name) && name !== path.basename(__filename))
  .map((name) => path.join(testsDir, name));
sources.push(path.join(testsDir, "fixtures", "rolling-v16-fixture.js"));

const observed = new Set();
for (const source of sources) {
  const matches = fs.readFileSync(source, "utf8").match(/\bT\d{3}\b/g) || [];
  for (const id of matches) observed.add(id);
}

const expected = Array.from({ length: 648 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`);
const missing = expected.filter((id) => !observed.has(id));
const extra = [...observed].filter((id) => !expected.includes(id)).sort();

if (missing.length || extra.length) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", expected: 648, observed: observed.size, missing, extra }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ status: "PASS", checks: expected.length, range: "T001-T648", sourceFiles: sources.length }, null, 2)}\n`);
