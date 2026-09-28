(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.legacyRoutes = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS = Object.freeze({
    MAPPED: "MAPPED",
    DEPRECATED: "DEPRECATED_WITH_MESSAGE",
    FALLBACK: "UNSUPPORTED_SAFE_FALLBACK",
  });

  const CURRENT_NAV_INVENTORY = Object.freeze([
    "serviceView",
    "mapView",
    "experience-replay",
    "experience-v16",
    "experience-v17",
    "optimizerView",
    "analysisView",
    "carbonView",
    "costView",
    "reportView",
    "uploadView",
    "exceptionsView",
    "return-mapView",
  ]);

  function entry(legacyId, legacyQuery, legacyHash, targetLogicalPath, status, evidence, deprecationMessage) {
    return Object.freeze({
      legacyId,
      legacyQuery,
      legacyHash,
      targetLogicalPath,
      status,
      evidence,
      deprecationMessage: deprecationMessage || "",
    });
  }

  const MAPPINGS = Object.freeze([
    entry("serviceView", "view=serviceView", "#serviceView", "/command/overview", STATUS.MAPPED, "P0 nav: 总览 / serviceView"),
    entry("mapView", "view=mapView", "#mapView", "/command/dispatch", STATUS.MAPPED, "P0 nav: 路线 / mapView"),
    entry("experience-replay", "experience=replay", "#replay", "/command/mission-control", STATUS.MAPPED, "P0 nav: 演练 / data-experience-open=replay"),
    entry("experience-v16", "experience=v16", "#v16", "/command/execution", STATUS.MAPPED, "P0 nav: 动态运营 / data-v16-open"),
    entry("experience-v17", "experience=v17", "#v17", "/command/execution", STATUS.MAPPED, "P0 nav: 运营真相 / data-v17-open"),
    entry("optimizerView", "view=optimizerView", "#optimizerView", "/command/dispatch", STATUS.MAPPED, "P0 nav: 排车 / optimizerView"),
    entry("analysisView", "view=analysisView", "#analysisView", "/command/plan-vs-actual", STATUS.MAPPED, "P0 nav: 分析 / analysisView"),
    entry("carbonView", "view=carbonView", "#carbonView", "/command/overview", STATUS.MAPPED, "P0 nav: 碳排 / carbonView"),
    entry("costView", "view=costView", "#costView", "/design/cost-to-serve", STATUS.MAPPED, "Runtime nav: 成本 / costView injected by render.js"),
    entry("reportView", "view=reportView", "#reportView", "/command/shift-review", STATUS.MAPPED, "Runtime nav: 汇报 / reportView injected by render.js"),
    entry("uploadView", "view=uploadView", "#uploadView", "/platform/data", STATUS.MAPPED, "P0 nav: 数据 / uploadView"),
    entry("exceptionsView", "view=exceptionsView", "#exceptionsView", "/command/alerts", STATUS.MAPPED, "P0 nav: 异常 / exceptionsView"),
    entry("return-mapView", "view=return-mapView", "#return-mapView", "/command/dispatch", STATUS.MAPPED, "P0 nav: 返回 / mapView duplicate"),
    entry(
      "legacy-report-builder",
      "view=legacy-report-builder",
      "#legacy-report-builder",
      "/command/overview",
      STATUS.DEPRECATED,
      "Controlled P1 adversarial migration case; not a P0 current tab",
      "This historical link has no one-to-one P1 route. The capability is not declared removed; Platform Gate P3 owns migration review.",
    ),
  ]);

  function parseSearch(search) {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    for (const mapping of MAPPINGS) {
      const [key, value] = mapping.legacyQuery.split("=");
      if (params.get(key) === value) return mapping;
    }
    return null;
  }

  function resolveLocation(locationLike) {
    const hash = String((locationLike && locationLike.hash) || "");
    const byHash = MAPPINGS.find((row) => row.legacyHash === hash);
    if (byHash) return byHash;
    if (hash.startsWith("#/")) return null;
    return parseSearch(locationLike && locationLike.search);
  }

  function getById(legacyId) {
    return MAPPINGS.find((row) => row.legacyId === legacyId) || null;
  }

  function currentInventoryComplete() {
    return CURRENT_NAV_INVENTORY.every((legacyId) => Boolean(getById(legacyId)));
  }

  function mapsOperationalTabsToCommand() {
    const nonOperationalTargets = new Set(["uploadView", "costView"]);
    return CURRENT_NAV_INVENTORY.every((legacyId) => {
      const row = getById(legacyId);
      return row && (nonOperationalTargets.has(legacyId) || row.targetLogicalPath.startsWith("/command"));
    });
  }

  function validateMapping(mapping, seen) {
    const visited = seen || new Set();
    if (!mapping || visited.has(mapping.legacyId)) return false;
    visited.add(mapping.legacyId);
    return typeof mapping.targetLogicalPath === "string"
      && mapping.targetLogicalPath.startsWith("/")
      && !mapping.targetLogicalPath.startsWith("//")
      && !resolveLocation({ hash: `#${mapping.targetLogicalPath}`, search: "" });
  }

  return Object.freeze({ STATUS, CURRENT_NAV_INVENTORY, MAPPINGS, resolveLocation, getById, currentInventoryComplete, mapsOperationalTabsToCommand, validateMapping });
});
