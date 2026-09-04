#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const [tsvPath, jsonPath, mdPath, mode = "release"] = process.argv.slice(2);
if (!tsvPath || !jsonPath || !mdPath) throw new Error("Usage: summarize_v16.js suites.tsv summary.json summary.md mode");
const rows = fs.readFileSync(tsvPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => { const [suite, status, code, evidence] = line.split("\t"); return { suite, status, exitCode: Number(code), evidence: path.basename(evidence) }; });
const counts = rows.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {}); const status = rows.some((row) => row.status === "FAIL" || row.status === "BLOCKED_ENVIRONMENT") ? "FAIL" : "PASS";
const summary = { schemaVersion: "stct-v1.6-test-summary", version: "STCT-v1.6", mode, status, generatedAt: new Date().toISOString(), counts, suites: rows };
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
const md = [`# STCT v1.6 Test Summary`, ``, `- Mode: \`${mode}\``, `- Status: **${status}**`, `- Suites: ${rows.length}`, ``, `| Suite | Status | Evidence |`, `| --- | --- | --- |`, ...rows.map((row) => `| ${row.suite} | ${row.status} | \`${row.evidence}\` |`), ``, `Statuses distinguish business failures from dependency/configuration and measurement boundaries.`, ``].join("\n"); fs.writeFileSync(mdPath, md);
process.stdout.write(`${JSON.stringify({ status, mode, suites: rows.length, counts, jsonPath, mdPath }, null, 2)}\n`); process.exit(status === "PASS" ? 0 : 1);
