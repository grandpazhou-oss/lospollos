(function (root, factory) {
  "use strict";
  const dependencies = typeof module === "object" && module.exports
    ? {
      Errors: require("./platform-route-errors-v19.js"),
      Isolation: require("./workspace-state-isolation-v19.js"),
    }
    : {
      Errors: root.STCTPlatformV19.errors,
      Isolation: root.STCTPlatformV19.workspaceIsolation,
    };
  const api = factory(dependencies.Errors, dependencies.Isolation);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.state = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Errors, Isolation) {
  "use strict";

  const SCHEMA_VERSION = "stct-platform-shell-state-v1.9-p2";
  const PLATFORM_NAME = "Supply Chain Decision Platform";
  const WORKSPACES = Object.freeze(["DESIGN", "COMMAND", "PLATFORM"]);
  const LOCALES = Object.freeze(["zh", "en", "ja"]);
  const REQUIRED_KEYS = Object.freeze([
    "schemaVersion", "platformDisplayName", "activeWorkspace", "activeRoute", "previousRoute",
    "workspaceStates", "platformPanel", "navigationCollapsed", "mobileDrawerOpen", "locale",
    "reducedMotion", "noWebGL", "restoredFromStorage", "revision",
  ]);
  const FORBIDDEN_KEY = /(token|secret|credential|password|authorization|api[-_]?key|rawexcel|raworders|rawfacilities|matrices|geometries|eventstreams?)/i;
  const BUSINESS_KEY = /^(orders|facilities|excel|matrix|matrices|geometry|geometries|events|executionEvents|routeGeometry)$/i;
  const SECRET_VALUE = /(?:bearer\s+[a-z0-9._-]{12,}|(?:sk|ghp|glpat)-?[a-z0-9_-]{20,}|password\s*[=:])/i;
  const MAX_ARRAY_LENGTH = 50;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
    return value;
  }

  function defaults(overrides) {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      platformDisplayName: PLATFORM_NAME,
      activeWorkspace: "PLATFORM",
      activeRoute: "/",
      previousRoute: null,
      workspaceStates: Isolation.defaults(),
      platformPanel: null,
      navigationCollapsed: false,
      mobileDrawerOpen: false,
      locale: "zh",
      reducedMotion: false,
      noWebGL: false,
      restoredFromStorage: false,
      revision: 0,
    };
    return freeze(Object.assign(base, overrides || {}));
  }

  function findUnsafe(value, path, seen) {
    const at = path || "$";
    if (typeof value === "string") return SECRET_VALUE.test(value) ? `${at}:secret-value` : null;
    if (!value || typeof value !== "object") return null;
    if (seen.has(value)) return `${at}:circular`;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) return `${at}:large-array`;
      for (let index = 0; index < value.length; index += 1) {
        const issue = findUnsafe(value[index], `${at}[${index}]`, seen);
        if (issue) return issue;
      }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key) || BUSINESS_KEY.test(key)) return `${at}.${key}:forbidden-key`;
      const issue = findUnsafe(child, `${at}.${key}`, seen);
      if (issue) return issue;
    }
    return null;
  }

  function validateState(candidate) {
    const errors = [];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, errors: ["state:not-object"] };
    }
    for (const key of REQUIRED_KEYS) if (!Object.prototype.hasOwnProperty.call(candidate, key)) errors.push(`${key}:missing`);
    if (candidate.schemaVersion !== SCHEMA_VERSION) errors.push("schemaVersion:invalid");
    if (candidate.platformDisplayName !== PLATFORM_NAME) errors.push("platformDisplayName:invalid");
    if (!WORKSPACES.includes(candidate.activeWorkspace)) errors.push("activeWorkspace:invalid");
    if (typeof candidate.activeRoute !== "string" || !candidate.activeRoute.startsWith("/")) errors.push("activeRoute:invalid");
    if (candidate.previousRoute !== null && typeof candidate.previousRoute !== "string") errors.push("previousRoute:invalid");
    if (!Isolation.validateWorkspaceStates(candidate.workspaceStates)) errors.push("workspaceStates:invalid");
    if (candidate.platformPanel !== null && (typeof candidate.platformPanel !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(candidate.platformPanel))) errors.push("platformPanel:invalid");
    for (const key of ["navigationCollapsed", "mobileDrawerOpen", "reducedMotion", "noWebGL", "restoredFromStorage"]) {
      if (typeof candidate[key] !== "boolean") errors.push(`${key}:invalid`);
    }
    if (!LOCALES.includes(candidate.locale)) errors.push("locale:invalid");
    if (!Number.isInteger(candidate.revision) || candidate.revision < 0) errors.push("revision:invalid");
    const unsafe = findUnsafe(candidate, "$", new Set());
    if (unsafe) errors.push(unsafe);
    return { ok: errors.length === 0, errors };
  }

  function serializeState(candidate) {
    const validation = validateState(candidate);
    if (!validation.ok) {
      return { ok: false, payload: null, error: Errors.create(Errors.CODES.RESTORE_INVALID, "Route state is not serializable", validation.errors) };
    }
    try {
      return { ok: true, payload: JSON.stringify(candidate), error: null };
    } catch (error) {
      return { ok: false, payload: null, error: Errors.create(Errors.CODES.RESTORE_INVALID, "Route state serialization failed") };
    }
  }

  function restoreState(payload, routeValidator) {
    try {
      const candidate = typeof payload === "string" ? JSON.parse(payload) : clone(payload);
      const validation = validateState(candidate);
      if (!validation.ok) throw Errors.create(Errors.CODES.RESTORE_INVALID, "Stored route state is invalid", validation.errors);
      if (routeValidator && !routeValidator(candidate.activeRoute)) {
        throw Errors.create(Errors.CODES.RESTORE_INVALID, "Stored route is not registered", candidate.activeRoute);
      }
      candidate.restoredFromStorage = true;
      return { ok: true, state: freeze(candidate), error: null };
    } catch (error) {
      return {
        ok: false,
        state: defaults(),
        error: error && error.code === Errors.CODES.RESTORE_INVALID
          ? error
          : Errors.create(Errors.CODES.RESTORE_INVALID, "Stored route state could not be restored"),
      };
    }
  }

  function createAuthority(initialState) {
    const initial = initialState ? clone(initialState) : clone(defaults());
    const checked = validateState(initial);
    let state = freeze(checked.ok ? initial : clone(defaults()));
    const subscribers = new Set();

    function publish(next) {
      state = freeze(next);
      subscribers.forEach((listener) => listener(state));
      return state;
    }

    function update(changes) {
      const next = Object.assign(clone(state), changes, { revision: state.revision + 1 });
      const validation = validateState(next);
      if (!validation.ok) return { ok: false, state, error: Errors.create(Errors.CODES.RESTORE_INVALID, "Shell state update rejected", validation.errors) };
      return { ok: true, state: publish(next), error: null };
    }

    return Object.freeze({
      snapshot() {
        return state;
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      commitRoute(logicalPath, workspace, routeParams) {
        if (!WORKSPACES.includes(workspace)) {
          return { ok: false, state, error: Errors.create(Errors.CODES.RESTORE_INVALID, "Invalid workspace transition", workspace) };
        }
        const workspaceStates = Isolation.commitRoute(state.workspaceStates, workspace, logicalPath, routeParams);
        return update({
          previousRoute: state.activeRoute === logicalPath ? state.previousRoute : state.activeRoute,
          activeRoute: logicalPath,
          activeWorkspace: workspace,
          workspaceStates,
          mobileDrawerOpen: false,
        });
      },
      setPreference(key, value) {
        const allowed = new Set(["platformPanel", "navigationCollapsed", "mobileDrawerOpen", "locale", "reducedMotion", "noWebGL"]);
        if (!allowed.has(key)) return { ok: false, state, error: Errors.create(Errors.CODES.RESTORE_INVALID, "Unknown shell preference", key) };
        return update({ [key]: value });
      },
      setWorkspacePresentation(workspace, patch) {
        const result = Isolation.updateEnvelope(state.workspaceStates, workspace, patch);
        if (!result.ok) {
          return { ok: false, state, error: Errors.create(Errors.CODES.RESTORE_INVALID, "Workspace presentation update rejected", result.error) };
        }
        return update({ workspaceStates: result.workspaceStates });
      },
    });
  }

  return Object.freeze({
    SCHEMA_VERSION,
    PLATFORM_NAME,
    WORKSPACES,
    LOCALES,
    REQUIRED_KEYS,
    MAX_ARRAY_LENGTH,
    defaults,
    validateState,
    serializeState,
    restoreState,
    createAuthority,
  });
});
