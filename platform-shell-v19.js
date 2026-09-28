(function (root, factory) {
  "use strict";
  const namespace = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const dependencies = typeof module === "object" && module.exports
    ? {
      Errors: require("./platform-route-errors-v19.js"),
      Workspaces: require("./workspace-registry-v19.js"),
      State: require("./workspace-state-v19.js"),
      Router: require("./workspace-router-v19.js"),
      Outlet: require("./platform-route-outlet-v19.js"),
      Legacy: require("./legacy-route-mapping-v19.js"),
      Guard: require("./workspace-unsaved-guard-v19.js"),
      Navigation: require("./platform-navigation-v19.js"),
      NavigationI18n: require("./platform-navigation-i18n-v19.js"),
      Performance: require("./platform-navigation-performance-v19.js"),
      CommandAdapter: require("./command-workspace-adapter-v19.js"),
      DesignAdapter: require("./design-workspace-adapter-v19.js"),
      StudyContext: require("./platform-study-context-v8.js"),
    }
    : {
      Errors: namespace.errors,
      Workspaces: namespace.workspaceRegistry,
      State: namespace.state,
      Router: namespace.router,
      Outlet: namespace.outlet,
      Legacy: namespace.legacyRoutes,
      Guard: namespace.unsavedGuard,
      Navigation: namespace.navigation,
      NavigationI18n: namespace.navigationI18n,
      Performance: namespace.navigationPerformance,
      CommandAdapter: namespace.commandWorkspaceAdapter,
      DesignAdapter: namespace.designWorkspaceAdapter,
      StudyContext: namespace.studyContext,
    };
  const api = factory(root, dependencies);
  Object.assign(namespace, api);
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, dependencies) {
  "use strict";

  const STORAGE_KEY = "stct-platform-shell-v19-p2";

  function readLocale(documentValue) {
    const select = documentValue.getElementById("loginLang");
    if (select && dependencies.State.LOCALES.includes(select.value)) return select.value;
    try {
      const stored = root.localStorage.getItem("flowmap_lang");
      if (dependencies.State.LOCALES.includes(stored)) return stored;
    } catch (_error) {}
    return "zh";
  }

  function runtimePreferences(locationValue) {
    const params = new URLSearchParams((locationValue && locationValue.search) || "");
    return {
      noWebGL: params.get("noWebGL") === "1" || params.get("no-webgl") === "1",
      reducedMotion: params.get("reduced-motion") === "1"
        || Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches),
    };
  }

  function readInitialState(documentValue) {
    const runtime = runtimePreferences(root.location);
    let restored = null;
    try {
      const payload = root.sessionStorage.getItem(STORAGE_KEY);
      if (payload) restored = dependencies.State.restoreState(payload, (route) => dependencies.Router.resolveRoute(route).ok);
    } catch (_error) {}
    if (restored && restored.ok) {
      const candidate = JSON.parse(JSON.stringify(restored.state));
      candidate.locale = readLocale(documentValue);
      candidate.noWebGL = runtime.noWebGL || candidate.noWebGL;
      candidate.reducedMotion = runtime.reducedMotion || candidate.reducedMotion;
      return candidate;
    }
    return dependencies.State.defaults({ locale: readLocale(documentValue), noWebGL: runtime.noWebGL, reducedMotion: runtime.reducedMotion });
  }

  function identifyLegacyButton(button) {
    if (!button) return null;
    if (button.dataset.view) {
      if (button.dataset.view === "mapView" && button.textContent.includes("返回")) return "return-mapView";
      return button.dataset.view;
    }
    if (button.hasAttribute("data-experience-open")) return "experience-replay";
    if (button.hasAttribute("data-v16-open")) return "experience-v16";
    if (button.hasAttribute("data-v17-open")) return "experience-v17";
    return null;
  }

  function createPlatformShell(options) {
    const documentValue = (options && options.document) || root.document;
    const stateAuthority = dependencies.State.createAuthority(readInitialState(documentValue));
    const workspaceRegistry = dependencies.Workspaces.createRegistry();
    const recorder = dependencies.Performance.createRecorder(root);
    const commandAdapter = dependencies.CommandAdapter.createAdapter({ document: documentValue });
    const designAdapter = dependencies.DesignAdapter.createAdapter({ document: documentValue });
    const studyContext = dependencies.StudyContext.createContext();
    designAdapter.setStudyContext(studyContext);
    const outlet = dependencies.Outlet.createOutlet({ document: documentValue, core: root.STCTCore, recorder, commandAdapter, designAdapter, studyContext });
    const cleanups = [];
    const router = dependencies.Router.createRouter({
      stateAuthority,
      workspaceRegistry,
      environment: root,
      mountRoute(context) {
        recorder.adjust("routeOwners", 1);
        let mounted;
        try {
          mounted = outlet.mount(context, stateAuthority.snapshot());
        } catch (error) {
          recorder.adjust("routeOwners", -1);
          throw error;
        }
        return {
          cleanup() {
            recorder.adjust("routeOwners", -1);
            if (mounted && typeof mounted.cleanup === "function") return mounted.cleanup();
          },
        };
      },
      mountError(context) {
        return outlet.mountError(context, stateAuthority.snapshot());
      },
    });

    function persist(snapshot) {
      const serialized = dependencies.State.serializeState(snapshot);
      if (!serialized.ok) return;
      try {
        root.sessionStorage.setItem(STORAGE_KEY, serialized.payload);
      } catch (_error) {}
    }

    const guard = dependencies.Guard.createGuard({
      snapshot: stateAuthority.snapshot,
      navigate(target, navigateOptions) {
        if (target && target.kind === "workspace") return router.navigateWorkspace(target.workspace);
        return router.navigate(target, navigateOptions);
      },
      confirm(message) {
        return typeof root.confirm === "function" ? root.confirm(message) : true;
      },
      message(workspace, locale) {
        return dependencies.NavigationI18n.translate("warning.unsaved", locale, { workspace });
      },
    });

    const controller = Object.freeze({
      navigate(target, optionsValue) {
        const parsed = dependencies.Router.parseLogicalTarget(target);
        const targetWorkspace = parsed.ok ? parsed.descriptor.workspace : stateAuthority.snapshot().activeWorkspace;
        return guard.request(target, targetWorkspace, optionsValue || { historyMode: "push" });
      },
      navigateWorkspace(workspace) {
        return guard.request({ kind: "workspace", workspace }, workspace, { historyMode: "push" });
      },
      snapshot: stateAuthority.snapshot,
      setMobileDrawerOpen(value) {
        return stateAuthority.setPreference("mobileDrawerOpen", Boolean(value));
      },
      setNavigationCollapsed(value) {
        return stateAuthority.setPreference("navigationCollapsed", Boolean(value));
      },
      setLocale(value) {
        return stateAuthority.setPreference("locale", value);
      },
      setReducedMotion(value) {
        return stateAuthority.setPreference("reducedMotion", Boolean(value));
      },
      setNoWebGL(value) {
        return stateAuthority.setPreference("noWebGL", Boolean(value));
      },
      setWorkspacePresentation(workspace, patch) {
        return stateAuthority.setWorkspacePresentation(workspace, patch);
      },
    });
    outlet.bind(controller);
    commandAdapter.bind({ controller });
    designAdapter.bind({ controller });
    const navigation = dependencies.Navigation.createPlatformNavigation({
      document: documentValue,
      controller,
      routeRegistry: dependencies.Router.ROUTES,
      recorder,
      heading: outlet.heading,
    });
    cleanups.push(stateAuthority.subscribe((snapshot) => {
      persist(snapshot);
      outlet.sync(snapshot);
      navigation.sync(snapshot, outlet.heading());
    }));
    navigation.sync(stateAuthority.snapshot(), outlet.heading());

    const navrail = documentValue.querySelector(".navrail");
    if (navrail) {
      const legacyNavigation = (event) => {
        const button = event.target.closest(".navbtn");
        const legacyId = identifyLegacyButton(button);
        const mapping = dependencies.Legacy.getById(legacyId);
        if (!mapping) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        router.navigate(mapping.targetLogicalPath, { historyMode: "push" });
      };
      navrail.addEventListener("click", legacyNavigation, true);
      cleanups.push(() => navrail.removeEventListener("click", legacyNavigation, true));
    }

    const language = documentValue.getElementById("loginLang");
    if (language) {
      const localeChange = () => {
        const locale = language.value;
        root.setTimeout(() => {
          if (!dependencies.State.LOCALES.includes(locale)) return;
          if (stateAuthority.snapshot().locale === locale) outlet.sync(stateAuthority.snapshot());
          else stateAuthority.setPreference("locale", locale);
        }, 0);
      };
      language.addEventListener("input", localeChange);
      language.addEventListener("change", localeChange);
      cleanups.push(
        () => language.removeEventListener("input", localeChange),
        () => language.removeEventListener("change", localeChange),
      );
    }

    const ready = Promise.resolve(outlet.ready).then(() => router.start());
    const instance = Object.freeze({
      ready,
      navigate: controller.navigate,
      navigateWorkspace: controller.navigateWorkspace,
      snapshot: stateAuthority.snapshot,
      diagnostics: router.diagnostics,
      navigationDiagnostics: navigation.diagnostics,
      registry: workspaceRegistry,
      routeRegistry: dependencies.Router.ROUTES,
      legacyRouteMap: dependencies.Legacy.MAPPINGS,
      commandAdapter,
      designAdapter,
      studyContext,
      setLocale(locale) {
        if (!dependencies.State.LOCALES.includes(locale)) {
          return { ok: false, error: dependencies.Errors.create(dependencies.Errors.CODES.RESTORE_INVALID, "Unsupported locale", locale) };
        }
        return stateAuthority.setPreference("locale", locale);
      },
      setReducedMotion(value) {
        return stateAuthority.setPreference("reducedMotion", Boolean(value));
      },
      setNoWebGL(value) {
        return stateAuthority.setPreference("noWebGL", Boolean(value));
      },
      setPlatformPanel(value) {
        return stateAuthority.setPreference("platformPanel", value == null ? null : String(value));
      },
      setNavigationCollapsed(value) {
        return stateAuthority.setPreference("navigationCollapsed", Boolean(value));
      },
      setWorkspacePresentation(workspace, patch) {
        return stateAuthority.setWorkspacePresentation(workspace, patch);
      },
      async destroy() {
        while (cleanups.length) cleanups.pop()();
        navigation.destroy();
        outlet.destroy();
        return router.stop();
      },
    });
    return instance;
  }

  function bootstrap() {
    if (!root.document || root.STCTPlatformV19.instance) return root.STCTPlatformV19.instance || null;
    root.STCTPlatformV19.instance = createPlatformShell();
    return root.STCTPlatformV19.instance;
  }

  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    else Promise.resolve().then(bootstrap);
  }

  return Object.freeze({ STORAGE_KEY, createPlatformShell, bootstrap });
});
