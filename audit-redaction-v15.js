(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.auditRedaction = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "stct-audit-redaction-v1.5";
  const PATH_FORBIDDEN = Object.freeze([/\/Users\//, /\/home\//, /\/tmp\//, /\/(?:private\/)?var\/folders\//, /file:\/\/\/Users/]);

  function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function replacementRows(context = {}) {
    const projectRoot = String(context.projectRoot || "");
    const evidenceRoot = String(context.evidenceRoot || "");
    const localHome = String(context.localHome || "");
    const rows = [];
    if (projectRoot) {
      rows.push([new RegExp(`file://${escapeRegex(projectRoot)}`, "g"), "file://<PROJECT_ROOT>"]);
      rows.push([new RegExp(escapeRegex(projectRoot), "g"), "<PROJECT_ROOT>"]);
    }
    if (evidenceRoot) {
      rows.push([new RegExp(`file://${escapeRegex(evidenceRoot)}`, "g"), "file://<EVIDENCE_ROOT>"]);
      rows.push([new RegExp(escapeRegex(evidenceRoot), "g"), "<EVIDENCE_ROOT>"]);
    }
    if (localHome) rows.push([new RegExp(escapeRegex(localHome), "g"), "<USER_HOME>"]);
    return rows;
  }

  function redactText(content, context = {}) {
    let result = String(content ?? "");
    const replacements = [
      ...replacementRows(context),
      [/file:\/\/\/Users\/[^/\s"'<>]+/g, "file://<USER_HOME>"],
      [/\/Users\/[^/\s"'<>]+/g, "<USER_HOME>"],
      [/\/home\/[^/\s"'<>]+/g, "<USER_HOME>"],
      [/file:\/\/\/Users/g, "file://<USER_HOME>"],
      [/\/Users\//g, "<USER_HOME>/"],
      [/\/home\//g, "<USER_HOME>/"],
      [/\/(?:private\/)?var\/folders\/[^\s"'<>]*/g, "<RUNTIME_ROOT>"],
      [/\/tmp\/[^\s"'<>]*/g, "<TEMP_ROOT>"],
    ];
    replacements.forEach(([pattern, replacement]) => { result = result.replace(pattern, replacement); });
    result = result.replace(/\b(user(?:name)?|localUser|owner|account)(\s*[:=]\s*)([A-Za-z_][A-Za-z0-9._-]*)/gi, (_match, key, separator) => `${key}${separator}<LOCAL_USER>`);
    result = result.replace(/("(?:user(?:name)?|localUser|owner|account)"\s*:\s*")([^"\\]+)(")/gi, "$1<LOCAL_USER>$3");
    return result;
  }

  function scanText(content, context = {}) {
    const source = String(content ?? "");
    const failures = PATH_FORBIDDEN.filter((pattern) => pattern.test(source)).map(String);
    const explicitUsers = (context.explicitUsers || []).filter((user) => user && new RegExp(`\\b${escapeRegex(user)}\\b`).test(source));
    return { status: failures.length || explicitUsers.length ? "FAIL" : "PASS", pathFailures: failures, explicitUserFailures: explicitUsers };
  }

  return { VERSION, PATH_FORBIDDEN, escapeRegex, redactText, scanText };
});
