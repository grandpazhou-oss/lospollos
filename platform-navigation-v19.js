(function (root, factory) {
  "use strict";
  const ns = root.STCTPlatformV19 || {};
  const dependencies = typeof module === "object" && module.exports
    ? {
      I18n: require("./platform-navigation-i18n-v19.js"),
      Model: require("./workspace-navigation-model-v19.js"),
      Switcher: require("./workspace-switcher-v19.js"),
      Sidebar: require("./workspace-sidebar-v19.js"),
      Mobile: require("./mobile-navigation-v19.js"),
      Performance: require("./platform-navigation-performance-v19.js"),
    }
    : {
      I18n: ns.navigationI18n,
      Model: ns.navigationModel,
      Switcher: ns.workspaceSwitcher,
      Sidebar: ns.workspaceSidebar,
      Mobile: ns.mobileNavigation,
      Performance: ns.navigationPerformance,
    };
  const api = factory(root, dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.navigation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, dependencies) {
  "use strict";

  function createBodyScrollLock(documentValue) {
    let active = false;
    let priorOverflow = "";
    return Object.freeze({
      sync(open) {
        const next = Boolean(open);
        if (next && !active) {
          priorOverflow = documentValue.body.style.overflow;
          documentValue.body.style.overflow = "hidden";
        } else if (!next && active) {
          documentValue.body.style.overflow = priorOverflow;
        }
        active = next;
        return { active, priorOverflow };
      },
      destroy() {
        if (active) documentValue.body.style.overflow = priorOverflow;
        active = false;
        return { active, priorOverflow };
      },
      snapshot() {
        return { active, priorOverflow };
      },
    });
  }

  function createPlatformNavigation(options) {
    const documentValue = options.document;
    const controller = options.controller;
    const routeRegistry = options.routeRegistry;
    const recorder = options.recorder || dependencies.Performance.createRecorder(root);
    const view = documentValue.getElementById("platformRouteView");
    const elements = {
      shell: view.querySelector("[data-platform-shell]"),
      sidebar: view.querySelector("[data-platform-sidebar]"),
      display: view.querySelector("[data-platform-display]"),
      switcher: view.querySelector("[data-workspace-switcher]"),
      business: view.querySelector("[data-workspace-business-nav]"),
      platform: view.querySelector("[data-shared-platform-nav]"),
      footer: view.querySelector("[data-sidebar-controls]"),
      mobileTopbar: view.querySelector("[data-platform-mobile-topbar]"),
      backdrop: view.querySelector("[data-platform-drawer-backdrop]"),
      drawer: view.querySelector("[data-platform-mobile-drawer]"),
      drawerSwitcher: view.querySelector("[data-mobile-workspace-switcher]"),
      drawerBusiness: view.querySelector("[data-mobile-business-nav]"),
      drawerPlatform: view.querySelector("[data-mobile-platform-nav]"),
      live: view.querySelector("[data-platform-live]"),
      breadcrumb: view.querySelector("[data-platform-breadcrumb]"),
    };
    let lastSnapshot = null;
    let lastBusinessWorkspace = null;
    let mobileMode = false;
    let drawerKeydownBound = false;
    let drawerActuallyOpen = false;
    const bodyScrollLock = createBodyScrollLock(documentValue);
    let pendingFocusWorkspace = null;
    let frameId = null;

    function localeText(key, locale, values) {
      return dependencies.I18n.translate(key, locale, values);
    }

    function isMobile() {
      return Boolean(root.matchMedia && root.matchMedia("(max-width: 900px)").matches);
    }

    function recordListener(delta) {
      recorder.adjust("listeners", delta);
    }

    function publishDiagnostics() {
      elements.shell.dataset.navigationDiagnostics = JSON.stringify(recorder.snapshot());
    }

    function setDrawerKeyboard(open) {
      if (open && !drawerKeydownBound) {
        documentValue.addEventListener("keydown", onDrawerKeydown);
        drawerKeydownBound = true;
        recordListener(1);
        recorder.adjust("drawerHandlers", 1);
      } else if (!open && drawerKeydownBound) {
        documentValue.removeEventListener("keydown", onDrawerKeydown);
        drawerKeydownBound = false;
        recordListener(-1);
        recorder.adjust("drawerHandlers", -1);
      }
    }

    function setDrawerOpen(open, restoreFocus) {
      const actualOpen = Boolean(open && mobileMode && lastSnapshot && lastSnapshot.activeRoute !== "/");
      elements.drawer.hidden = !actualOpen;
      elements.backdrop.hidden = !actualOpen;
      elements.drawer.classList.toggle("open", actualOpen);
      elements.backdrop.classList.toggle("open", actualOpen);
      dependencies.Mobile.setInteractive(elements.drawer, actualOpen);
      const menu = elements.mobileTopbar.querySelector("[data-platform-drawer-toggle]");
      if (menu) menu.setAttribute("aria-expanded", String(actualOpen));
      setDrawerKeyboard(actualOpen);
      bodyScrollLock.sync(actualOpen);
      if (actualOpen && !drawerActuallyOpen) {
        const focusable = dependencies.Mobile.focusableElements(elements.drawer);
        if (focusable.length) focusable[0].focus();
      } else if (!actualOpen && drawerActuallyOpen) {
        if (restoreFocus && menu) menu.focus();
      }
      drawerActuallyOpen = actualOpen;
    }

    function scheduleLayoutResize() {
      if (frameId != null) return;
      const request = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 16));
      const cancel = root.cancelAnimationFrame || root.clearTimeout;
      recorder.adjust("raf", 1);
      frameId = request.call(root, () => {
        frameId = null;
        recorder.adjust("raf", -1);
        recorder.measure("layout-map-resize", () => {
          if (typeof root.Event === "function" && root.dispatchEvent) root.dispatchEvent(new root.Event("resize"));
        });
        publishDiagnostics();
      });
      return () => {
        if (frameId != null) {
          cancel.call(root, frameId);
          frameId = null;
          recorder.adjust("raf", -1);
        }
      };
    }

    function renderDisplay(model, locale) {
      elements.display.replaceChildren();
      const title = documentValue.createElement("button");
      title.type = "button";
      title.className = "platform-display-home";
      title.dataset.platformRoute = "/";
      title.setAttribute("aria-label", localeText("platform.name", locale));
      const mark = documentValue.createElement("span");
      mark.className = "platform-display-mark";
      mark.textContent = "SC";
      const copy = documentValue.createElement("span");
      copy.className = "platform-display-copy";
      const name = documentValue.createElement("strong");
      name.textContent = localeText("platform.name", locale);
      const workspace = documentValue.createElement("small");
      workspace.textContent = model.businessWorkspace;
      copy.append(name, workspace);
      title.append(mark, copy);
      elements.display.append(title);
    }

    function renderFooter(model, locale) {
      const languageLabel = documentValue.createElement("label");
      languageLabel.className = "platform-locale-control";
      const text = documentValue.createElement("span");
      text.textContent = localeText("control.language", locale);
      const select = documentValue.createElement("select");
      select.dataset.platformLocale = "true";
      select.setAttribute("aria-label", localeText("control.language", locale));
      [["zh", "中文"], ["en", "English"], ["ja", "日本語"]].forEach(([value, label]) => {
        const option = documentValue.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === locale;
        select.append(option);
      });
      languageLabel.append(text, select);
      const collapse = documentValue.createElement("button");
      collapse.type = "button";
      collapse.className = "platform-collapse-control";
      collapse.dataset.platformCollapse = "true";
      collapse.setAttribute("aria-label", localeText(model.collapsed ? "control.expand" : "control.collapse", locale));
      collapse.title = localeText(model.collapsed ? "control.expand" : "control.collapse", locale);
      collapse.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${model.collapsed ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"}"/></svg>`;
      elements.footer.replaceChildren(languageLabel, collapse);
    }

    function renderDrawerHeader(model, locale) {
      let header = elements.drawer.querySelector(".platform-drawer-header");
      if (!header) {
        header = documentValue.createElement("header");
        header.className = "platform-drawer-header";
        elements.drawer.prepend(header);
      }
      const title = documentValue.createElement("div");
      title.className = "platform-drawer-title";
      const strong = documentValue.createElement("strong");
      strong.textContent = localeText("platform.name", locale);
      const small = documentValue.createElement("span");
      small.textContent = model.businessWorkspace;
      title.append(strong, small);
      const close = documentValue.createElement("button");
      close.type = "button";
      close.className = "platform-drawer-close";
      close.dataset.platformDrawerClose = "true";
      close.setAttribute("aria-label", localeText("control.close", locale));
      close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M6 18 18 6"/></svg>';
      header.replaceChildren(title, close);
    }

    function syncAccessibility(model) {
      mobileMode = isMobile();
      const home = model.isHome;
      dependencies.Mobile.setInteractive(elements.sidebar, !mobileMode && !home);
      elements.sidebar.hidden = home;
      if (!mobileMode || home) setDrawerOpen(false, false);
      else setDrawerOpen(model.drawerOpen, false);
    }

    function sync(snapshot, heading) {
      lastSnapshot = snapshot;
      const model = recorder.measure("navigation-model-build", () => dependencies.Model.buildNavigationModel(snapshot, routeRegistry));
      elements.shell.dataset.platformWorkspace = model.activeWorkspace;
      elements.shell.dataset.businessWorkspace = model.businessWorkspace;
      elements.shell.dataset.navigationCollapsed = String(model.collapsed);
      elements.shell.dataset.platformHome = String(model.isHome);
      elements.shell.dataset.reducedMotion = String(model.reducedMotion);
      elements.shell.dataset.noWebgl = String(model.noWebGL);
      elements.shell.dataset.locale = snapshot.locale;
      recorder.measure("sidebar-render", () => {
        renderDisplay(model, snapshot.locale);
        dependencies.Switcher.render({ document: documentValue, target: elements.switcher, model, locale: snapshot.locale });
        dependencies.Sidebar.renderBusiness({ document: documentValue, target: elements.business, model, locale: snapshot.locale });
        dependencies.Sidebar.renderPlatform({ document: documentValue, target: elements.platform, model, locale: snapshot.locale });
        renderFooter(model, snapshot.locale);
        renderDrawerHeader(model, snapshot.locale);
        dependencies.Switcher.render({ document: documentValue, target: elements.drawerSwitcher, model, locale: snapshot.locale });
        dependencies.Sidebar.renderBusiness({ document: documentValue, target: elements.drawerBusiness, model, locale: snapshot.locale });
        dependencies.Sidebar.renderPlatform({ document: documentValue, target: elements.drawerPlatform, model, locale: snapshot.locale });
        dependencies.Mobile.renderTopbar({ document: documentValue, target: elements.mobileTopbar, model, locale: snapshot.locale, heading });
      });
      elements.backdrop.setAttribute("aria-label", localeText("control.close", snapshot.locale));
      elements.drawer.setAttribute("aria-label", localeText("nav.drawer", snapshot.locale));
      if (!model.isHome) {
        elements.breadcrumb.textContent = `${localeText("platform.name", snapshot.locale)} / ${model.activeWorkspace === "PLATFORM" ? "PLATFORM" : model.businessWorkspace} / ${heading}`;
      } else {
        elements.breadcrumb.textContent = localeText("platform.name", snapshot.locale);
      }
      elements.breadcrumb.setAttribute("aria-label", localeText("nav.breadcrumb", snapshot.locale));
      let appearance = elements.shell.querySelector(".platform-theme-corner");
      if (!appearance) { appearance=documentValue.createElement("div");appearance.className="platform-theme-corner";elements.shell.append(appearance); }
      appearance.innerHTML=root.STCTPlatformV19?.theme?.toggle(snapshot.locale)||"";
      syncAccessibility(model);
      if (lastBusinessWorkspace && lastBusinessWorkspace !== model.businessWorkspace && model.activeWorkspace !== "PLATFORM") {
        elements.live.textContent = localeText("announce.workspace", snapshot.locale, { workspace: model.businessWorkspace });
      }
      lastBusinessWorkspace = model.businessWorkspace;
      if (pendingFocusWorkspace && model.activeWorkspace === pendingFocusWorkspace) {
        const workspaceControls = Array.from(view.querySelectorAll(`button[data-platform-workspace="${pendingFocusWorkspace}"]`));
        const focusTarget = workspaceControls.find((control) => !control.hidden && !control.closest("[inert]"))
          || workspaceControls[0];
        if (focusTarget) root.setTimeout(() => focusTarget.focus(), 0);
        pendingFocusWorkspace = null;
      }
      publishDiagnostics();
      return model;
    }

    async function activateRoute(target, workspace) {
      if (workspace) pendingFocusWorkspace = workspace;
      const result = workspace
        ? await recorder.measure("workspace-switch", () => controller.navigateWorkspace(workspace))
        : await recorder.measure("route-switch", () => controller.navigate(target));
      publishDiagnostics();
      if (!result || !result.ok) pendingFocusWorkspace = null;
      if (result && result.ok && isMobile()) {
        const menu = elements.mobileTopbar.querySelector("[data-platform-drawer-toggle]");
        if (menu) root.setTimeout(() => menu.focus(), 0);
      }
      return result;
    }

    function onRootClick(event) {
      const route = event.target.closest("[data-platform-route]");
      if (route) {
        event.preventDefault();
        activateRoute(route.dataset.platformRoute, null);
        return;
      }
      const workspace = event.target.closest("button[data-platform-workspace]");
      if (workspace) {
        event.preventDefault();
        activateRoute(null, workspace.dataset.platformWorkspace);
        return;
      }
      if (event.target.closest("[data-platform-collapse]")) {
        recorder.measure("sidebar-collapse", () => controller.setNavigationCollapsed(!controller.snapshot().navigationCollapsed));
        scheduleLayoutResize();
        publishDiagnostics();
        return;
      }
      if (event.target.closest("[data-platform-drawer-toggle]")) {
        recorder.measure("mobile-drawer", () => controller.setMobileDrawerOpen(!controller.snapshot().mobileDrawerOpen));
        publishDiagnostics();
        return;
      }
      if (event.target.closest("[data-platform-drawer-close]") || event.target.closest("[data-platform-drawer-backdrop]")) {
        recorder.measure("mobile-drawer", () => controller.setMobileDrawerOpen(false));
        root.setTimeout(() => { setDrawerOpen(false, true); elements.mobileTopbar.querySelector("[data-platform-drawer-toggle]")?.focus(); }, 0);
        publishDiagnostics();
      }
    }

    function onRootChange(event) {
      const select = event.target.closest("[data-platform-locale]");
      if (select) controller.setLocale(select.value);
    }

    function onDrawerKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        controller.setMobileDrawerOpen(false);
        root.setTimeout(() => { setDrawerOpen(false, true); elements.mobileTopbar.querySelector("[data-platform-drawer-toggle]")?.focus(); }, 0);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dependencies.Mobile.focusableElements(elements.drawer);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && documentValue.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentValue.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onResize() {
      const nextMode = isMobile();
      if (nextMode === mobileMode) return;
      mobileMode = nextMode;
      if (lastSnapshot) sync(lastSnapshot, options.heading());
    }

    view.addEventListener("click", onRootClick);
    view.addEventListener("change", onRootChange);
    root.addEventListener("resize", onResize);
    recordListener(3);

    return Object.freeze({
      sync,
      diagnostics: recorder.snapshot,
      destroy() {
        view.removeEventListener("click", onRootClick);
        view.removeEventListener("change", onRootChange);
        root.removeEventListener("resize", onResize);
        recordListener(-3);
        setDrawerKeyboard(false);
        setDrawerOpen(false, false);
        bodyScrollLock.destroy();
        if (frameId != null) {
          const cancel = root.cancelAnimationFrame || root.clearTimeout;
          cancel.call(root, frameId);
          frameId = null;
          recorder.adjust("raf", -1);
        }
      },
    });
  }

  return Object.freeze({ createBodyScrollLock, createPlatformNavigation });
});
