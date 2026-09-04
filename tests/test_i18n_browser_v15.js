#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function option(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-i18n-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-i18n-browser.json"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = { version: "v1.5-i18n", status: "FAIL", checks: [], languages: {}, console: [] };
function check(id, condition, detail) { assert(condition, `${id}: ${JSON.stringify(detail)}`); evidence.checks.push({ id, status: "PASS", detail }); }
function candidate(base, suffix, adjustment) {
  const plan = clone(base); plan.planId = `PLAN-${suffix}`; plan.planHash = `sha256:plan-${suffix}`; plan.requestHash = `sha256:request-${suffix}`;
  plan.verification.computedPlanHash = plan.planHash; plan.verification.recomputedMetrics = { ...plan.verification.recomputedMetrics, ...adjustment }; plan.metrics = { ...plan.metrics, ...adjustment }; plan.labels = [suffix]; return plan;
}

async function runLanguage(browser, language, expected) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: language === "zh" ? "zh-CN" : language === "ja" ? "ja-JP" : "en-US" });
  const page = await context.newPage();
  page.on("console", (message) => evidence.console.push({ language, type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => evidence.console.push({ language, type: "pageerror", text: error.message }));
  try {
    await page.goto(`${baseUrl}-${language}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.selectOption("#loginLang", language); await page.fill("#loginUser", "demo"); await page.fill("#loginPass", "demo123"); await page.click(".login-btn");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });
    const fixture = buildFixture({ orderCount: 24, routeCount: 4, planSuffix: `I18N-${language}-A`, inputSuffix: `I18N-${language}` });
    fixture.scenario.meta = { synthetic: true, dataClassification: "SYNTHETIC_DEMO" };
    const first = candidate(fixture.plan, `${language}-A`, { totalCost: 1000, estimatedRoadKm: 160, totalCO2: 32 });
    const second = candidate(fixture.plan, `${language}-B`, { totalCost: 980, estimatedRoadKm: 175, totalCO2: 30 });
    const third = candidate(fixture.plan, `${language}-C`, { totalCost: 1100, estimatedRoadKm: 145, totalCO2: 29 });
    await page.evaluate(({ scenario, plans }) => {
      const state = window.STCTPlanning.state; state.phase = "applied"; state.scenario = scenario; state.candidates = plans; state.selectedPlanId = plans[0].planId; state.selectedScenarioId = plans[0].planId;
      state.baseline = { plan: plans[0], scenario, selectedPlanId: plans[0].planId }; state.whatIfResults = []; state.manual = null;
    }, { scenario: fixture.scenario, plans: [first, second, third] });
    await page.evaluate(() => window.STCTExperienceUI.open("replay"));
    await page.waitForFunction(() => window.STCTV15.trustLab.state?.matrixStatus === "PASS", null, { timeout: 30000 });
    await page.click("#expIncidentOpen"); await page.waitForSelector("#expIncidentStudio", { state: "visible" });
    const replay = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      mode: document.querySelector(".exp-title")?.textContent || "",
      event: document.querySelector(".exp-v15-event-head")?.textContent || "",
      trust: document.querySelector(".exp-v15-trust-head")?.textContent || "",
      matrix: document.querySelector(".exp-v15-matrix-lab")?.textContent || "",
      capsule: document.querySelector(".exp-v15-capsule-lab")?.textContent || "",
      incident: document.querySelector(".exp-incident-sheet")?.textContent || "",
    }));
    await page.click('[data-incident-action="close"]');
    await page.evaluate(() => window.STCTExperienceUI.switchMode("arena"));
    await page.waitForSelector("#expV15Arena [data-v15-frontier]");
    const arena = await page.evaluate(() => ({
      text: document.getElementById("expV15Arena")?.textContent || "",
      observed: document.querySelector("#expV15Arena .exp-v15-section-head .exp-section-label")?.textContent || "",
    }));
    const combined = Object.values(replay).join("\n") + "\n" + arena.text;
    expected.required.forEach((phrase) => assert(combined.includes(phrase), `${language} missing ${phrase}`));
    expected.forbidden.forEach((phrase) => assert(!combined.includes(phrase), `${language} leaked ${phrase}`));
    assert(replay.lang.startsWith(language), `${language} document lang mismatch: ${replay.lang}`);
    evidence.languages[language] = { replay, arena: { observed: arena.observed }, required: expected.required, forbidden: expected.forbidden };
    return evidence.languages[language];
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const zh = await runLanguage(browser, "zh", { required: ["运行回放", "异常恢复工作台", "规划可信实验室", "矩阵实验室", "场景胶囊", "已观察候选前沿", "约束解释", "评分瀑布", "领域事件轨道"], forbidden: [] });
    check("T246", Boolean(zh), zh);
    const en = await runLanguage(browser, "en", { required: ["Mission Control Replay", "Incident Recovery Studio", "Planning Trust Lab", "Matrix Lab", "Scenario Capsule", "Observed Candidate Frontier", "Why Panel", "Score Waterfall", "Domain Event Lane"], forbidden: ["异常恢复", "规划可信", "矩阵实验室", "场景胶囊", "已观察候选前沿", "领域事件轨道"] });
    check("T247", Boolean(en), en);
    const ja = await runLanguage(browser, "ja", { required: ["運行リプレイ", "インシデント復旧スタジオ", "計画信頼ラボ", "マトリクスラボ", "シナリオカプセル", "観測候補フロンティア", "説明パネル", "スコア・ウォーターフォール", "ドメインイベントレーン"], forbidden: ["异常恢复", "规划可信", "矩阵实验室", "场景胶囊", "已观察候选前沿", "领域事件轨道"] });
    check("T248", Boolean(ja), ja);
    const errors = evidence.console.filter((entry) => entry.type === "error" || entry.type === "pageerror");
    check("I18N-console", errors.length === 0, errors);
    evidence.status = "PASS";
  } finally {
    await browser.close(); evidence.completedAt = new Date().toISOString(); fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: evidence.status, evidencePath, checks: evidence.checks.length }, null, 2)}\n`);
}

main().catch((error) => { evidence.failure = { name: error.name, message: error.message, stack: error.stack }; try { fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); } catch (_error) {} console.error(error.stack || error); process.exitCode = 1; });
