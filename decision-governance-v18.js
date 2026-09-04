"use strict";

const Contract = require("./network-contract-v18.js");

const VERSION = "stct-decision-governance-v1.8";
const STATES = Object.freeze(["DRAFT", "REVIEWED", "APPROVED", "REJECTED", "SUPERSEDED"]);
const TRANSITIONS = Object.freeze({ DRAFT: ["REVIEWED", "REJECTED"], REVIEWED: ["APPROVED", "REJECTED", "SUPERSEDED"], APPROVED: ["SUPERSEDED"], REJECTED: ["SUPERSEDED"], SUPERSEDED: [] });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function projection(record) {
  const { decisionHash, locale, displayText, ...identity } = record;
  return identity;
}

function createDecision(input) {
  const record = {
    schemaVersion: "stct-network-decision-v1.8",
    decisionId: input.decisionId,
    candidateId: input.candidateId,
    actionScope: input.actionScope,
    reasonCode: input.reasonCode,
    tradeOffs: [...input.tradeOffs],
    rejectedAlternatives: [...input.rejectedAlternatives],
    authoritativeHashes: { ...input.authoritativeHashes },
    recomputedFacts: { ...input.recomputedFacts },
    assumptions: [...input.assumptions],
    capabilityLimits: [...input.capabilityLimits],
    verifier: { status: input.verifier.status, warnings: [...(input.verifier.warnings || [])], hardFailures: [...(input.verifier.hardFailures || [])] },
    state: "DRAFT",
    overrideReason: "",
    linkedEvidence: { events: [], alerts: [], incidents: [], recoveries: [] },
    acknowledgedExecution: false,
    history: [{ sequence: 1, state: "DRAFT", reasonCode: input.reasonCode }],
    locale: input.locale || "en",
    displayText: input.displayText || "",
    productionAuthorization: false,
    recommendationType: "RULE_BASED_VERIFIED_FACTS",
  };
  record.decisionHash = Contract.hashArtifact(projection(record));
  return record;
}

function transition(record, nextState, options = {}) {
  if (!STATES.includes(nextState) || !TRANSITIONS[record.state].includes(nextState)) throw Object.assign(new Error("Illegal approval transition"), { code: "DECISION_TRANSITION_INVALID" });
  if (nextState === "APPROVED" && record.verifier.hardFailures.length) throw Object.assign(new Error("Hard verifier failures cannot be overridden"), { code: "DECISION_HARD_FAILURE" });
  if (options.override && !String(options.reason || "").trim()) throw Object.assign(new Error("Override reason required"), { code: "DECISION_OVERRIDE_REASON_REQUIRED" });
  const next = JSON.parse(JSON.stringify(record));
  next.state = nextState;
  next.overrideReason = options.override ? String(options.reason).trim() : next.overrideReason;
  next.history.push({ sequence: next.history.length + 1, state: nextState, reasonCode: options.reasonCode || "STATE_TRANSITION", warnings: [...next.verifier.warnings] });
  next.decisionHash = Contract.hashArtifact(projection(next));
  return next;
}

function revise(record, changeType, changeFacts) {
  if (record.acknowledgedExecution) {
    return createDecision({ ...record, decisionId: `${record.decisionId}-COUNTER-${record.history.length + 1}`, candidateId: `${record.candidateId}-COUNTER`, reasonCode: `COUNTER_${changeType}`, tradeOffs: [changeType], rejectedAlternatives: [record.candidateId], recomputedFacts: { ...record.recomputedFacts, ...changeFacts }, verifier: record.verifier });
  }
  const next = JSON.parse(JSON.stringify(record));
  next.recomputedFacts = { ...next.recomputedFacts, ...changeFacts };
  next.history.push({ sequence: next.history.length + 1, state: next.state, reasonCode: `MANUAL_${changeType}` });
  next.decisionHash = Contract.hashArtifact(projection(next));
  return next;
}

function linkEvidence(record, evidence) {
  const next = JSON.parse(JSON.stringify(record));
  for (const key of ["events", "alerts", "incidents", "recoveries"]) next.linkedEvidence[key] = [...new Set([...(next.linkedEvidence[key] || []), ...(evidence[key] || [])])];
  next.decisionHash = Contract.hashArtifact(projection(next));
  return next;
}

function memo(record, locale = "en") {
  const facts = record.recomputedFacts;
  const lines = [
    `# Network Decision Memo: ${escapeHtml(record.decisionId)}`,
    "",
    `- Status: ${escapeHtml(record.state)}`,
    `- Candidate: ${escapeHtml(record.candidateId)}`,
    `- Reason: ${escapeHtml(record.reasonCode)}`,
    `- Scope: ${escapeHtml(record.actionScope)}`,
    `- Service: ${escapeHtml(facts.service)}`,
    `- Cost: ${escapeHtml(facts.cost)}`,
    `- Carbon: ${escapeHtml(facts.carbon)}`,
    `- Capacity: ${escapeHtml(facts.capacity)}`,
    `- Risk: ${escapeHtml(facts.risk)}`,
    `- Comparability: ${escapeHtml(facts.comparability)}`,
    "- Solver boundary: BEST_FOUND among tested local candidates; global optimality is not proven.",
    `- Assumptions: ${record.assumptions.map(escapeHtml).join("; ")}`,
    `- Capability limits: ${record.capabilityLimits.map(escapeHtml).join("; ")}`,
    `- Unresolved risks: ${escapeHtml(facts.unresolvedRisks)}`,
    `- Source hashes: ${Object.values(record.authoritativeHashes).map(escapeHtml).join(", ")}`,
    "- Production authorization: false",
    "- Recommendation type: rule-based verified facts; not labeled AI.",
  ];
  const markdown = lines.join("\n") + "\n";
  const html = `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><title>Decision Memo</title><style>body{font:16px Arial;max-width:900px;margin:40px auto;color:#092f61}li{margin:8px 0}@media print{body{margin:16mm}}</style></head><body><h1>${escapeHtml(lines[0].slice(2))}</h1><ul>${lines.slice(2).map((line) => `<li>${escapeHtml(line.replace(/^- /, ""))}</li>`).join("")}</ul></body></html>`;
  return { schemaVersion: "stct-decision-memo-v1.8", locale, markdown, html, sourceDecisionHash: record.decisionHash, inventedFacts: false };
}

function workflowView(record, mode) {
  return { mode, complete: true, review: true, reject: true, denseEditing: mode !== "MOBILE", state: record.state, warnings: record.verifier.warnings, sourceDecisionHash: record.decisionHash };
}

module.exports = { VERSION, STATES, TRANSITIONS, escapeHtml, projection, createDecision, transition, revise, linkEvidence, memo, workflowView };
