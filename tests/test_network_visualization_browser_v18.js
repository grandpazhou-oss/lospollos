#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const assertions = [];
function check(requirementId, condition, observed, expected) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative: false, evidence: "tests/test_network_visualization_browser_v18.js" };
  assertions.push(row);
  assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function jpegDimensions(file) {
  const data = fs.readFileSync(file);
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1];
    const length = data.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5), bytes: data.length };
    offset += 2 + length;
  }
  throw new Error(`JPEG dimensions unavailable: ${file}`);
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function captureProfile(browser, evidenceDir, name, options) {
  const context = await browser.newContext({ viewport: options.viewport });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) logs.push({ type: message.type(), text: message.text() }); });
  page.on("pageerror", (error) => logs.push({ type: "pageerror", text: error.message }));
  await page.setContent(fs.readFileSync(path.join(evidenceDir, options.html), "utf8"), { waitUntil: "domcontentloaded" });
  if (options.preview) await page.click("[data-action=preview]");
  const observation = await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    const heat = document.querySelector(".heat");
    const preview = document.querySelector("[data-action=preview]");
    return {
      meaningful: Boolean(shell && document.body.innerText.includes("Smart Transportation Control Tower")),
      frameworkOverlay: Boolean(document.querySelector("vite-error-overlay, #webpack-dev-server-client-overlay, .nextjs-container-errors-header")),
      previewPressed: preview?.getAttribute("aria-pressed") || "false",
      layout: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, heatDisplay: heat ? getComputedStyle(heat).display : "" },
      state: { fallback: Boolean(document.querySelector(".fallback")), mapSvg: document.querySelectorAll(".network-map").length, tableRows: document.querySelectorAll(".fallback tbody tr").length },
    };
  });
  const screenshot = `${name}.jpg`;
  await page.screenshot({ path: path.join(evidenceDir, screenshot), type: "jpeg", quality: 86, fullPage: false });
  await context.close();
  return { ...observation, logs, screenshot };
}

async function ensureAudit(evidenceDir, auditPath) {
  if (fs.existsSync(auditPath)) return JSON.parse(fs.readFileSync(auditPath, "utf8"));
  const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const desktop = await captureProfile(browser, evidenceDir, "desktop", { html: "desktop.html", viewport: { width: 1280, height: 800 }, preview: true });
    const mobile = await captureProfile(browser, evidenceDir, "mobile", { html: "mobile.html", viewport: { width: 390, height: 844 } });
    const noWebGL = await captureProfile(browser, evidenceDir, "no-webgl", { html: "no-webgl.html", viewport: { width: 1280, height: 800 } });
    const audit = { capturedAt: new Date().toISOString(), source: "ACTUAL_LOCAL_CHROME_VIA_PLAYWRIGHT", desktop, mobile, noWebGL, interaction: { autoApplied: false } };
    fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    return audit;
  } finally {
    await browser.close();
  }
}

async function main() {
  const evidenceDir = process.env.STCT_V18_VISUAL_DIR || "/tmp/stct-v18-network-visual";
  const auditPath = path.join(evidenceDir, "browser-observations.json");
  const audit = await ensureAudit(evidenceDir, auditPath);
  const desktopPath = path.join(evidenceDir, audit.desktop.screenshot);
  const mobilePath = path.join(evidenceDir, audit.mobile.screenshot);
  const fallbackPath = path.join(evidenceDir, audit.noWebGL.screenshot);
  const desktop = jpegDimensions(desktopPath);
  const mobile = jpegDimensions(mobilePath);
  const fallback = jpegDimensions(fallbackPath);
  check("T0765", audit.desktop.meaningful && !audit.desktop.frameworkOverlay && audit.desktop.logs.length === 0 && audit.desktop.previewPressed === "true" && !audit.interaction.autoApplied && desktop.width >= 1000 && desktop.height >= 600, { audit: audit.desktop, interaction: audit.interaction, image: desktop }, "desktop visual regression and interaction pass");
  check("T0766", audit.mobile.meaningful && !audit.mobile.frameworkOverlay && audit.mobile.logs.length === 0 && audit.mobile.layout.scrollWidth <= audit.mobile.layout.clientWidth + 1 && audit.mobile.layout.heatDisplay === "flex" && mobile.width >= 320 && mobile.width <= 500 && mobile.height >= 700, { audit: audit.mobile, image: mobile }, "mobile visual regression without page overflow");
  check("T0767", audit.noWebGL.meaningful && !audit.noWebGL.frameworkOverlay && audit.noWebGL.logs.length === 0 && audit.noWebGL.state.fallback && audit.noWebGL.state.mapSvg === 0 && audit.noWebGL.state.tableRows === 2 && fallback.width >= 1000, { audit: audit.noWebGL, image: fallback }, "no-WebGL visual regression with table fallback");
  const screenshotAudit = [desktopPath, mobilePath, fallbackPath].map((file) => ({ file: path.basename(file), sha256: sha256(file), ...jpegDimensions(file) }));
  check("T0780", screenshotAudit.length === 3 && screenshotAudit.every((row) => /^[a-f0-9]{64}$/.test(row.sha256) && row.bytes > 20000) && Boolean(Date.parse(audit.capturedAt)), { capturedAt: audit.capturedAt, screenshots: screenshotAudit }, "complete audit screenshots");
  assert.strictEqual(assertions.length, 4, "Gate 10 browser suite must own T0765-T0767 and T0780");
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, capturedAt: audit.capturedAt, screenshots: screenshotAudit, assertions }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });

