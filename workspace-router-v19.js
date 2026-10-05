(function (root, factory) {
  "use strict";
  const dependencies = typeof module === "object" && module.exports
    ? {
      Errors: require("./platform-route-errors-v19.js"),
      Workspaces: require("./workspace-registry-v19.js"),
      Legacy: require("./legacy-route-mapping-v19.js"),
    }
    : {
      Errors: root.STCTPlatformV19.errors,
      Workspaces: root.STCTPlatformV19.workspaceRegistry,
      Legacy: root.STCTPlatformV19.legacyRoutes,
    };
  const api = factory(dependencies.Errors, dependencies.Workspaces, dependencies.Legacy);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.router = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Errors, Workspaces, Legacy) {
  "use strict";

  const MOUNT_KINDS = Object.freeze({
    HOME: "PLATFORM_HOME_MINIMAL",
    PLACEHOLDER: "CONTROLLED_PLACEHOLDER",
    LEGACY: "LEGACY_ROUTE_ADAPTER",
    SHARED: "SHARED_PLATFORM_PLACEHOLDER",
  });
  const RUNTIME_QUERY_KEYS = Object.freeze(["optPort", "v", "forceHeuristic", "noWebGL", "no-webgl", "reduced-motion"]);
  const SENSITIVE_QUERY_KEY = /(token|secret|credential|password|authorization|api[-_]?key)/i;
  const COMMAND_ENTITY_KEYS = Object.freeze(["routeId", "vehicleId", "orderId", "stopId", "alertId", "incidentId", "planHash", "runHash", "focus", "returnTo"]);

  function descriptor(routeId, logicalPath, workspace, titleKey, headingKey, mountKind, legacyTargets, futureGate, capabilities, allowedQueryKeys) {
    return Object.freeze({
      routeId,
      logicalPath,
      workspace,
      titleKey,
      headingKey,
      mountKind,
      legacyTargets: Object.freeze((legacyTargets || []).slice()),
      futureGate,
      capabilities: Object.freeze((capabilities || ["ROUTE_EVIDENCE"]).slice()),
      allowedQueryKeys: Object.freeze((allowedQueryKeys || []).slice()),
    });
  }

  const ROUTES = Object.freeze([
    descriptor("platform-home", "/", "PLATFORM", "route.home.title", "route.home.heading", MOUNT_KINDS.HOME, [], "Platform Gate P2"),
    descriptor("design-root", "/design", "DESIGN", "route.design.root.title", "route.design.root.heading", MOUNT_KINDS.PLACEHOLDER, [], "Platform Gate P4"),
    descriptor("design-overview", "/design/overview", "DESIGN", "route.design.overview.title", "route.design.overview.heading", MOUNT_KINDS.PLACEHOLDER, [], "Platform Gate P4"),
    descriptor("design-facility-location", "/design/facility-location", "DESIGN", "route.design.facility.title", "route.design.facility.heading", MOUNT_KINDS.PLACEHOLDER, [], "Facility Location Gate F1", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["studyId"]),
    descriptor("design-supply-chain-study", "/design/supply-chain-study", "DESIGN", "route.design.supply.title", "route.design.supply.heading", MOUNT_KINDS.PLACEHOLDER, [], "Supply Chain Design", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["studyId"]),
    descriptor("design-network-scenarios", "/design/network-scenarios", "DESIGN", "route.design.scenarios.title", "route.design.scenarios.heading", MOUNT_KINDS.PLACEHOLDER, [], "Later DESIGN domain gate", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["scenarioId"]),
    descriptor("design-fleet-capacity", "/design/fleet-capacity", "DESIGN", "route.design.fleet.title", "route.design.fleet.heading", MOUNT_KINDS.PLACEHOLDER, [], "Later DESIGN domain gate"),
    descriptor("design-cost-to-serve", "/design/cost-to-serve", "DESIGN", "route.design.cost.title", "route.design.cost.heading", MOUNT_KINDS.PLACEHOLDER, [], "Later DESIGN domain gate", ["ROUTE_EVIDENCE", "LEGACY_MAPPING"]),
    descriptor("design-demand-growth", "/design/demand-growth", "DESIGN", "route.design.demand.title", "route.design.demand.heading", MOUNT_KINDS.PLACEHOLDER, [], "Later DESIGN domain gate", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["scenarioId"]),
    descriptor("design-resilience", "/design/resilience", "DESIGN", "route.design.resilience.title", "route.design.resilience.heading", MOUNT_KINDS.PLACEHOLDER, [], "Later DESIGN domain gate"),
    descriptor("design-operational-validation", "/design/operational-validation", "DESIGN", "route.design.validation.title", "route.design.validation.heading", MOUNT_KINDS.PLACEHOLDER, [], "Post-P3 validation bridge gate", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["scenarioId"]),
    descriptor("command-analysis", "/command/analysis", "COMMAND", "route.command.analysis.title", "route.command.analysis.heading", MOUNT_KINDS.LEGACY, ["analysisView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["date", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-cost", "/command/cost", "COMMAND", "route.command.cost.title", "route.command.cost.heading", MOUNT_KINDS.LEGACY, ["costView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["date", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-carbon", "/command/carbon", "COMMAND", "route.command.carbon.title", "route.command.carbon.heading", MOUNT_KINDS.LEGACY, ["carbonView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["date", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-report", "/command/report", "COMMAND", "route.command.report.title", "route.command.report.heading", MOUNT_KINDS.LEGACY, ["reportView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["date", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-root", "/command", "COMMAND", "route.command.root.title", "route.command.root.heading", MOUNT_KINDS.LEGACY, ["serviceView"], "Platform Gate P3"),
    descriptor("command-overview", "/command/overview", "COMMAND", "route.command.overview.title", "route.command.overview.heading", MOUNT_KINDS.LEGACY, ["serviceView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["date", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-dispatch", "/command/dispatch", "COMMAND", "route.command.dispatch.title", "route.command.dispatch.heading", MOUNT_KINDS.LEGACY, ["mapView", "optimizerView", "return-mapView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "SAFE_ROUTE_PARAMETERS", "COMMAND_DOMAIN_MOUNT"], ["date", "candidate", "unassigned", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-mission-control", "/command/mission-control", "COMMAND", "route.command.mission.title", "route.command.mission.heading", MOUNT_KINDS.LEGACY, ["experience-replay"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["runId", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-execution", "/command/execution", "COMMAND", "route.command.execution.title", "route.command.execution.heading", MOUNT_KINDS.LEGACY, ["experience-v16", "experience-v17"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["runId", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-plan-vs-actual", "/command/plan-vs-actual", "COMMAND", "route.command.actual.title", "route.command.actual.heading", MOUNT_KINDS.LEGACY, [], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["runId", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-driver-simulator", "/command/driver-simulator", "COMMAND", "route.command.driver.title", "route.command.driver.heading", MOUNT_KINDS.LEGACY, ["experience-v16"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], COMMAND_ENTITY_KEYS),
    descriptor("command-alerts", "/command/alerts", "COMMAND", "route.command.alerts.title", "route.command.alerts.heading", MOUNT_KINDS.LEGACY, ["exceptionsView"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], [...COMMAND_ENTITY_KEYS, "severity", "state", "source"]),
    descriptor("command-recovery", "/command/recovery", "COMMAND", "route.command.recovery.title", "route.command.recovery.heading", MOUNT_KINDS.LEGACY, ["experience-v16"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], COMMAND_ENTITY_KEYS),
    descriptor("command-shift-review", "/command/shift-review", "COMMAND", "route.command.shift.title", "route.command.shift.heading", MOUNT_KINDS.LEGACY, ["experience-v17"], "Platform Gate P3", ["ROUTE_EVIDENCE", "LEGACY_MAPPING", "COMMAND_DOMAIN_MOUNT"], ["runId", ...COMMAND_ENTITY_KEYS]),
    descriptor("command-validation", "/command/validation", "COMMAND", "route.command.validation.title", "route.command.validation.heading", MOUNT_KINDS.PLACEHOLDER, [], "Platform Gate P6", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["sessionId"]),
    descriptor("platform-data", "/platform/data", "PLATFORM", "route.platform.data.title", "route.platform.data.heading", MOUNT_KINDS.SHARED, ["uploadView"], "Later PLATFORM capability gate"),
    descriptor("platform-scenarios", "/platform/scenarios", "PLATFORM", "route.platform.scenarios.title", "route.platform.scenarios.heading", MOUNT_KINDS.SHARED, [], "Later PLATFORM capability gate", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["scenarioId"]),
    descriptor("platform-trust", "/platform/trust", "PLATFORM", "route.platform.trust.title", "route.platform.trust.heading", MOUNT_KINDS.SHARED, [], "Later PLATFORM capability gate", ["ROUTE_EVIDENCE", "SAFE_ROUTE_PARAMETERS"], ["evidenceId"]),
    descriptor("platform-settings", "/platform/settings", "PLATFORM", "route.platform.settings.title", "route.platform.settings.heading", MOUNT_KINDS.SHARED, [], "Later PLATFORM capability gate"),
  ]);
  const ROUTE_MAP = new Map(ROUTES.map((row) => [row.logicalPath, row]));

  function invalidEncoding(value) {
    try {
      decodeURIComponent(String(value).replace(/\+/g, "%20"));
      return false;
    } catch (_error) {
      return true;
    }
  }

  function fullyDecode(value) {
    let result = String(value);
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(result.replace(/\+/g, "%20"));
      if (next === result) break;
      result = next;
    }
    return result;
  }

  function unsafeValue(value) {
    const text = String(value || "");
    let decoded = text;
    try {
      decoded = fullyDecode(text);
    } catch (_error) {
      return false;
    }
    const samples = [text, decoded].map((item) => item.trim().toLowerCase());
    return samples.some((item) =>
      /[\u0000-\u001f\u007f]/.test(item)
      || /(?:javascript|data|vbscript)\s*:/.test(item)
      || /https?:\/\//.test(item)
      || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(item)
      || /<\/?script/.test(item)
    );
  }

  function normalizePath(rawPath) {
    const raw = String(rawPath == null ? "" : rawPath).trim() || "/";
    if (invalidEncoding(raw)) return { ok: false, error: Errors.create(Errors.CODES.INVALID_ENCODING, "Route contains malformed percent encoding", raw) };
    if (unsafeValue(raw) || /\\/.test(raw)) return { ok: false, error: Errors.create(Errors.CODES.UNSAFE_VALUE, "Route contains an unsafe value", raw) };
    let decoded = fullyDecode(raw);
    if (!decoded.startsWith("/")) decoded = `/${decoded}`;
    decoded = decoded.replace(/\/{2,}/g, "/");
    if (decoded.length > 1) decoded = decoded.replace(/\/+$/, "");
    if (decoded.split("/").some((part) => part === "." || part === "..")) {
      return { ok: false, error: Errors.create(Errors.CODES.UNSAFE_VALUE, "Route traversal is not allowed", raw) };
    }
    return { ok: true, logicalPath: decoded };
  }

  function parseRouteQuery(rawQuery, descriptorValue) {
    const routeParams = {};
    const droppedRouteKeys = [];
    const raw = String(rawQuery || "").replace(/^\?/, "");
    if (!raw) return { ok: true, routeParams, droppedRouteKeys };
    for (const pair of raw.split("&")) {
      const [rawKey = "", ...valueParts] = pair.split("=");
      const rawValue = valueParts.join("=");
      if (invalidEncoding(rawKey) || invalidEncoding(rawValue)) {
        return { ok: false, error: Errors.create(Errors.CODES.INVALID_ENCODING, "Route query contains malformed percent encoding", pair) };
      }
      const key = fullyDecode(rawKey);
      const value = fullyDecode(rawValue);
      if (unsafeValue(key) || unsafeValue(value)) {
        return { ok: false, error: Errors.create(Errors.CODES.UNSAFE_VALUE, "Route query contains an unsafe value", key) };
      }
      if (!descriptorValue.allowedQueryKeys.includes(key)) {
        droppedRouteKeys.push(key);
      } else {
        routeParams[key] = value.slice(0, 256);
      }
    }
    return { ok: true, routeParams, droppedRouteKeys };
  }

  function resolveRoute(rawPath) {
    const normalized = normalizePath(rawPath);
    if (!normalized.ok) return normalized;
    const routeDescriptor = ROUTE_MAP.get(normalized.logicalPath);
    if (!routeDescriptor) {
      return {
        ok: false,
        logicalPath: normalized.logicalPath,
        error: Errors.create(Errors.CODES.NOT_FOUND, "No platform route matches this path", normalized.logicalPath),
      };
    }
    return { ok: true, logicalPath: normalized.logicalPath, descriptor: routeDescriptor, routeParams: {}, droppedRouteKeys: [] };
  }

  function parseLogicalTarget(target) {
    const raw = String(target == null ? "/" : target).replace(/^#/, "");
    const splitAt = raw.indexOf("?");
    const rawPath = splitAt === -1 ? raw : raw.slice(0, splitAt);
    const rawQuery = splitAt === -1 ? "" : raw.slice(splitAt + 1);
    const resolved = resolveRoute(rawPath);
    if (!resolved.ok) return Object.assign(resolved, { attemptedTarget: raw });
    const query = parseRouteQuery(rawQuery, resolved.descriptor);
    if (!query.ok) return Object.assign(query, { logicalPath: resolved.logicalPath, attemptedTarget: raw });
    return Object.assign(resolved, query, { attemptedTarget: raw });
  }

  function sanitizeRuntimeQuery(search) {
    const kept = {};
    const dropped = [];
    const droppedSensitive = [];
    const raw = String(search || "").replace(/^\?/, "");
    for (const pair of raw ? raw.split("&") : []) {
      const [rawKey = "", ...parts] = pair.split("=");
      const rawValue = parts.join("=");
      if (invalidEncoding(rawKey) || invalidEncoding(rawValue)) {
        dropped.push(rawKey || pair);
        continue;
      }
      const key = fullyDecode(rawKey);
      const value = fullyDecode(rawValue);
      if (RUNTIME_QUERY_KEYS.includes(key) && !unsafeValue(value)) kept[key] = value.slice(0, 128);
      else if (SENSITIVE_QUERY_KEY.test(key)) droppedSensitive.push(key);
      else dropped.push(key);
    }
    return { kept, dropped, droppedSensitive };
  }

  function parseBrowserLocation(locationLike) {
    const locationValue = locationLike || {};
    const runtimeQuery = sanitizeRuntimeQuery(locationValue.search);
    const legacy = Legacy.resolveLocation(locationValue);
    if (legacy) {
      const mapped = parseLogicalTarget(legacy.targetLogicalPath);
      if (!mapped.ok || !String(legacy.targetLogicalPath).startsWith("/")) {
        return {
          ok: false,
          logicalPath: "/",
          runtimeQuery,
          error: Errors.create(Errors.CODES.UNSAFE_VALUE, "Legacy route mapping is invalid or cyclic", legacy.legacyId),
        };
      }
      return Object.assign(mapped, {
        runtimeQuery,
        legacy: {
          legacyId: legacy.legacyId,
          targetLogicalPath: legacy.targetLogicalPath,
          status: legacy.status,
          evidence: legacy.evidence,
        },
        migration: legacy.status === Legacy.STATUS.DEPRECATED ? { status: legacy.status, message: legacy.deprecationMessage } : null,
      });
    }
    const hash = String(locationValue.hash || "").replace(/^#/, "");
    const parsed = parseLogicalTarget(hash || "/");
    return Object.assign(parsed, { runtimeQuery });
  }

  function encodeRoute(logicalPath, routeParams) {
    const query = new URLSearchParams();
    Object.entries(routeParams || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([key, value]) => query.set(key, value));
    const suffix = query.toString();
    return `${logicalPath}${suffix ? `?${suffix}` : ""}`;
  }

  function buildBrowserUrl(locationLike, parsed) {
    const runtime = new URLSearchParams();
    Object.entries((parsed.runtimeQuery && parsed.runtimeQuery.kept) || {}).forEach(([key, value]) => runtime.set(key, value));
    const path = (locationLike && locationLike.pathname) || "index.html";
    const search = runtime.toString();
    const route = encodeRoute(parsed.logicalPath || "/", parsed.routeParams || {});
    return `${path}${search ? `?${search}` : ""}#${route}`;
  }

  function createMountScope(environment) {
    const cleanups = [];
    let closed = false;
    function register(cleanup, label) {
      if (typeof cleanup === "function") cleanups.push({ cleanup, label: label || "anonymous" });
      return cleanup;
    }
    return Object.freeze({
      register,
      listen(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        register(() => target.removeEventListener(type, listener, options), `listener:${type}`);
        return listener;
      },
      requestFrame(callback) {
        const request = environment.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
        const cancel = environment.cancelAnimationFrame || clearTimeout;
        const frameId = request.call(environment, callback);
        register(() => cancel.call(environment, frameId), "animation-frame");
        return frameId;
      },
      ownMap(owner) {
        if (typeof owner === "function") return register(owner, "map-owner");
        if (owner && owner.registry && typeof owner.registry.cleanupOwner === "function") {
          return register(() => owner.registry.cleanupOwner(owner.ownerId), "map-registry-owner");
        }
        const cleanup = owner && (owner.cleanup || owner.destroy || owner.remove);
        if (typeof cleanup === "function") return register(() => cleanup.call(owner), "map-owner");
        return null;
      },
      async cleanup() {
        if (closed) return { cleaned: 0, errors: [] };
        closed = true;
        const failures = [];
        let cleaned = 0;
        while (cleanups.length) {
          const item = cleanups.pop();
          try {
            await item.cleanup();
            cleaned += 1;
          } catch (error) {
            failures.push({ label: item.label, message: error && error.message ? error.message : String(error) });
          }
        }
        return { cleaned, errors: failures };
      },
      size() {
        return cleanups.length;
      },
    });
  }

  function createRouter(options) {
    const stateAuthority = options.stateAuthority;
    const workspaceRegistry = options.workspaceRegistry || Workspaces.createRegistry();
    const mountRoute = options.mountRoute;
    const mountError = options.mountError;
    const environment = options.environment || (typeof window !== "undefined" ? window : null);
    const diagnostics = { events: [], cleanupErrors: [], staleRejections: 0, externalRequests: 0 };
    let current = null;
    let generation = 0;
    let transitionTail = Promise.resolve();
    let activeController = null;
    let started = false;
    let lastLocationSignature = "";

    function record(type, detail) {
      diagnostics.events.push({ type, detail: detail || null, generation });
      if (diagnostics.events.length > 200) diagnostics.events.shift();
    }

    function aborted(detail) {
      diagnostics.staleRejections += 1;
      return { ok: false, controlled: true, error: Errors.create(Errors.CODES.MOUNT_ABORTED, "Route mount was superseded", detail) };
    }

    function locationSignature() {
      if (!environment || !environment.location) return "";
      return `${environment.location.pathname || ""}${environment.location.search || ""}${environment.location.hash || ""}`;
    }

    function updateHistory(parsed, mode) {
      if (!environment || !environment.history || mode === "none") return;
      const url = buildBrowserUrl(environment.location, parsed);
      const payload = { stctPlatformRoute: parsed.logicalPath, generation };
      if (mode === "replace") environment.history.replaceState(payload, "", url);
      else environment.history.pushState(payload, "", url);
      lastLocationSignature = locationSignature();
      record(`HISTORY_${mode.toUpperCase()}`, url);
    }

    async function cleanupCurrent() {
      if (!current) return;
      record("UNMOUNT_BEGIN", current.logicalPath || "ERROR");
      const result = await current.scope.cleanup();
      diagnostics.cleanupErrors.push(...result.errors);
      record("UNMOUNT_COMPLETE", { path: current.logicalPath || "ERROR", cleaned: result.cleaned, errors: result.errors.length });
      current = null;
    }

    async function perform(token, parsed, optionsValue) {
      const settings = optionsValue || {};
      if (token !== generation) return aborted({ token, stage: "queued" });
      await cleanupCurrent();
      if (token !== generation) return aborted({ token, stage: "after-unmount" });

      const controller = new AbortController();
      activeController = controller;
      const scope = createMountScope(environment || {});
      const context = {
        descriptor: parsed.descriptor || null,
        logicalPath: parsed.logicalPath || "/",
        routeParams: parsed.routeParams || {},
        migration: parsed.migration || null,
        legacy: parsed.legacy || null,
        signal: controller.signal,
        generation: token,
        scope,
      };

      if (!parsed.ok) {
        try {
          await mountError({ error: parsed.error, logicalPath: parsed.logicalPath || "/", signal: controller.signal, scope, generation: token });
          if (token !== generation || controller.signal.aborted) {
            await scope.cleanup();
            return aborted({ token, stage: "error-mount" });
          }
          current = { logicalPath: null, descriptor: null, scope, controller, error: parsed.error };
          updateHistory(parsed, settings.historyMode || "push");
          record("CONTROLLED_ERROR", parsed.error.code);
          return { ok: false, controlled: true, error: parsed.error };
        } catch (error) {
          await scope.cleanup();
          return { ok: false, controlled: true, error: Errors.normalize(error, Errors.CODES.MOUNT_FAILED) };
        }
      }

      try {
        record("MOUNT_BEGIN", parsed.logicalPath);
        const mounted = await mountRoute(context);
        if (mounted && typeof mounted.cleanup === "function") scope.register(mounted.cleanup, "route-mount-result");
        if (token !== generation || controller.signal.aborted) {
          const cleanup = await scope.cleanup();
          diagnostics.cleanupErrors.push(...cleanup.errors);
          return aborted({ token, stage: "after-mount" });
        }
        const committed = stateAuthority.commitRoute(parsed.logicalPath, parsed.descriptor.workspace, parsed.routeParams || {});
        if (!committed.ok) throw committed.error;
        current = { logicalPath: parsed.logicalPath, descriptor: parsed.descriptor, scope, controller, error: null };
        const historyMode = parsed.legacy ? "replace" : (settings.historyMode || "push");
        updateHistory(parsed, historyMode);
        record("MOUNT_COMMITTED", parsed.logicalPath);
        return { ok: true, descriptor: parsed.descriptor, state: committed.state, legacy: parsed.legacy || null, migration: parsed.migration || null };
      } catch (error) {
        const cleanup = await scope.cleanup();
        diagnostics.cleanupErrors.push(...cleanup.errors);
        if (token !== generation || controller.signal.aborted) return aborted({ token, stage: "mount-catch" });
        const normalized = Errors.normalize(error, Errors.CODES.MOUNT_FAILED);
        const routeError = normalized.code === Errors.CODES.MOUNT_FAILED
          ? normalized
          : Errors.create(Errors.CODES.MOUNT_FAILED, normalized.message, normalized.detail);
        const errorScope = createMountScope(environment || {});
        await mountError({ error: routeError, logicalPath: parsed.logicalPath, signal: controller.signal, scope: errorScope, generation: token });
        current = { logicalPath: null, descriptor: null, scope: errorScope, controller, error: routeError };
        record("MOUNT_FAILED", routeError.code);
        return { ok: false, controlled: true, error: routeError };
      }
    }

    function schedule(parsed, optionsValue) {
      const token = ++generation;
      if (activeController) activeController.abort();
      const task = transitionTail.then(
        () => perform(token, parsed, optionsValue),
        () => perform(token, parsed, optionsValue),
      );
      transitionTail = task.catch(() => null);
      return task;
    }

    function withRuntimeQuery(parsed) {
      if (parsed.runtimeQuery) return parsed;
      const runtimeQuery = sanitizeRuntimeQuery(environment && environment.location ? environment.location.search : "");
      return Object.assign(parsed, { runtimeQuery });
    }

    function navigate(target, optionsValue) {
      return schedule(withRuntimeQuery(parseLogicalTarget(target)), optionsValue || { historyMode: "push" });
    }

    function navigateWorkspace(workspace) {
      const descriptorValue = workspaceRegistry.get(String(workspace || "").toLowerCase());
      if (!descriptorValue) {
        return schedule(withRuntimeQuery({
          ok: false,
          logicalPath: "/",
          error: Errors.create(Errors.CODES.NOT_FOUND, "Workspace is not registered", workspace),
        }), { historyMode: "push" });
      }
      const shellState = stateAuthority.snapshot();
      const envelope = shellState.workspaceStates && shellState.workspaceStates[descriptorValue.key.toUpperCase()];
      const rememberedRoute = envelope && descriptorValue.allowedRoutes.includes(envelope.lastRoute)
        ? envelope.lastRoute
        : descriptorValue.defaultRoute;
      return navigate(rememberedRoute, { historyMode: "push" });
    }

    function onLocationChange(source) {
      const signature = locationSignature();
      if (signature && signature === lastLocationSignature) return Promise.resolve({ ok: true, ignored: true });
      lastLocationSignature = signature;
      const parsed = parseBrowserLocation(environment.location);
      record("LOCATION_CHANGE", source);
      return schedule(parsed, { historyMode: "none" });
    }

    function handlePopState() {
      onLocationChange("popstate");
    }

    function handleHashChange() {
      onLocationChange("hashchange");
    }

    async function start() {
      if (started) return { ok: true, alreadyStarted: true };
      started = true;
      if (environment && environment.addEventListener) {
        environment.addEventListener("popstate", handlePopState);
        environment.addEventListener("hashchange", handleHashChange);
      }
      const parsed = parseBrowserLocation(environment && environment.location ? environment.location : {});
      lastLocationSignature = locationSignature();
      return schedule(parsed, { historyMode: parsed.legacy ? "replace" : "replace" });
    }

    async function stop() {
      generation += 1;
      if (activeController) activeController.abort();
      if (environment && environment.removeEventListener) {
        environment.removeEventListener("popstate", handlePopState);
        environment.removeEventListener("hashchange", handleHashChange);
      }
      await transitionTail;
      await cleanupCurrent();
      started = false;
      return { ok: true };
    }

    return Object.freeze({
      start,
      stop,
      navigate,
      navigateWorkspace,
      parseCurrentLocation() {
        return parseBrowserLocation(environment && environment.location ? environment.location : {});
      },
      currentView() {
        return current ? { logicalPath: current.logicalPath, descriptor: current.descriptor, error: current.error } : null;
      },
      diagnostics() {
        return JSON.parse(JSON.stringify(diagnostics));
      },
    });
  }

  return Object.freeze({
    MOUNT_KINDS,
    RUNTIME_QUERY_KEYS,
    ROUTES,
    resolveRoute,
    parseLogicalTarget,
    parseBrowserLocation,
    sanitizeRuntimeQuery,
    buildBrowserUrl,
    createMountScope,
    createRouter,
  });
});
