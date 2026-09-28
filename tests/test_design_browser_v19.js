"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const evidenceDir = path.resolve(process.env.STCT_EVIDENCE_DIR || path.join(root, "test-results", "design-v19"));
const screenshotDir = path.join(evidenceDir, "screenshots");
fs.mkdirSync(screenshotDir, { recursive: true });

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.resolve(root, `.${relative}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end("Forbidden"); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(bytes);
  });
});

function listen() { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); }); }
function closeServer() { return new Promise((resolve) => server.close(resolve)); }
const observations = [];
function pass(id, description, detail = true) { observations.push({ id, status: "PASS", description, detail }); }

(async () => {
  const port = await listen();
  const executablePath = process.env.STCT_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  const publicRoutingRequests = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(`http://127.0.0.1:${port}`) && /route|matrix|optimi[sz]|directions|ors|osrm/i.test(url)) publicRoutingRequests.push(url);
  });

  const base = `http://127.0.0.1:${port}/index.html`;
  await page.goto(`${base}#/design/overview`, { waitUntil: "load" });
  await page.waitForSelector('[data-design-route="/design/overview"]', { timeout: 20000 });
  await page.locator("#loginForm .login-btn").click();
  await page.waitForTimeout(100);
  if (await page.locator('.p7-empty').count()) await page.locator('[data-design-action="p7-demo"]').click();

  const routeNames = ["overview", "facility-location", "network-scenarios", "fleet-capacity", "cost-to-serve", "demand-growth", "resilience", "operational-validation"];
  const routeScreenshots = [];
  for (let index = 0; index < routeNames.length; index += 1) {
    const route = `/design/${routeNames[index]}`;
    await page.evaluate((target) => { window.STCTPlatformV19.instance.navigate(target); }, route);
    await page.waitForSelector(`[data-design-route="${route}"]`);
    const heading = (await page.locator(".design-page-heading h1").textContent()).trim();
    assert.ok(heading);
    const file = path.join(screenshotDir, `route-${routeNames[index]}-desktop.png`);
    await page.screenshot({ path: file, fullPage: true });
    routeScreenshots.push({ route, file, bytes: fs.statSync(file).size });
    pass(`BROWSER-T${String(245 + index).padStart(4, "0")}`, `${route} renders in the real browser`, heading);
  }
  pass("BROWSER-DESIGN-ROUTE-SCREENSHOTS", "All eight DESIGN routes have browser screenshots", routeScreenshots);

  const p31Browser = await page.evaluate(async () => {
    const context = window.STCTPlatformV19.commandOperationalContext.createContext();
    await context.ready;
    await context.driver.acceptRoute();
    await context.driver.depart();
    await context.driver.goOffline();
    const queued = [await context.driver.arrive(), await context.driver.startService(), await context.driver.complete()];
    const projected = context.driver.viewModel();
    const actionRows = window.STCTPlatformV19.operationsActionCenter.project(context).items.filter((row) => row.ruleId);
    const semantics = Object.fromEntries(actionRows.map((row) => [row.ruleId, { category: row.category, actionType: row.actionType }]));
    const rawNote = "<b>A&B</b>";
    const handoff = window.STCTPlatformV19.shiftHandoff.generate(context, window.STCTPlatformV19.operationsActionCenter.project(context), { operatorNotes: [rawNote] });
    const sourceBytes = JSON.stringify(handoff);
    const imported = window.STCTPlatformV19.shiftHandoff.importReadOnly(window.STCTPlatformV19.shiftHandoff.toJson(handoff), context);
    const html = window.STCTPlatformV19.shiftHandoff.toPrintableHtml(imported.pack);
    const reconnect = await context.driver.reconnect();
    return {
      queueStatuses: queued.map((row) => row.status),
      projectionAuthority: projected.projectionAuthority,
      projectedStopState: projected.localProjectedCurrentStop?.state,
      semantics,
      reconnectStatus: reconnect.status,
      ackStatuses: reconnect.sync.results.map((row) => row.status),
      ackAuditCount: context.offlineQueue.summary().ackAuditCount,
      handoffImportStatus: imported.status,
      handoffReadOnly: imported.envelope.readOnly,
      handoffSourcePreserved: JSON.stringify(imported.pack) === sourceBytes,
      noteStoredRaw: handoff.operatorNotes[0].text === rawNote,
      noteEscapedOnce: html.includes("&lt;b&gt;A&amp;B&lt;/b&gt;") && !html.includes("&amp;lt;b&amp;gt;"),
    };
  });
  assert.deepEqual(p31Browser.queueStatuses, ["QUEUED_OFFLINE", "QUEUED_OFFLINE", "QUEUED_OFFLINE"]);
  assert.equal(p31Browser.projectionAuthority, "LOCAL_DRIVER_PROJECTION_V17");
  assert.equal(p31Browser.reconnectStatus, "RECONNECTED");
  assert.deepEqual(p31Browser.ackStatuses, ["ACKED", "ACKED", "ACKED"]);
  assert.equal(p31Browser.ackAuditCount, 3);
  assert.equal(p31Browser.semantics.OFF_ROUTE?.actionType, "OFF_ROUTE");
  assert.equal(p31Browser.semantics.ROUTE_STALLED?.actionType, "ROUTE_STALLED");
  assert.equal(p31Browser.semantics.ETA_RISK?.actionType, "ETA_RISK");
  assert.equal(p31Browser.semantics.EXCESS_DWELL?.actionType, "EXCESS_DWELL");
  assert.ok(p31Browser.handoffImportStatus === "PASS" && p31Browser.handoffReadOnly && p31Browser.handoffSourcePreserved);
  assert.ok(p31Browser.noteStoredRaw && p31Browser.noteEscapedOnce);
  pass("BROWSER-P31-DOMAIN-INTEGRITY", "Browser runtime closes Driver, Action Center and Handoff P3.1 flows", p31Browser);

  const commandScreenshots = [];
  for (const [name, route] of [["driver", "/command/driver-simulator"], ["action-center", "/command/overview"], ["handoff", "/command/shift-review"]]) {
    await page.evaluate((target) => { window.STCTPlatformV19.instance.navigate(target); }, route);
    await page.waitForSelector(`[data-command-route="${route}"]`);
    const file = path.join(screenshotDir, `p31-${name}-desktop.png`);
    await page.screenshot({ path: file, fullPage: true });
    commandScreenshots.push({ route, file, bytes: fs.statSync(file).size });
  }
  pass("BROWSER-P31-SCREENSHOTS", "Corrected P3.1 Driver, Action Center and Handoff surfaces have browser screenshots", commandScreenshots);

  await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/design/demand-growth"); });
  await page.locator('[data-design-action="demand"][data-design-id="DEMAND_10"]').click();
  let state = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.createStrategicStudy().snapshot());
  assert.equal(state.lifecycle, "SCENARIO_DIRTY");
  const changedInputHash = state.activeInputHash;
  await page.locator('[data-design-action="evaluate"]').click();
  state = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.createStrategicStudy().snapshot());
  assert.equal(state.lifecycle, "READY_FOR_REVIEW");
  assert.equal(state.evaluation.verification.status, "PASS");
  assert.equal(state.evaluation.accountingVerification.status, "PASS");
  pass("BROWSER-JOURNEY-001", "Demand scenario performs changed-input evaluate, verify and account", { inputHash: changedInputHash, evaluationHash: state.evaluation.evaluationHash });

  await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/design/network-scenarios"); });
  const portfolioCount = await page.locator(".design-scenario-list article").count();
  assert.ok(portfolioCount >= 2);
  await page.locator("[data-design-scenario-filter]").selectOption("DEMAND_PEAK");
  assert.equal(await page.locator(".design-scenario-list article").count(), 1);
  pass("BROWSER-T0283", "Scenario Library filter changes the visible scenario list", { before: portfolioCount, after: 1 });

  const commandPlanHash = await page.evaluate(() => window.STCTPlatformV19.instance.commandAdapter.createOperationalContext().snapshot().plan.planHash);
  await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/command/overview"); });
  await page.waitForSelector('[data-command-route="/command/overview"], .command-workspace', { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/design/network-scenarios"); });
  await page.waitForSelector('[data-design-route="/design/network-scenarios"]');
  const returned = await page.evaluate(() => ({ design: window.STCTPlatformV19.instance.designAdapter.createStrategicStudy().snapshot(), commandPlanHash: window.STCTPlatformV19.instance.commandAdapter.createOperationalContext().snapshot().plan.planHash }));
  assert.equal(returned.design.activeInputHash, changedInputHash);
  assert.equal(returned.commandPlanHash, commandPlanHash);
  pass("BROWSER-T0280", "DESIGN scenario survives COMMAND switch and COMMAND plan remains isolated", returned.design.activeScenarioId);

  await page.keyboard.press("Control+K");
  await page.waitForSelector(".design-dialog [data-design-finder]");
  await page.locator("[data-design-finder]").fill("D2");
  const finderCount = await page.locator("[data-design-result]").count();
  assert.ok(finderCount > 0);
  await page.keyboard.press("ArrowDown");
  assert.ok((await page.evaluate(() => document.activeElement?.hasAttribute("data-design-result"))) === true);
  await page.keyboard.press("Escape");
  pass("BROWSER-T0289", "Quick Finder supports keyboard open, search, arrow focus and Escape", finderCount);

  const finderTrigger = page.locator('[data-design-action="open-finder"]').first();
  await finderTrigger.focus();
  await finderTrigger.click();
  await page.waitForSelector(".design-dialog [data-design-finder]");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.designAction), "open-finder");
  pass("BROWSER-FOCUS-RESTORE", "Closing Quick Finder restores focus to the invoking control");

  const localeHeadings = {};
  const routeCopyKeys = { overview: "overview", "facility-location": "facility", "network-scenarios": "scenarios", "fleet-capacity": "fleet", "cost-to-serve": "cost", "demand-growth": "demand", resilience: "resilience", "operational-validation": "validation" };
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const locale of ["zh", "en", "ja"]) {
    await page.evaluate((value) => window.STCTPlatformV19.instance.setLocale(value), locale);
    localeHeadings[locale] = {};
    for (const name of routeNames) {
      const route = `/design/${name}`;
      await page.evaluate((target) => window.STCTPlatformV19.instance.navigate(target), route);
      await page.waitForSelector(`[data-design-route="${route}"]`);
      localeHeadings[locale][name] = (await page.locator(".design-page-heading h1").textContent()).trim();
      const expected = await page.evaluate(({ value, key, name }) => name === 'overview' || name === 'facility-location' ? window.STCTPlatformV19.taskViews.copy[value][name === 'overview' ? 'network' : 'facility'] : window.STCTPlatformV19.designWorkspaceAdapter.COPY[value][key], { value: locale, key: routeCopyKeys[name], name });
      assert.equal(localeHeadings[locale][name], expected, `${locale}:${route}`);
    }
  }
  pass("BROWSER-T0291-T0293", "All eight DESIGN route titles render in Chinese, English and Japanese", localeHeadings);

  await page.evaluate(() => window.STCTPlatformV19.instance.setNoWebGL(true));
  const noWebglRoutes = [];
  for (const name of routeNames) {
    const route = `/design/${name}`;
    await page.evaluate((target) => window.STCTPlatformV19.instance.navigate(target), route);
    await page.waitForSelector(`[data-design-route="${route}"]`);
    const surface = await page.evaluate(() => ({ canvasCount: document.querySelectorAll(".design-network-canvas").length, tableCount: document.querySelectorAll(".design-no-webgl table").length, heading: document.querySelector(".design-page-heading h1")?.textContent.trim() || "" }));
    assert.equal(surface.canvasCount, 0, `${route}: network canvas must not render in no-WebGL mode`);
    assert.ok(surface.heading, `${route}: no-WebGL route heading missing`);
    noWebglRoutes.push({ route, ...surface });
  }
  assert.ok(noWebglRoutes.some((row) => row.tableCount > 0));
  pass("BROWSER-T0286", "All eight DESIGN routes render in no-WebGL mode and network views use table-equivalent facts", noWebglRoutes);
  await page.evaluate(() => window.STCTPlatformV19.instance.setNoWebGL(false));

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotionRoutes = [];
  for (const name of routeNames) {
    const route = `/design/${name}`;
    await page.evaluate((target) => window.STCTPlatformV19.instance.navigate(target), route);
    await page.waitForSelector(`[data-design-route="${route}"]`);
    const animation = await page.locator(".design-route-active").evaluate((element) => getComputedStyle(element).animationDuration);
    assert.ok(animation === "0s" || animation === "0.001s" || animation === "", `${route}:${animation}`);
    reducedMotionRoutes.push({ route, animation: animation || "0s inherited" });
  }
  pass("BROWSER-T0287", "Reduced-motion mode preserves static content on all eight DESIGN routes", reducedMotionRoutes);

  await page.evaluate(() => {
    window.__stctObjectUrls = { created: [], revoked: [], create: URL.createObjectURL.bind(URL), revoke: URL.revokeObjectURL.bind(URL) };
    URL.createObjectURL = (blob) => { const value = window.__stctObjectUrls.create(blob); window.__stctObjectUrls.created.push(value); return value; };
    URL.revokeObjectURL = (value) => { window.__stctObjectUrls.revoked.push(value); return window.__stctObjectUrls.revoke(value); };
  });
  for (const [route, actions] of [["/design/fleet-capacity", ["fleet-json", "fleet-csv"]], ["/design/cost-to-serve", ["cost-json", "cost-csv", "cost-html"]], ["/design/demand-growth", ["demand-json", "demand-csv"]], ["/design/operational-validation", ["validation-json", "validation-csv"]]]) {
    await page.evaluate((target) => window.STCTPlatformV19.instance.navigate(target), route);
    await page.waitForSelector(`[data-design-route="${route}"]`);
    for (const action of actions) { const button = page.locator(`[data-design-action="${action}"]`), details = button.locator('xpath=ancestor::details[1]'); if (await details.count() && !await details.evaluate(element => element.open)) await details.locator('summary').click(); await button.click(); }
  }
  await page.waitForTimeout(50);
  const objectUrls = await page.evaluate(() => { const result = { created: [...window.__stctObjectUrls.created], revoked: [...window.__stctObjectUrls.revoked] }; URL.createObjectURL = window.__stctObjectUrls.create; URL.revokeObjectURL = window.__stctObjectUrls.revoke; delete window.__stctObjectUrls; return result; });
  assert.equal(objectUrls.created.length, 9);
  assert.deepEqual([...objectUrls.revoked].sort(), [...objectUrls.created].sort());
  pass("BROWSER-EXPORT-URL-CLEANUP", "Repeated DESIGN exports revoke every generated object URL", { count: objectUrls.created.length });

  await page.evaluate(() => window.STCTPlatformV19.instance.navigate("/design/network-scenarios"));
  await page.waitForSelector('[data-design-route="/design/network-scenarios"]');
  const focusTarget = page.locator('[data-design-action="open-finder"]').first();
  await focusTarget.focus();
  await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.createStrategicStudy().setView({ filters: { scenarioType: "ALL" } }));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.designAction), "open-finder");
  pass("BROWSER-BACKGROUND-FOCUS", "Background study updates preserve the focused DESIGN control");

  const diagnosticsBeforeSwitches = await page.evaluate(() => ({ router: window.STCTPlatformV19.instance.diagnostics(), design: window.STCTPlatformV19.instance.designAdapter.diagnostics() }));
  for (let cycle = 0; cycle < 3; cycle += 1) for (const name of routeNames) await page.evaluate((target) => window.STCTPlatformV19.instance.navigate(target), `/design/${name}`);
  const diagnosticsAfterSwitches = await page.evaluate(() => ({ router: window.STCTPlatformV19.instance.diagnostics(), design: window.STCTPlatformV19.instance.designAdapter.diagnostics() }));
  assert.deepEqual(diagnosticsAfterSwitches.router.cleanupErrors, []);
  assert.equal(diagnosticsAfterSwitches.design.mountCount - diagnosticsAfterSwitches.design.unmountCount, 1);
  assert.equal(diagnosticsAfterSwitches.design.cleanupCount, diagnosticsAfterSwitches.design.unmountCount);
  assert.ok(diagnosticsAfterSwitches.design.mountCount >= diagnosticsBeforeSwitches.design.mountCount + routeNames.length * 3);
  pass("BROWSER-ROUTE-LIFECYCLE-CLEANUP", "Repeated DESIGN route switches clean listeners and retain one active owner", diagnosticsAfterSwitches);

  await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/design/fleet-capacity"); });
  await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/design/cost-to-serve"); });
  await page.goBack();
  await page.waitForSelector('[data-design-route="/design/fleet-capacity"]');
  await page.goForward();
  await page.waitForSelector('[data-design-route="/design/cost-to-serve"]');
  pass("T0297", "Browser back and forward restore DESIGN routes");
  const reloadPage = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  reloadPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  reloadPage.on("pageerror", (error) => pageErrors.push(error.message));
  await reloadPage.goto(`${base}#/design/cost-to-serve`, { waitUntil: "load" });
  await reloadPage.waitForSelector('[data-design-route="/design/cost-to-serve"]', { state: "attached", timeout: 30000 });
  await reloadPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await reloadPage.waitForSelector('[data-design-route="/design/cost-to-serve"]', { state: "attached", timeout: 30000 });
  await reloadPage.close();
  pass("T0296", "Reload restores the active DESIGN deep link");

  const screenshots = [];
  for (const [name, width, height, locale] of [["desktop-zh", 1440, 900, "zh"], ["mobile-en", 390, 844, "en"], ["landscape-ja", 844, 390, "ja"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => window.STCTPlatformV19.instance.setLocale(value), locale);
    await page.evaluate(() => { window.STCTPlatformV19.instance.navigate("/design/overview"); });
    await page.waitForSelector('[data-design-route="/design/overview"]');
    const file = path.join(screenshotDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    assert.ok(fs.statSync(file).size > 10000);
    screenshots.push({ name, file, bytes: fs.statSync(file).size, viewport: `${width}x${height}`, locale });
  }
  pass("T0298", "DESIGN shell screenshot set exists", screenshots);

  const responsiveScreenshots = [];
  for (const [mode, width, height] of [["mobile", 390, 844], ["landscape", 844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const name of routeNames) {
      const route = `/design/${name}`;
      await page.evaluate((target) => { window.STCTPlatformV19.instance.navigate(target); }, route);
      await page.waitForSelector(`[data-design-route="${route}"]`);
      const layout = await page.evaluate(() => ({ viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, routeWidth: Math.ceil(document.querySelector(".design-workspace").getBoundingClientRect().width), headingVisible: document.querySelector(".design-page-heading h1")?.getBoundingClientRect().height > 0 }));
      assert.ok(layout.documentWidth <= layout.viewportWidth, `${mode}:${route}:document overflow ${layout.documentWidth}/${layout.viewportWidth}`);
      assert.ok(layout.bodyWidth <= layout.viewportWidth, `${mode}:${route}:body overflow ${layout.bodyWidth}/${layout.viewportWidth}`);
      assert.ok(layout.routeWidth <= layout.viewportWidth, `${mode}:${route}:route overflow ${layout.routeWidth}/${layout.viewportWidth}`);
      assert.equal(layout.headingVisible, true, `${mode}:${route}:heading hidden`);
      const file = path.join(screenshotDir, `route-${name}-${mode}.png`);
      await page.screenshot({ path: file, fullPage: true });
      assert.ok(fs.statSync(file).size > 8000);
      responsiveScreenshots.push({ mode, route, file, bytes: fs.statSync(file).size, layout });
    }
  }
  pass("BROWSER-RESPONSIVE-ALL-ROUTES", "All eight DESIGN routes fit mobile portrait and landscape viewports", responsiveScreenshots);
  const mismatchLedger = { schemaVersion: "stct-design-visual-mismatch-ledger-v1.9-p4", status: "PASS", screenshots, findings: [], reviewBoundary: "AUTOMATED_LAYOUT_AND_PIXEL_PRESENCE; HUMAN_AESTHETIC_REVIEW_PENDING" };
  const ledgerPath = path.join(evidenceDir, "P4_VISUAL_MISMATCH_LEDGER.json");
  fs.writeFileSync(ledgerPath, `${JSON.stringify(mismatchLedger, null, 2)}\n`);
  pass("T0299", "DESIGN shell visual mismatch ledger exists", ledgerPath);

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(publicRoutingRequests, []);
  pass("T0294", "DESIGN browser console and page errors are zero", { consoleErrors, pageErrors, publicRoutingRequests });

  const report = { schemaVersion: "stct-design-browser-test-v1.9-p4", status: "PASS", browser: "SYSTEM_GOOGLE_CHROME", localOnly: true, publicRoutingRequests: publicRoutingRequests.length, observations };
  fs.writeFileSync(path.join(evidenceDir, "P4_BROWSER_TEST_RESULT.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await closeServer();
})().catch(async (error) => {
  const report = { schemaVersion: "stct-design-browser-test-v1.9-p4", status: "FAIL", error: error.stack || error.message, observations };
  try { fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, "P4_BROWSER_TEST_RESULT.json"), `${JSON.stringify(report, null, 2)}\n`); } catch (_error) {}
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  try { await closeServer(); } catch (_error) {}
  process.exit(1);
});
