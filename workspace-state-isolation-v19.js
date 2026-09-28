(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.workspaceIsolation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_KEYS = Object.freeze({
    DESIGN: Object.freeze(["lastRoute", "selectionRef", "dirty", "viewStateRef", "mapViewRef", "scenarioRef", "routeParams"]),
    COMMAND: Object.freeze(["lastRoute", "selectionRef", "dirty", "viewStateRef", "mapViewRef", "executionCursor", "routeParams"]),
    PLATFORM: Object.freeze(["lastRoute", "previousBusinessWorkspace", "viewStateRef", "routeParams"]),
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaults() {
    return {
      DESIGN: {
        lastRoute: "/design/overview",
        selectionRef: null,
        dirty: false,
        viewStateRef: null,
        mapViewRef: null,
        scenarioRef: null,
        routeParams: {},
      },
      COMMAND: {
        lastRoute: "/command/overview",
        selectionRef: null,
        dirty: false,
        viewStateRef: null,
        mapViewRef: null,
        executionCursor: null,
        routeParams: {},
      },
      PLATFORM: {
        lastRoute: "/",
        previousBusinessWorkspace: "DESIGN",
        viewStateRef: null,
        routeParams: {},
      },
    };
  }

  function validReference(value) {
    return value === null || (typeof value === "string" && value.length <= 256);
  }

  function validRouteParams(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 12 && entries.every(([key, item]) => /^[a-z][a-z0-9]*$/i.test(key)
      && typeof item === "string" && item.length <= 256);
  }

  function validateEnvelope(workspace, envelope) {
    const allowed = ALLOWED_KEYS[workspace];
    if (!allowed || !envelope || typeof envelope !== "object" || Array.isArray(envelope)) return false;
    if (Object.keys(envelope).some((key) => !allowed.includes(key))) return false;
    if (typeof envelope.lastRoute !== "string" || !envelope.lastRoute.startsWith("/")) return false;
    if (!validRouteParams(envelope.routeParams)) return false;
    if (workspace === "PLATFORM") {
      return ["DESIGN", "COMMAND"].includes(envelope.previousBusinessWorkspace)
        && validReference(envelope.viewStateRef);
    }
    return typeof envelope.dirty === "boolean"
      && ["selectionRef", "viewStateRef", "mapViewRef"].every((key) => validReference(envelope[key]))
      && (workspace === "DESIGN" ? validReference(envelope.scenarioRef) : validReference(envelope.executionCursor));
  }

  function validateWorkspaceStates(candidate) {
    return Boolean(candidate)
      && ["DESIGN", "COMMAND", "PLATFORM"].every((workspace) => validateEnvelope(workspace, candidate[workspace]));
  }

  function updateEnvelope(workspaceStates, workspace, patch) {
    if (!ALLOWED_KEYS[workspace] || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      return { ok: false, error: "workspace-envelope:invalid-patch" };
    }
    if (Object.keys(patch).some((key) => !ALLOWED_KEYS[workspace].includes(key))) {
      return { ok: false, error: "workspace-envelope:unknown-key" };
    }
    const next = clone(workspaceStates);
    next[workspace] = Object.assign({}, next[workspace], clone(patch));
    if (!validateWorkspaceStates(next)) return { ok: false, error: "workspace-envelope:invalid" };
    return { ok: true, workspaceStates: next };
  }

  function commitRoute(workspaceStates, workspace, logicalPath, routeParams) {
    const next = clone(workspaceStates);
    next[workspace].lastRoute = logicalPath;
    next[workspace].routeParams = clone(routeParams || {});
    if (workspace === "DESIGN" || workspace === "COMMAND") {
      next.PLATFORM.previousBusinessWorkspace = workspace;
    }
    return validateWorkspaceStates(next) ? next : clone(workspaceStates);
  }

  function rememberedBusinessWorkspace(state) {
    if (state.activeWorkspace === "DESIGN" || state.activeWorkspace === "COMMAND") return state.activeWorkspace;
    return state.workspaceStates.PLATFORM.previousBusinessWorkspace;
  }

  return Object.freeze({
    ALLOWED_KEYS,
    defaults,
    validateEnvelope,
    validateWorkspaceStates,
    updateEnvelope,
    commitRoute,
    rememberedBusinessWorkspace,
  });
});
