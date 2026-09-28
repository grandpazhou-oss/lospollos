#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const Router = require("../workspace-router-v19.js");
const State = require("../workspace-state-v19.js");
const { createChecks, createFakeEnvironment, waitUntil, printResult } = require("./platform-v19-test-utils.js");

const { assertions, check } = createChecks("tests/test_workspace_deep_links_v19.js");
const repo = path.resolve(__dirname, "..");

function directLocation(hash, search) {
  return { pathname: "/index.html", search: search || "", hash };
}

function createHarness(url) {
  const environment = createFakeEnvironment(url);
  const authority = State.createAuthority();
  const mounted = [];
  const errors = [];
  const router = Router.createRouter({
    stateAuthority: authority,
    environment,
    mountRoute(context) { mounted.push(context.logicalPath); return { cleanup() {} }; },
    mountError(context) { errors.push(context.error.code); return { cleanup() {} }; },
  });
  return { environment, authority, mounted, errors, router };
}

async function staticFixtureSmoke(prefix, routeHash) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const nested = path.join(root, "random", "static", "directory");
  fs.mkdirSync(nested, { recursive: true });
  const files = [
    "platform-route-errors-v19.js",
    "workspace-registry-v19.js",
    "legacy-route-mapping-v19.js",
    "workspace-state-v19.js",
    "workspace-router-v19.js",
  ];
  files.forEach((file) => fs.copyFileSync(path.join(repo, file), path.join(nested, file)));
  fs.writeFileSync(path.join(nested, "index.html"), `<!doctype html><meta charset="utf-8"><title>P1 Dist Proof</title>${files.map((file) => `<script src="./${file}"></script>`).join("")}<main>Supply Chain Decision Platform</main>\n`);
  const server = http.createServer((request, response) => {
    const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
    const fileName = requestPath === "/index.html" || requestPath === "/" ? "index.html" : path.basename(requestPath);
    const target = path.join(nested, fileName);
    if (!fs.existsSync(target)) { response.writeHead(404); response.end("missing"); return; }
    response.writeHead(200, { "content-type": fileName.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(fs.readFileSync(target));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  function request(file) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/${file}`, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      }).on("error", reject);
    });
  }
  try {
    const statuses = await Promise.all([request("index.html?optPort=19001"), ...files.map(request)]);
    const parsed = Router.parseBrowserLocation(directLocation(routeHash, "?optPort=19001&v=p1"));
    return { ok: statuses.every((status) => status === 200) && parsed.ok, statuses, route: parsed.logicalPath, root };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  for (const [requirementId, hash, route, workspace] of [
    ["T0064", "#/design/facility-location", "/design/facility-location", "DESIGN"],
    ["T0065", "#/command/dispatch", "/command/dispatch", "COMMAND"],
    ["T0066", "#/platform/trust", "/platform/trust", "PLATFORM"],
  ]) {
    const parsed = Router.parseBrowserLocation(directLocation(hash));
    check(requirementId, parsed.ok && parsed.logicalPath === route && parsed.descriptor.workspace === workspace, parsed, `${route} direct link`);
  }

  for (const [requirementId, url, route, workspace] of [
    ["T0067", "http://test.local/index.html#/design/network-scenarios", "/design/network-scenarios", "DESIGN"],
    ["T0068", "http://test.local/index.html#/command/execution", "/command/execution", "COMMAND"],
    ["T0069", "http://test.local/index.html#/platform/settings", "/platform/settings", "PLATFORM"],
  ]) {
    const harness = createHarness(url);
    await harness.router.start();
    check(requirementId, harness.authority.snapshot().activeRoute === route && harness.authority.snapshot().activeWorkspace === workspace, harness.authority.snapshot(), "reload restores route and workspace");
    await harness.router.stop();
  }

  const historyHarness = createHarness("http://test.local/index.html#/");
  await historyHarness.router.start();
  await historyHarness.router.navigate("/design/overview");
  await historyHarness.router.navigate("/command/dispatch");
  historyHarness.environment.history.back();
  await waitUntil(() => historyHarness.authority.snapshot().activeRoute === "/design/overview");
  check("T0070", historyHarness.authority.snapshot().activeRoute === "/design/overview", { route: historyHarness.authority.snapshot().activeRoute, history: historyHarness.environment.history.rows() }, "/design/overview restored by Back");
  historyHarness.environment.history.forward();
  await waitUntil(() => historyHarness.authority.snapshot().activeRoute === "/command/dispatch");
  check("T0071", historyHarness.authority.snapshot().activeRoute === "/command/dispatch", { route: historyHarness.authority.snapshot().activeRoute, history: historyHarness.environment.history.rows() }, "/command/dispatch restored by Forward");
  const bookmark = Router.parseBrowserLocation(directLocation("#/design/resilience"));
  check("T0072", bookmark.ok && bookmark.descriptor.workspace === "DESIGN", bookmark.descriptor, "bookmark selects DESIGN");

  const spaced = Router.parseBrowserLocation(directLocation("#/design/facility-location?studyId=Quarter%20Plan"));
  check("T0098", spaced.ok && spaced.routeParams.studyId === "Quarter Plan", spaced.routeParams, "encoded spaces decoded safely");
  const chinese = Router.parseBrowserLocation(directLocation("#/platform/scenarios?scenarioId=%E5%A4%A9%E6%B4%A5%E6%96%B9%E6%A1%88"));
  const japanese = Router.parseBrowserLocation(directLocation("#/platform/scenarios?scenarioId=%E7%86%8A%E6%9C%AC%E8%A8%88%E7%94%BB"));
  check("T0099", chinese.ok && chinese.routeParams.scenarioId === "天津方案" && japanese.ok && japanese.routeParams.scenarioId === "熊本計画", { chinese: chinese.routeParams, japanese: japanese.routeParams }, "Chinese and Japanese IDs preserved");
  check("ADV-12", chinese.ok && japanese.ok, { chinese: chinese.routeParams, japanese: japanese.routeParams }, "Chinese and Japanese route-associated IDs supported");

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = () => { fetchCalls += 1; throw new Error("unexpected fetch"); };
  const unsafeResults = ["javascript:alert(1)", "data:text/html,x", "https://external.example/", "../../etc/passwd"].map((target) => Router.parseLogicalTarget(target));
  global.fetch = originalFetch;
  check("T0100", unsafeResults.every((result) => !result.ok && result.error.code === "PLATFORM_ROUTE_UNSAFE_VALUE") && fetchCalls === 0, { codes: unsafeResults.map((row) => row.error.code), fetchCalls }, "unsafe route state rejected without external request", true);
  check("ADV-03", unsafeResults.every((result) => !result.ok) && fetchCalls === 0, { targets: 4, fetchCalls }, "javascript, data, external URL, and traversal rejected", true);

  const readme = fs.readFileSync(path.join(repo, "README-PLATFORM-ROUTING-V19.md"), "utf8");
  check("T0101", readme.includes("static-host-safe hash route") && readme.includes("Browser Back, Forward, reload"), "hash/history decision documented", "documented");
  check("T0102", readme.includes("#/design/facility-location") && readme.includes("#/command/dispatch") && readme.includes("#/platform/trust"), "deep-link examples present", "generated README");

  const randomSmoke = await staticFixtureSmoke("stct-p1-random-", "#/design/facility-location");
  check("T0103", randomSmoke.ok && randomSmoke.route === "/design/facility-location", randomSmoke, "random-directory static route smoke passes");
  check("ADV-09", randomSmoke.ok, randomSmoke, "random-directory static server passes");
  const distSmoke = await staticFixtureSmoke("stct-p1-dist-", "#/command/dispatch");
  check("T0104", distSmoke.ok && distSmoke.route === "/command/dispatch", distSmoke, "P1-only temporary Dist proof passes");
  const fallback = Router.parseBrowserLocation(directLocation("#/command/dispatch", "?forceHeuristic=1&v=fallback"));
  check("T0105", fallback.ok && fallback.runtimeQuery.kept.forceHeuristic === "1" && fallback.logicalPath === "/command/dispatch", fallback, "fallback route smoke passes");
  const noWebGL = Router.parseBrowserLocation(directLocation("#/command/dispatch", "?noWebGL=1&no-webgl=1"));
  check("T0106", noWebGL.ok && noWebGL.runtimeQuery.kept.noWebGL === "1" && noWebGL.runtimeQuery.kept["no-webgl"] === "1", noWebGL, "no-WebGL direct route smoke passes");
  check("ADV-10", noWebGL.ok && noWebGL.logicalPath === "/command/dispatch", noWebGL, "no-WebGL direct link preserves route");

  const malformed = Router.parseBrowserLocation(directLocation("#/%E0%A4%A"));
  check("ADV-02", !malformed.ok && malformed.error.code === "PLATFORM_ROUTE_INVALID_ENCODING", malformed.error, "malformed hash controlled", true);
  const roots = ["#/design", "#/command", "#/platform/data"].map((hash) => Router.parseBrowserLocation(directLocation(hash)));
  check("ADV-04", roots.every((row) => row.ok), roots.map((row) => row.logicalPath), "every workspace root reloads");
  const query = Router.parseBrowserLocation(directLocation("#/command/dispatch", "?optPort=8787&v=abc&accessToken=drop&unknown=drop"));
  check("ADV-05", query.runtimeQuery.kept.optPort === "8787" && query.runtimeQuery.kept.v === "abc" && query.runtimeQuery.droppedSensitive.includes("accessToken") && query.runtimeQuery.dropped.includes("unknown"), query.runtimeQuery, "allowed query kept and unknown sensitive query dropped", true);
  const reduced = Router.parseBrowserLocation(directLocation("#/design/overview", "?reduced-motion=1"));
  check("ADV-11", reduced.ok && reduced.runtimeQuery.kept["reduced-motion"] === "1", reduced, "reduced-motion direct link");

  const listenersBeforeCycles = { popstate: historyHarness.environment.listenerCount("popstate"), hashchange: historyHarness.environment.listenerCount("hashchange") };
  for (let index = 0; index < 10; index += 1) {
    historyHarness.environment.history.back();
    await waitUntil(() => historyHarness.authority.snapshot().activeRoute === "/design/overview");
    historyHarness.environment.history.forward();
    await waitUntil(() => historyHarness.authority.snapshot().activeRoute === "/command/dispatch");
  }
  const listenersAfterCycles = { popstate: historyHarness.environment.listenerCount("popstate"), hashchange: historyHarness.environment.listenerCount("hashchange") };
  check("ADV-15", JSON.stringify(listenersBeforeCycles) === JSON.stringify(listenersAfterCycles), { before: listenersBeforeCycles, after: listenersAfterCycles }, "no listener growth after ten Back/Forward cycles");
  await historyHarness.router.stop();
  printResult(assertions);
}

main().catch((error) => { console.error(error); process.exit(1); });
