"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Guard = require("../workspace-unsaved-guard-v19.js");
const Navigation = require("../platform-navigation-v19.js");

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function testLatestGuardedIntent() {
  const confirmation = deferred();
  const calls = [];
  let confirms = 0;
  const snapshot = {
    activeWorkspace: "DESIGN",
    activeRoute: "/design/facility-location",
    locale: "en",
    revision: 7,
    workspaceStates: { DESIGN: { dirty: true } },
  };
  const guard = Guard.createGuard({
    snapshot: () => snapshot,
    message: () => "confirm",
    confirm: () => { confirms += 1; return confirmation.promise; },
    navigate: async (target) => { calls.push(target); return { ok: true, target }; },
  });

  const first = guard.request("/command/overview", "COMMAND", { historyMode: "push" });
  await Promise.resolve();
  const middle = guard.request("/platform/data", "PLATFORM", { historyMode: "push" });
  const latest = guard.request("/command/alerts", "COMMAND", { historyMode: "push" });
  confirmation.resolve(true);

  const [firstResult, middleResult, latestResult] = await Promise.all([first, middle, latest]);
  assert.equal(confirms, 1, "one confirmation must cover a rapid guarded sequence");
  assert.deepEqual(calls, ["/command/alerts"], "only the latest valid target may navigate");
  assert.equal(firstResult.stale, true);
  assert.equal(middleResult.stale, true);
  assert.equal(latestResult.ok, true);
}

async function testLatestIntentDuringMount() {
  const firstMount = deferred();
  const calls = [];
  let confirms = 0;
  const snapshot = {
    activeWorkspace: "DESIGN",
    activeRoute: "/design/facility-location",
    locale: "en",
    revision: 11,
    workspaceStates: { DESIGN: { dirty: true } },
  };
  const guard = Guard.createGuard({
    snapshot: () => snapshot,
    message: () => "confirm",
    confirm: async () => { confirms += 1; return true; },
    navigate: (target) => {
      calls.push(target);
      return calls.length === 1 ? firstMount.promise : Promise.resolve({ ok: true, target });
    },
  });

  const first = guard.request("/command/overview", "COMMAND", { historyMode: "push" });
  await Promise.resolve();
  await Promise.resolve();
  const latest = guard.request("/command/execution", "COMMAND", { historyMode: "push" });
  firstMount.resolve({ ok: false, controlled: true, stale: true });
  const [firstResult, latestResult] = await Promise.all([first, latest]);
  assert.equal(confirms, 1, "an accepted guard must not open a second overlapping prompt");
  assert.deepEqual(calls, ["/command/overview", "/command/execution"]);
  assert.equal(firstResult.stale, true);
  assert.equal(latestResult.ok, true);
}

function testDrawerScrollBoundary() {
  const documentValue = { body: { style: { overflow: "auto" } } };
  const lock = Navigation.createBodyScrollLock(documentValue);
  lock.sync(true);
  lock.sync(true);
  assert.equal(documentValue.body.style.overflow, "hidden");
  assert.equal(lock.snapshot().priorOverflow, "auto", "repeated open sync must not overwrite prior overflow");
  lock.sync(false);
  assert.equal(documentValue.body.style.overflow, "auto");

  documentValue.body.style.overflow = "scroll";
  lock.sync(true);
  lock.destroy();
  assert.equal(documentValue.body.style.overflow, "scroll", "destroy must restore the latest pre-open value");
}

function testPlatformLoginNaming() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const loginBoundary = html.slice(html.indexOf('id="loginScreen"'), html.indexOf('<div class="app locked'));
  assert(html.includes("<title>Supply Chain Decision Platform</title>"));
  assert(loginBoundary.includes("Supply Chain Decision<br>Platform"));
  assert(!loginBoundary.includes("LOGISTEED") && !loginBoundary.includes("Smart Transportation Control Tower"));
  assert(loginBoundary.includes("Mock Login") && loginBoundary.includes("非安全认证"));
}

async function run() {
  await testLatestGuardedIntent();
  await testLatestIntentDuringMount();
  testDrawerScrollBoundary();
  testPlatformLoginNaming();
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: 16, suite: "P2.1 integrity closure" }, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
