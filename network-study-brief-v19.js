(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.networkStudyBrief = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const deepFreeze = (value) => { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const csv = (value) => { const text = String(value ?? ""); const safe = /^[\t\r\n ]*[=+@\-]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; };
  const COPY = Object.freeze({
    zh: { title: "网络研究简报", study: "研究", scenario: "情景", verification: "验证", costService: "成本 / 服务", engine: "引擎", note: "只读证据，不代表投资批准、土地可用性或全局最优。" },
    en: { title: "Network Study Brief", study: "Study", scenario: "Scenario", verification: "Verification", costService: "Cost / Service", engine: "Engine", note: "Read-only evidence. No investment, land availability, or global optimality claim." },
    ja: { title: "ネットワーク研究概要", study: "研究", scenario: "シナリオ", verification: "検証", costService: "コスト / サービス", engine: "エンジン", note: "読取専用の証拠です。投資承認、土地利用可能性、グローバル最適性を示しません。" },
  });
  function create(store, note = "") {
    const source = store.snapshot();
    const evaluation = source.evaluation;
    const pack = {
      schemaVersion: "stct-network-study-brief-v1.9-p4",
      briefId: `BRIEF-${source.studyHash.slice(-12).toUpperCase()}`,
      studyId: source.studyId,
      studyHash: source.studyHash,
      lifecycle: source.lifecycle,
      scenarioId: source.activeScenarioId,
      networkInputHash: source.activeInputHash,
      dataClassification: source.dataSource.dataClassification,
      sourceType: source.dataSource.sourceType,
      note: String(note ?? "").normalize("NFC").slice(0, 2000),
      facts: evaluation ? { planHash: evaluation.plan.networkPlanHash, accountingHash: evaluation.accounting.accountingHash, verification: evaluation.verification.status, accountingVerification: evaluation.accountingVerification.status, service: evaluation.accounting.metrics.serviceLevel, cost: evaluation.accounting.cost.total, currency: evaluation.accounting.assumptions.currency, carbonKg: evaluation.accounting.carbon.totalKg, engine: evaluation.engineBoundary.used, optimality: evaluation.engineBoundary.optimality } : null,
      baseline: source.baselineResultRef,
      scenarioPortfolio: source.scenarioResultRefs,
      demandPeriod: source.demandPeriod,
      capacityBottlenecks: evaluation ? evaluation.visual.layers.capacityStress.filter((row) => row.properties.utilization >= .8).map((row) => ({ depotId: row.properties.depotId, utilization: row.properties.utilization })) : [],
      resilience: source.history.filter((row) => ["DEPOT_OUTAGE", "DOCK_FAILURE", "ROAD_CLOSURE"].includes(row.type)),
      operationalValidation: source.operationalValidationRefs,
      dataGaps: source.dataGaps,
      nextActions: source.dirty ? ["EVALUATE_ACTIVE_SCENARIO"] : ["CREATE_SCENARIO", "AWAIT_OPERATIONAL_VALIDATION"],
      assumptions: clone(source.activeRecord.scenario.assumptions),
      provenance: { provider: clone(source.activeRecord.scenario.routingContext), verifier: evaluation?.verification.verifier || "PENDING" },
      claims: { investmentApproval: false, landAvailability: false, globalOptimality: false, facilityLocationSolverRun: false },
      evidenceRefs: [source.studyHash, source.activeInputHash, evaluation?.plan.networkPlanHash, evaluation?.accounting.accountingHash, evaluation?.evaluationHash].filter(Boolean),
      mode: "READ_ONLY",
    };
    pack.briefHash = store.context.Contract.hashArtifact(pack);
    return deepFreeze(clone(pack));
  }
  function verify(store, pack) { const candidate = clone(pack); const hash = candidate?.briefHash; if (!hash) return { status: "FAIL", code: "DESIGN_BRIEF_HASH_MISSING" }; delete candidate.briefHash; return { status: store.context.Contract.hashArtifact(candidate) === hash ? "PASS" : "FAIL", code: store.context.Contract.hashArtifact(candidate) === hash ? "" : "DESIGN_BRIEF_HASH_MISMATCH" }; }
  function importReadOnly(store, payload) { const pack = typeof payload === "string" ? JSON.parse(payload) : clone(payload); const verification = verify(store, pack); return verification.status === "PASS" ? deepFreeze({ status: "PASS", mode: "READ_ONLY", pack: clone(pack), sourceBriefHash: pack.briefHash, sideEffects: { studyMutation: false, scenarioEvaluation: false, externalRequests: 0 } }) : verification; }
  function toJson(pack) { return `${JSON.stringify(pack, null, 2)}\n`; }
  function toCsv(pack) { const facts = pack.facts || {}; return `field,value\n${[["briefId", pack.briefId], ["studyHash", pack.studyHash], ["scenarioId", pack.scenarioId], ["verification", facts.verification || "PENDING"], ["cost", facts.cost ?? ""], ["service", facts.service ?? ""], ["note", pack.note]].map((row) => row.map(csv).join(",")).join("\n")}\n`; }
  function toPrintableHtml(pack, locale = "en") { const facts = pack.facts || {}; const copy = COPY[locale] || COPY.en; return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><title>${escapeHtml(pack.briefId)}</title><style>body{font-family:Arial,sans-serif;color:#102a43;margin:40px}h1{font-size:24px}dl{display:grid;grid-template-columns:180px 1fr;gap:8px}dt{font-weight:700}small{color:#64748b}</style></head><body><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(pack.note)}</p><dl><dt>${escapeHtml(copy.study)}</dt><dd>${escapeHtml(pack.studyId)}</dd><dt>Study hash</dt><dd>${escapeHtml(pack.studyHash)}</dd><dt>${escapeHtml(copy.scenario)}</dt><dd>${escapeHtml(pack.scenarioId)}</dd><dt>${escapeHtml(copy.verification)}</dt><dd>${escapeHtml(facts.verification || "PENDING")}</dd><dt>${escapeHtml(copy.costService)}</dt><dd>${escapeHtml(facts.cost ?? "-")} / ${escapeHtml(facts.service ?? "-")}</dd><dt>${escapeHtml(copy.engine)}</dt><dd>${escapeHtml(facts.engine || "-")} · ${escapeHtml(facts.optimality || "-")}</dd></dl><small>${escapeHtml(copy.note)}</small></body></html>`; }
  return Object.freeze({ COPY, create, verify, importReadOnly, toJson, toCsv, toPrintableHtml });
});
