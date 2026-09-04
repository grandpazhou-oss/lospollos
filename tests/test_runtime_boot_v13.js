#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const neverResolves = new Promise(() => {});
const window = {
  fetch: () => neverResolves,
  crypto: globalThis.crypto,
  STCTUtils: { clone: (value) => JSON.parse(JSON.stringify(value)) },
  STCTOptimizer: {
    assumptions: () => ({}),
    planMetrics: () => ({}),
  },
  STCTPlanning: {
    state: {},
    setRawData() {},
    markPreview() {},
  },
  dispatchEvent() {},
};
const context = vm.createContext({
  window,
  document: {},
  console,
  crypto: globalThis.crypto,
  TextEncoder,
  URL,
  URLSearchParams,
  CustomEvent: class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  },
  setTimeout,
  clearTimeout,
});

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

load("canonical.js");
load("verifier.js");
assert.ok(window.STCTVerifier, "verifier must initialize while the contract fetch is pending");
assert.strictEqual(typeof window.STCTVerifier.verify, "function");

load("planning-v12.js");
assert.strictEqual(typeof window.STCTPlanning.updateSettings, "function", "planning extension must not be skipped");
assert.strictEqual(window.STCTPlanning.state.version, "v1.4-trust-closure-mission-control");

console.log(JSON.stringify({ status: "PASS", checks: 4, contractState: "pending" }));
