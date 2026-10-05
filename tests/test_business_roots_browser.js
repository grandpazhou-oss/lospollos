"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const evidence = process.env.STCT_ENTERPRISE_EVIDENCE;
assert.ok(evidence, "Set STCT_ENTERPRISE_EVIDENCE to a dedicated output directory");
fs.mkdirSync(evidence, { recursive: true });
const base = (process.env.STCT_ENTERPRISE_URL || "http://127.0.0.1:9956/index.html?optPort=9958&noWebGL=1").split("#")[0];
const expectedQuery = new URL(base).search;
const log = { status: "RUNNING", method: "PUBLIC_UI_AND_HASH_DEEP_LINKS_NO_STATE_INJECTION", checks: [], pageErrors: [] };
const save = () => fs.writeFileSync(path.join(evidence, "summary.json"), JSON.stringify(log, null, 2));
const identity = value => value && Object.fromEntries(["studyKind", "studyId", "inputHash", "resultHash"].map(key => [key, value[key] || null]));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.STCT_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-webgl"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
  await context.route("**/*", request => {
    const url = new URL(request.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol) ? request.continue() : request.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => log.pageErrors.push(error.message));
  const current = () => page.evaluate(() => window.STCTPlatformV19.instance.studyContext.snapshot().current);

  async function open(route) {
    await page.goto(`${base}#${route}`);
    const logicalPath = route.split("?")[0];
    await page.waitForFunction(value => window.STCTPlatformV19.instance.snapshot().activeRoute === value, logicalPath);
    await page.locator(`#platformRouteView[data-logical-route="${logicalPath}"]`).waitFor();
    assert.equal(new URL(page.url()).search, expectedQuery);
    assert.equal(new URL(page.url()).hash, `#${route}`);
  }

  async function checkRoutes(studyState, selected) {
    for (const locale of ["zh", "en", "ja"]) {
      await page.setViewportSize({ width: 1440, height: 950 });
      await open("/design");
      await page.locator("[data-platform-locale]").selectOption(locale);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 950 });
        for (const [route, businessSelector] of [["/design", '[data-design-route="/design/overview"]'], ["/command", '[data-command-route="/command/overview"]'], ["/command/validation", "[data-p6-empty-validation]"]]) {
          await open(route);
          await page.locator(businessSelector).waitFor();
          const body = await page.locator("#platformRouteOutlet").innerText();
          assert.doesNotMatch(body, /P2 NAVIGATION|DOMAIN NOT MIGRATED|PLATFORM GATE|OPERATIONAL_VALIDATION_CONTEXT_MISSING|担当 Gate|所属 Gate|当前 Gate|Current gate/);
          assert.deepEqual(identity(await current()), selected, `${studyState} preserved at ${route}`);
          if (route === "/design" && !selected) assert.equal(await page.locator(".p7-empty").count(), 1);
          if (route === "/command/validation") {
            const sourcePath = selected?.studyKind === "FACILITY" ? "/design/facility-location" : "/design/operational-validation";
            assert.equal(await page.locator(`[data-p6-empty-validation] a[href="#${sourcePath}"]`).count(), 1);
            assert.equal(await page.locator('[data-p6-empty-validation] a[href="#/platform/scenarios"]').count(), 1);
            assert.equal(await page.locator('[data-p6-empty-validation] a[href="#/platform/data"]').count(), 1);
            assert.equal(await page.locator('[data-p5-action="p6-run"]').count(), 0);
          }
          const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
          assert.ok(size.scrollWidth <= size.width + 1, `No page overflow: ${JSON.stringify(size)}`);
          const file = `${studyState}-${locale}-${width}-${route.replace(/\//g, "_")}.png`;
          await page.screenshot({ path: path.join(evidence, file), fullPage: true });
          log.checks.push({ studyState, locale, width, route, bodyExcerpt: body.slice(0, 240), identity: selected, size, screenshot: file });
          save();
        }
      }
    }
  }

  try {
    await page.goto(`${base}#/`);
    await page.locator("#loginForm .login-btn").click();
    await page.locator("#platformRouteView.active").waitFor();
    assert.equal(await current(), null);
    await checkRoutes("empty", null);

    await page.setViewportSize({ width: 1440, height: 950 });
    await open("/design");
    await page.locator('[data-design-action="p7-demo"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.studyContext.snapshot().current?.studyKind === "NETWORK_ORDERS");
    const network = identity(await current());
    await checkRoutes("explicit-network-demo", network);

    await page.setViewportSize({ width: 1440, height: 950 });
    await open("/design/facility-location");
    await page.locator('[data-design-action="facility-from-legacy"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.studyContext.snapshot().current?.studyKind === "FACILITY");
    const facility = identity(await current());
    await checkRoutes("explicit-facility-derivation", facility);
    await page.locator('[data-p6-empty-validation] a[href="#/design/facility-location"]').click();
    await page.locator('[data-design-route="/design/facility-location"]').waitFor();
    assert.deepEqual(identity(await current()), facility);
    log.checks.push({ name: "Facility trial entry returns to the current Facility study" });

    await page.setViewportSize({ width: 1440, height: 950 });
    await open("/platform/data");
    await page.locator("[data-v8-kind]").selectOption("SUPPLY_CHAIN_PERIOD");
    const xlsx = require("../vendor/xlsx/xlsx.full.min.js");
    const workbook = xlsx.utils.book_new();
    for (const [name, rows] of [
      ["Locations", [["name", "code", "role", "coordinate"], ["Origin A", "S-A", "FACTORY", "120,30"], ["Hub East", "W-E", "DC", "120.1,30"]]],
      ["Demand", [["customerNumber", "customer", "assignedDepot", "coordinate", "2026-01"], ["D-A", "Shop Alpha", "W-E", "120.2,30", 10]]],
      ["Inbound", [["flowId", "fromNodeId", "toNodeId", "2026-01"], ["F-A", "S-A", "W-E", 10]]],
    ]) xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), name);
    const file = path.join(evidence, "synthetic-period-input.xlsx");
    fs.writeFileSync(file, xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }));
    await page.locator("[data-p5-upload]").setInputFiles(file);
    await page.locator('[data-supply-action="profile-confirm"]').waitFor();
    await page.locator('[data-supply-field="studyName"]').fill("Synthetic period route acceptance");
    await page.locator('[data-supply-action="profile-confirm"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.studyContext.snapshot().current?.studyKind === "SUPPLY_CHAIN_PERIOD");
    const supply = identity(await current());
    await checkRoutes("public-period-import", supply);

    await page.setViewportSize({ width: 1440, height: 950 });
    await open("/command/validation?sessionId=missing-local-trial");
    await page.locator("[data-p6-empty-validation]").waitFor();
    await page.locator('[data-p6-empty-validation] a[href="#/platform/scenarios"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.snapshot().activeRoute === "/platform/scenarios");
    assert.deepEqual(identity(await current()), supply);
    await page.goBack();
    await page.locator("[data-p6-empty-validation]").waitFor();
    assert.equal(new URL(page.url()).hash, "#/command/validation?sessionId=missing-local-trial");
    assert.deepEqual(identity(await current()), supply);
    await page.reload();
    await page.locator("[data-p6-empty-validation]").waitFor();
    assert.equal(new URL(page.url()).search, expectedQuery);
    assert.equal(new URL(page.url()).hash, "#/command/validation?sessionId=missing-local-trial");
    log.checks.push({ name: "Validation deep link, link navigation, Browser Back and reload retain route/runtime query" });
    assert.deepEqual(log.pageErrors, []);
    log.status = "PASS";
  } catch (error) {
    log.status = "FAIL";
    log.error = error.stack;
    await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    save();
    await browser.close();
    console.log(JSON.stringify({ status: log.status, checks: log.checks.length, pageErrors: log.pageErrors, error: log.error }));
  }
})().catch(error => { console.error(error); process.exit(1); });
