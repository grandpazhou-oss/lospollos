#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Layers = require("../map-layer-registry-v16.js");

const root = path.resolve(__dirname, ".."); const checks = [];
function check(name, condition, detail = {}) { assert(condition, `${name}: ${JSON.stringify(detail)}`); checks.push({ name, status: "PASS", detail }); }
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const expectedScripts = ["road-network-fixture-v16.js", "road-routing-v16.js", "routing-provenance-v16.js", "routing-provider-registry-v16.js", "execution-twin-v16.js", "execution-store-v16.js", "plan-vs-actual-v16.js", "operations-alerts-v16.js", "offline-queue-v16.js", "dynamic-operations-capsule-v16.js", "experience-ui-v16.js", "driver-simulator-v16.js"];
check("index-single-close", (html.match(/<\/body><\/html>/g) || []).length === 1);
check("index-v16-entry", html.includes("data-v16-open") && html.includes("experience-v16.css"));
const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((match) => match[1]);
check("index-v16-scripts", expectedScripts.every((file) => scriptSources.filter((src) => src.split("?")[0] === `./${file}`).length === 1 && fs.existsSync(path.join(root, file))), expectedScripts);
check("index-driver-projection-dependency", html.indexOf("driver-local-projection-v17.js") >= 0 && html.indexOf("driver-local-projection-v17.js") < html.indexOf("driver-simulator-v16.js"));
check("index-script-order", expectedScripts.every((file, index) => index === 0 || html.indexOf(expectedScripts[index - 1]) < html.indexOf(file)));
const registry = Layers.createRegistry(); const registered = registry.registerAll("STATIC_TEST");
check("map-layer-count", registered.length === 12 && registry.count() === 12);
check("map-layer-contract", registered.every((layer) => layer.owner && Number.isInteger(layer.zIndex) && layer.dataMeaning && layer.zoomBehavior && layer.coordinateSpace && layer.legend && layer.reducedMotion && layer.noWebGLFallback), registered);
check("map-layer-cleanup", registry.cleanupOwner("STATIC_TEST").remaining === 0 && registry.count() === 0);
const coreFiles = fs.readdirSync(root).filter((file) => /v16\.js$/.test(file));
const forbidden = ["Production TMS", "Live Control Tower", "Real-Time GPS Platform", "Digital Twin of Real Operations", "Certified Routing System"];
check("forbidden-claims", coreFiles.every((file) => forbidden.every((phrase) => !fs.readFileSync(path.join(root, file), "utf8").includes(phrase))), coreFiles);
check("namespace", coreFiles.every((file) => !/window\.[A-Za-z_$][\w$]*\s*=/.test(fs.readFileSync(path.join(root, file), "utf8"))), coreFiles);
const lineCounts = Object.fromEntries(coreFiles.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).length]));
check("core-file-budget", Object.values(lineCounts).every((count) => count <= 900), lineCounts);
const testFiles = fs.readdirSync(__dirname).filter((file) => /v16\.(?:js|py)$/.test(file)); const testLineCounts = Object.fromEntries(testFiles.map((file) => [file, fs.readFileSync(path.join(__dirname, file), "utf8").split(/\r?\n/).length]));
check("test-file-budget", Object.values(testLineCounts).every((count) => count <= 800), testLineCounts);
check("truth-boundary", fs.readFileSync(path.join(root, "experience-ui-v16.js"), "utf8").includes("Local Simulation / Not Live Operations") && fs.readFileSync(path.join(root, "plan-vs-actual-v16.js"), "utf8").includes("Simulated Actual"));
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, files: coreFiles.length }, null, 2)}\n`);
