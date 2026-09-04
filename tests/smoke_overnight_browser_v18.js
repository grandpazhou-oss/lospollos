#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const valueAfter = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = path.resolve(valueAfter("--root", path.resolve(__dirname, "..")));
const capsulePath = path.resolve(valueAfter("--capsule"));
const outputDir = path.resolve(valueAfter("--output-dir"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const Visual = require(path.join(root, "network-visualization-v18.js"));
const capsule = JSON.parse(fs.readFileSync(capsulePath, "utf8"));
const source = capsule.sections.networkScenario;
const plan = capsule.sections.networkPlan;
const model = Visual.buildModel(source, plan, { alerts: [], execution: { conflicts: [], incidents: [] }, delays: [] });

function sha256(file) {
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function profile(browser, spec) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    locale: spec.locale === "zh" ? "zh-CN" : spec.locale === "ja" ? "ja-JP" : "en-US",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const html = Visual.renderHTML(model, { locale: spec.locale, noWebGL: true, mobile: spec.mobile });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const observed = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    noWebGL: document.querySelector(".shell")?.dataset.noWebgl,
    fallback: Boolean(document.querySelector(".fallback")),
    tableRows: document.querySelectorAll(".fallback tbody tr").length,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    meaningful: document.body.innerText.includes("Smart Transportation Control Tower"),
  }));
  const screenshot = path.join(outputDir, spec.name + ".png");
  await page.screenshot({ path: screenshot, fullPage: false });
  await context.close();
  return { ...spec, observed, errors, screenshot: path.basename(screenshot), screenshotHash: sha256(screenshot) };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  let profiles;
  try {
    profiles = [];
    for (const spec of [
      { name: "desktop-zh", locale: "zh", viewport: { width: 1440, height: 900 }, mobile: false },
      { name: "mobile-portrait-en", locale: "en", viewport: { width: 390, height: 844 }, mobile: true },
      { name: "mobile-landscape-ja", locale: "ja", viewport: { width: 844, height: 390 }, mobile: true },
    ]) {
      profiles.push(await profile(browser, spec));
    }
  } finally {
    await browser.close();
  }
  const passed = profiles.every((row) =>
    row.errors.length === 0 &&
    row.observed.lang === row.locale &&
    row.observed.noWebGL === "true" &&
    row.observed.fallback &&
    row.observed.tableRows > 0 &&
    row.observed.reduced &&
    row.observed.scrollWidth <= row.observed.clientWidth + 1 &&
    row.observed.meaningful &&
    /^sha256:[0-9a-f]{64}$/.test(row.screenshotHash)
  );
  assert(passed, JSON.stringify(profiles));
  process.stdout.write(JSON.stringify({
    schemaVersion: "stct-overnight-clean-room-browser-v1.8",
    status: "PASS",
    source: "ACTUAL_LOCAL_CHROME_VIA_PLAYWRIGHT",
    noWebGL: "PASS",
    reducedMotion: "PASS",
    desktop: "PASS",
    mobilePortrait: "PASS",
    mobileLandscape: "PASS",
    locales: { zh: "PASS", en: "PASS", ja: "PASS" },
    ownedServices: { started: 0, closed: 0, surviving: 0 },
    profiles,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exit(1);
});
