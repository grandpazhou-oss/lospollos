(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.pareto = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "stct-observed-pareto-v1.5";
  const LABEL = "Observed Candidate Frontier";
  const DIMENSIONS = Object.freeze({
    totalCost: Object.freeze({ id: "totalCost", label: "Cost", direction: "min", unit: "cost" }),
    estimatedRoadKm: Object.freeze({ id: "estimatedRoadKm", label: "Distance", direction: "min", unit: "km" }),
    totalCO2: Object.freeze({ id: "totalCO2", label: "CO2", direction: "min", unit: "kg" }),
    usedVehicles: Object.freeze({ id: "usedVehicles", label: "Vehicles", direction: "min", unit: "vehicle" }),
    latestEndMinutes: Object.freeze({ id: "latestEndMinutes", label: "Latest End", direction: "min", unit: "minute" }),
    utilizationScore: Object.freeze({ id: "utilizationScore", label: "Utilization", direction: "max", unit: "%" }),
    changeCount: Object.freeze({ id: "changeCount", label: "Change Count", direction: "min", unit: "change" }),
  });
  const DEFAULT_TOLERANCES = Object.freeze({
    totalCost: 0.01,
    estimatedRoadKm: 0.001,
    totalCO2: 0.001,
    usedVehicles: 0,
    latestEndMinutes: 0.01,
    utilizationScore: 0.01,
    changeCount: 0,
  });

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function compare(left, right) {
    return text(left).localeCompare(text(right), "en");
  }

  function verifiedMetrics(candidate) {
    return candidate?.verification?.status === "PASS" && candidate.verification.recomputedMetrics
      ? candidate.verification.recomputedMetrics
      : null;
  }

  function own(object, key) {
    return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
  }

  function verifiedPlanDiffChangeCount(candidate) {
    const diff = candidate?.verification?.verifiedPlanDiff;
    if (!diff || diff.status !== "PASS") return undefined;
    if (own(diff.recomputedMetrics, "changeCount")) return diff.recomputedMetrics.changeCount;
    return own(diff, "changeCount") ? diff.changeCount : undefined;
  }

  function rawCandidateValue(candidate, dimensionId) {
    const metrics = verifiedMetrics(candidate);
    if (!metrics) return undefined;
    if (own(metrics, dimensionId)) return metrics[dimensionId];
    if (dimensionId === "changeCount") return verifiedPlanDiffChangeCount(candidate);
    return undefined;
  }

  function metricFailure(candidate, field) {
    const value = rawCandidateValue(candidate, field);
    if (value === undefined || value === null) {
      return { field, reasonCode: "MISSING_RECOMPUTED_METRIC" };
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { field, reasonCode: "NON_FINITE_RECOMPUTED_METRIC", valueType: typeof value };
    }
    return null;
  }

  function candidateIntegrity(candidate, dimensions = Object.keys(DIMENSIONS)) {
    if (!verifiedMetrics(candidate)) return { ok: false, reasonCode: "VERIFIER_NOT_PASS" };
    const fields = [...new Set([
      "servicePriorityScore", "assigned", "blocked",
      ...dimensionList(dimensions).map((dimension) => dimension.id),
    ])];
    const failure = fields.map((field) => metricFailure(candidate, field)).find(Boolean);
    return failure ? { ok: false, ...failure } : { ok: true };
  }

  function candidateValue(candidate, dimensionId) {
    const value = rawCandidateValue(candidate, dimensionId);
    return typeof value === "number" && Number.isFinite(value) ? value : NaN;
  }

  function comparableKey(candidate) {
    const metrics = verifiedMetrics(candidate);
    if (!metrics) return "";
    const values = [metrics.servicePriorityScore, metrics.assigned, metrics.blocked];
    if (!text(candidate.inputHash) || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return "";
    return [text(candidate.inputHash), ...values].join("|");
  }

  function comparable(left, right) {
    return Boolean(comparableKey(left) && comparableKey(left) === comparableKey(right));
  }

  function dimensionList(dimensions) {
    const ids = dimensions?.length ? dimensions : Object.keys(DIMENSIONS);
    return ids.map((item) => typeof item === "string" ? DIMENSIONS[item] : item).filter(Boolean);
  }

  function dominates(left, right, dimensions, tolerances = {}) {
    const rows = dimensionList(dimensions);
    const proof = { dominates: false, comparable: comparable(left, right), notWorse: [], strictlyBetter: [], equalWithinTolerance: [], worse: [], tolerances: {} };
    if (!proof.comparable || !rows.length) return proof;
    rows.forEach((dimension) => {
      const a = candidateValue(left, dimension.id);
      const b = candidateValue(right, dimension.id);
      const tolerance = Math.max(0, number(tolerances[dimension.id], DEFAULT_TOLERANCES[dimension.id]));
      proof.tolerances[dimension.id] = tolerance;
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        proof.worse.push({ dimension: dimension.id, reason: "NON_FINITE_VALUE", left: a, right: b });
        return;
      }
      const delta = a - b;
      const equal = Math.abs(delta) <= tolerance;
      const notWorse = dimension.direction === "min" ? a <= b + tolerance : a >= b - tolerance;
      const strictlyBetter = dimension.direction === "min" ? a < b - tolerance : a > b + tolerance;
      const detail = { dimension: dimension.id, direction: dimension.direction, left: a, right: b, delta, tolerance };
      if (notWorse) proof.notWorse.push(detail);
      else proof.worse.push(detail);
      if (strictlyBetter) proof.strictlyBetter.push(detail);
      else if (equal) proof.equalWithinTolerance.push(detail);
    });
    proof.dominates = proof.worse.length === 0 && proof.strictlyBetter.length > 0 && proof.notWorse.length === rows.length;
    return proof;
  }

  function uniqueVerified(candidates = [], dimensions = Object.keys(DIMENSIONS)) {
    const byHash = new Map();
    const excluded = [];
    candidates.forEach((candidate) => {
      const integrity = candidateIntegrity(candidate, dimensions);
      if (!integrity.ok) {
        excluded.push({ planHash: text(candidate?.planHash), ...integrity });
        return;
      }
      const hash = text(candidate.planHash);
      if (!hash) {
        excluded.push({ planHash: "", reasonCode: "PLAN_HASH_REQUIRED" });
        return;
      }
      if (byHash.has(hash)) excluded.push({ planHash: hash, reasonCode: "DUPLICATE_PLAN_HASH" });
      else byHash.set(hash, candidate);
    });
    return { candidates: [...byHash.values()].sort((a, b) => compare(a.planHash, b.planHash)), excluded };
  }

  function observedFrontier(candidates = [], options = {}) {
    const dimensions = dimensionList(options.dimensions);
    const unique = uniqueVerified(candidates, dimensions);
    const grouped = new Map();
    unique.candidates.forEach((candidate) => {
      const key = comparableKey(candidate);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(candidate);
    });
    const groups = [...grouped.entries()].sort(([a], [b]) => compare(a, b)).map(([key, rows]) => {
      const points = rows.map((candidate) => {
        const dominators = rows.filter((other) => other !== candidate).map((other) => ({ other, proof: dominates(other, candidate, dimensions, options.tolerances) })).filter((entry) => entry.proof.dominates);
        return {
          planHash: text(candidate.planHash),
          planId: text(candidate.planId),
          candidate: clone(candidate),
          values: Object.fromEntries(dimensions.map((dimension) => [dimension.id, candidateValue(candidate, dimension.id)])),
          isFrontier: dominators.length === 0,
          dominatedBy: dominators.map((entry) => ({ planHash: text(entry.other.planHash), proof: entry.proof })),
        };
      });
      return {
        comparableKey: key,
        inputHash: text(rows[0]?.inputHash),
        servicePriorityScore: number(verifiedMetrics(rows[0])?.servicePriorityScore),
        assigned: number(verifiedMetrics(rows[0])?.assigned),
        blocked: number(verifiedMetrics(rows[0])?.blocked),
        points,
        frontierPlanHashes: points.filter((point) => point.isFrontier).map((point) => point.planHash),
      };
    });
    return {
      version: VERSION,
      label: LABEL,
      observed: true,
      dimensions: dimensions.map(clone),
      tolerances: { ...DEFAULT_TOLERANCES, ...(options.tolerances || {}) },
      candidateCount: unique.candidates.length,
      groups,
      excluded: unique.excluded,
    };
  }

  function projectPoints(group, xDimension, yDimension, width = 560, height = 260, padding = 28) {
    const points = group?.points || [];
    const xs = points.map((point) => number(point.values[xDimension]));
    const ys = points.map((point) => number(point.values[yDimension]));
    const extent = (values) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      return Math.abs(max - min) < 0.000001 ? [min - 1, max + 1] : [min, max];
    };
    const [minX, maxX] = extent(xs);
    const [minY, maxY] = extent(ys);
    return points.map((point) => ({
      ...clone(point),
      x: padding + (number(point.values[xDimension]) - minX) / (maxX - minX) * (width - padding * 2),
      y: height - padding - (number(point.values[yDimension]) - minY) / (maxY - minY) * (height - padding * 2),
    }));
  }

  function createFrontierController(options = {}) {
    const source = clone(options.candidates || []);
    const report = observedFrontier(source, options);
    const flat = report.groups.flatMap((group) => group.points).sort((a, b) => compare(a.planHash, b.planHash));
    let state = {
      xDimension: text(options.xDimension || "totalCost"),
      yDimension: text(options.yDimension || "estimatedRoadKm"),
      selectedPlanHash: text(options.selectedPlanHash || flat[0]?.planHash),
      webglAvailable: options.webglAvailable !== false,
      mobile: Boolean(options.mobile),
    };
    const callbacks = {
      selectPlan: options.selectPlan,
      syncMap: options.syncMap,
      syncTimeline: options.syncTimeline,
      syncWhyPanel: options.syncWhyPanel,
    };

    function snapshot() {
      const selected = flat.find((point) => point.planHash === state.selectedPlanHash) || null;
      const accessibleCandidates = flat.map((point) => ({ planHash: point.planHash, planId: point.planId, isFrontier: point.isFrontier, selected: point.planHash === state.selectedPlanHash, values: clone(point.values) }));
      return {
        ...clone(state),
        label: LABEL,
        observed: true,
        report: clone(report),
        selected: clone(selected),
        accessibleCandidates,
        mobileCandidates: clone(accessibleCandidates),
        noWebglEquivalent: state.webglAvailable ? null : clone(accessibleCandidates),
      };
    }

    function setAxes(xDimension, yDimension) {
      if (!DIMENSIONS[xDimension] || !DIMENSIONS[yDimension]) throw Object.assign(new Error("Unknown Pareto axis."), { code: "PARETO_AXIS_UNKNOWN" });
      state.xDimension = xDimension;
      state.yDimension = yDimension;
      return snapshot();
    }

    function select(planHash, sourceName = "pointer") {
      const point = flat.find((candidate) => candidate.planHash === text(planHash));
      if (!point) throw Object.assign(new Error(`Unknown Pareto planHash: ${planHash}`), { code: "PARETO_PLAN_UNKNOWN" });
      state.selectedPlanHash = point.planHash;
      const context = { source: sourceName, planHash: point.planHash, candidate: clone(point.candidate), point: clone(point) };
      Object.values(callbacks).forEach((callback) => { if (typeof callback === "function") callback(context); });
      return snapshot();
    }

    function handleKey(key) {
      if (!flat.length) return snapshot();
      const index = Math.max(0, flat.findIndex((point) => point.planHash === state.selectedPlanHash));
      if (["ArrowRight", "ArrowDown"].includes(key)) return select(flat[(index + 1) % flat.length].planHash, "keyboard");
      if (["ArrowLeft", "ArrowUp"].includes(key)) return select(flat[(index - 1 + flat.length) % flat.length].planHash, "keyboard");
      if (key === "Home") return select(flat[0].planHash, "keyboard");
      if (key === "End") return select(flat.at(-1).planHash, "keyboard");
      if (["Enter", " "].includes(key)) return select(flat[index].planHash, "keyboard");
      return snapshot();
    }

    return { snapshot, setAxes, select, handleKey, report: clone(report) };
  }

  return {
    VERSION,
    LABEL,
    DIMENSIONS,
    DEFAULT_TOLERANCES,
    candidateValue,
    comparableKey,
    comparable,
    candidateIntegrity,
    dominates,
    uniqueVerified,
    observedFrontier,
    projectPoints,
    createFrontierController,
  };
});
