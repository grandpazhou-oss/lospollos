#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "stct-v14-synthetic-test-"));
const first = path.join(temporary, "first.json");
const second = path.join(temporary, "second.json");
const generator = path.join(root, "scripts", "build_demo_data_v14.js");
const run = (output) => spawnSync(process.execPath, [generator, output], { encoding: "utf8" });
const firstRun = run(first);
const secondRun = run(second);
assert.strictEqual(firstRun.status, 0, firstRun.stderr);
assert.strictEqual(secondRun.status, 0, secondRun.stderr);
const firstBytes = fs.readFileSync(first);
const secondBytes = fs.readFileSync(second);
assert(firstBytes.equals(secondBytes));
const hash = crypto.createHash("sha256").update(firstBytes).digest("hex");
assert.strictEqual(hash, "10c322b6ae511eee378a598e640de9d63609bb0da7d0aac40c8d939590f9729a");
const data = JSON.parse(firstBytes);
assert.strictEqual(data.meta.synthetic, true);
assert.strictEqual(data.meta.seed, 140031);
assert.strictEqual(new Set(data.orders.map((order) => order.date)).size, 3);
assert.deepStrictEqual([...new Set(data.orders.map((order) => order.priority))].sort(), ["high", "medium", "normal"]);
assert(data.orders.every((order) => order.twStart && order.twEnd));
assert(data.orders.some((order) => order.volume === 1));
global.window = {};
require(path.join(root, "validator.js"));
const uploadValidation = window.STCTValidator.validateUploadData({ __rawUpload: true, raw: data });
assert.strictEqual(uploadValidation.canApply, true);
assert.strictEqual(uploadValidation.metrics.plannableOrders, data.orders.length);
assert.strictEqual(uploadValidation.metrics.usableVehicles, data.vehicles.length);
const pressureDate = "2026-09-02";
const pressureVolume = data.orders.filter((order) => order.date === pressureDate).reduce((sum, order) => sum + order.volume, 0);
const fleetVolume = data.vehicles.reduce((sum, vehicle) => sum + vehicle.maxVolume, 0);
assert(pressureVolume > fleetVolume);
assert(pressureVolume <= fleetVolume + data.vehicles[0].maxVolume);
const serialized = firstBytes.toString("utf8");
for (const marker of ["来伊份", "laiyifen", "医薬熊本", "熊本県", "/Users/", "file:///Users"]) assert(!serialized.includes(marker), marker);

const protectedWorkbook = path.join(root, "templates", "laiyifen-202605-rawdata.xlsx");
const protectedHash = crypto.createHash("sha256").update(fs.readFileSync(protectedWorkbook)).digest("hex");
assert.strictEqual(protectedHash, "9c2ad74f25c98a3ef7db7ea7d64cc9670504dd8edb54f3b485c4575778025d31");

process.stdout.write(`${JSON.stringify({ status: "PASS", seed: data.meta.seed, sha256: hash, dates: 3, orders: data.orders.length, pressureVolume, fleetVolume, uploadCanApply: true, usableVehicles: data.vehicles.length, originalWorkbookUnchanged: true }, null, 2)}\n`);
fs.rmSync(temporary, { recursive: true, force: true });
