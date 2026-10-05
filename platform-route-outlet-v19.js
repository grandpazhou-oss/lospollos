(function (root, factory) {
  "use strict";
  const namespace = root && root.STCTPlatformV19 ? root.STCTPlatformV19 : {};
  const api = factory({ Home: namespace.platformHome, NavigationI18n: namespace.navigationI18n, Services: namespace.platformServices });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.outlet = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (dependencies) {
  "use strict";

  const COPY = Object.freeze({
    en: Object.freeze({
      "route.command.analysis.heading": "Transport analysis",
      "route.command.cost.heading": "Transport costs",
      "route.command.carbon.heading": "Carbon estimates",
      "route.command.report.heading": "Transport report",
      "workspace.design.description": "Network Design & Strategic Planning",
      "workspace.command.description": "Transportation Operations & Execution",
      "workspace.platform.description": "Shared platform services",
      "route.home.title": "Supply Chain Decision Platform",
      "route.home.heading": "Supply Chain Decision Platform",
      "route.design.root.heading": "DESIGN Workspace",
      "route.design.overview.heading": "Network Map",
      "route.design.facility.heading": "Facility Location",
      "route.design.supply.heading": "Supply Chain Design",
      "route.design.scenarios.heading": "Scenario Compare",
      "route.design.fleet.heading": "Cost & Capacity",
      "route.design.cost.heading": "Cost-to-Serve",
      "route.design.demand.heading": "Demand & Growth",
      "route.design.resilience.heading": "Resilience",
      "route.design.validation.heading": "Operational Validation",
      "route.command.root.heading": "COMMAND Workspace",
      "route.command.overview.heading": "Transport Map",
      "route.command.dispatch.heading": "Orders & Dispatch",
      "route.command.mission.heading": "Execution & Replay",
      "route.command.execution.heading": "Execution",
      "route.command.actual.heading": "Plan vs Actual",
      "route.command.driver.heading": "Driver Simulator",
      "route.command.alerts.heading": "Exceptions & Recovery",
      "route.command.recovery.heading": "Recovery",
      "route.command.shift.heading": "Review & Handoff",
      "route.command.validation.heading": "Operational Validation",
      "route.platform.data.heading": "Data Hub",
      "route.platform.scenarios.heading": "Scenario Library",
      "route.platform.trust.heading": "Trust & Audit",
      "route.platform.settings.heading": "Settings",
      "status.route.active": "P2 workspace navigation is active.",
      "status.domain.pending": "This business capability remains a controlled placeholder until its owning gate.",
      "label.logicalRoute": "Logical route",
      "label.currentGate": "Current gate status",
      "label.futureGate": "Future owner gate",
      "label.legacyTarget": "Legacy target mapping",
      "label.routeParams": "Safe route parameters",
      "label.none": "None",
      "label.notFound": "Route unavailable",
      "label.errorCode": "Error code",
      "label.workspaceMenu": "Workspace menu",
      "label.breadcrumb": "Breadcrumb",
      "home.p2": "Platform Gate P2 will implement final workspace cards and navigation.",
      "error.body": "This page could not be opened. Choose a page from the workspace menu, or return to the previous page and try again.",
    }),
    zh: Object.freeze({
      "route.command.analysis.heading": "运输分析",
      "route.command.cost.heading": "运输成本",
      "route.command.carbon.heading": "碳排估算",
      "route.command.report.heading": "运输报告",
      "workspace.design.description": "网络设计与战略规划",
      "workspace.command.description": "运输运营与执行",
      "workspace.platform.description": "共享平台服务",
      "route.home.title": "Supply Chain Decision Platform",
      "route.home.heading": "Supply Chain Decision Platform",
      "route.design.root.heading": "DESIGN 工作区",
      "route.design.overview.heading": "仓网地图",
      "route.design.facility.heading": "仓库选址",
      "route.design.supply.heading": "供应链网络设计",
      "route.design.scenarios.heading": "方案对比",
      "route.design.fleet.heading": "成本与运力",
      "route.design.cost.heading": "服务成本",
      "route.design.demand.heading": "需求与增长",
      "route.design.resilience.heading": "韧性",
      "route.design.validation.heading": "运营试跑",
      "route.command.root.heading": "COMMAND 工作区",
      "route.command.overview.heading": "运输地图",
      "route.command.dispatch.heading": "订单与排车",
      "route.command.mission.heading": "执行与回放",
      "route.command.execution.heading": "执行",
      "route.command.actual.heading": "计划与实际",
      "route.command.driver.heading": "司机模拟器",
      "route.command.alerts.heading": "异常与调整",
      "route.command.recovery.heading": "恢复",
      "route.command.shift.heading": "复盘与交接",
      "route.command.validation.heading": "运营验证",
      "route.platform.data.heading": "数据中心",
      "route.platform.scenarios.heading": "情景库",
      "route.platform.trust.heading": "信任与审计",
      "route.platform.settings.heading": "设置",
      "status.route.active": "P2 工作区导航已激活。",
      "status.domain.pending": "该业务能力仍为受控占位内容，等待所属 Gate 实现。",
      "label.logicalRoute": "逻辑路由",
      "label.currentGate": "当前 Gate 状态",
      "label.futureGate": "后续负责 Gate",
      "label.legacyTarget": "旧版入口映射",
      "label.routeParams": "安全路由参数",
      "label.none": "无",
      "label.notFound": "路由不可用",
      "label.errorCode": "错误代码",
      "label.workspaceMenu": "工作区菜单",
      "label.breadcrumb": "面包屑导航",
      "home.p2": "Platform Gate P2 将实现最终工作区卡片和导航。",
      "error.body": "此页面无法打开。请从工作区菜单选择可用页面，或返回上一页重试。",
    }),
    ja: Object.freeze({
      "route.command.analysis.heading": "輸送分析",
      "route.command.cost.heading": "輸送コスト",
      "route.command.carbon.heading": "排出量推計",
      "route.command.report.heading": "輸送レポート",
      "workspace.design.description": "ネットワーク設計と戦略計画",
      "workspace.command.description": "輸送オペレーションと実行",
      "workspace.platform.description": "共通プラットフォームサービス",
      "route.home.title": "Supply Chain Decision Platform",
      "route.home.heading": "Supply Chain Decision Platform",
      "route.design.root.heading": "DESIGN ワークスペース",
      "route.design.overview.heading": "ネットワークマップ",
      "route.design.facility.heading": "拠点選定",
      "route.design.supply.heading": "サプライチェーン設計",
      "route.design.scenarios.heading": "シナリオ比較",
      "route.design.fleet.heading": "コスト・キャパシティ",
      "route.design.cost.heading": "サービスコスト",
      "route.design.demand.heading": "需要と成長",
      "route.design.resilience.heading": "レジリエンス",
      "route.design.validation.heading": "運用検証",
      "route.command.root.heading": "COMMAND ワークスペース",
      "route.command.overview.heading": "輸送マップ",
      "route.command.dispatch.heading": "オーダー・配車",
      "route.command.mission.heading": "実行・リプレイ",
      "route.command.execution.heading": "実行",
      "route.command.actual.heading": "計画と実績",
      "route.command.driver.heading": "ドライバーシミュレーター",
      "route.command.alerts.heading": "異常・リカバリー",
      "route.command.recovery.heading": "復旧",
      "route.command.shift.heading": "レビュー・引継ぎ",
      "route.command.validation.heading": "運用検証",
      "route.platform.data.heading": "データハブ",
      "route.platform.scenarios.heading": "シナリオライブラリ",
      "route.platform.trust.heading": "信頼と監査",
      "route.platform.settings.heading": "設定",
      "status.route.active": "P2 ワークスペースナビゲーションは有効です。",
      "status.domain.pending": "この業務機能は担当 Gate まで制御されたプレースホルダーです。",
      "label.logicalRoute": "論理ルート",
      "label.currentGate": "現在の Gate 状態",
      "label.futureGate": "将来の担当 Gate",
      "label.legacyTarget": "旧ルートの対応先",
      "label.routeParams": "安全なルートパラメータ",
      "label.none": "なし",
      "label.notFound": "ルートを利用できません",
      "label.errorCode": "エラーコード",
      "label.workspaceMenu": "ワークスペースメニュー",
      "label.breadcrumb": "パンくずリスト",
      "home.p2": "Platform Gate P2 で最終的なワークスペースカードとナビゲーションを実装します。",
      "error.body": "このページを開けませんでした。ワークスペースメニューからページを選ぶか、前のページに戻って再試行してください。",
    }),
  });

  const WORKSPACE_ROOT_VIEWS = Object.freeze({ "/design": "/design/overview", "/command": "/command/overview" });

  function translate(key, locale) {
    const language = COPY[locale] ? locale : "en";
    return COPY[language][key] || COPY.en[key] || key.replace(/\.title$/, ".heading");
  }

  function headingFor(descriptor, locale) {
    return translate(descriptor.headingKey, locale);
  }

  function createViewModel(snapshot, current) {
    const revision = snapshot.revision;
    if (current && current.error) {
      return {
        kind: "ERROR",
        workspace: snapshot.activeWorkspace,
        logicalPath: current.logicalPath || snapshot.activeRoute,
        heading: translate("label.notFound", snapshot.locale),
        title: translate("label.notFound", snapshot.locale),
        errorCode: current.error.code,
        selectors: {
          workspaceSwitcher: { workspace: snapshot.activeWorkspace, revision },
          sidebar: { route: snapshot.activeRoute, revision },
          breadcrumb: { route: snapshot.activeRoute, revision },
          mobileDrawer: { route: snapshot.activeRoute, open: snapshot.mobileDrawerOpen, revision },
        },
      };
    }
    const descriptor = current && current.descriptor;
    const workspace = descriptor ? descriptor.workspace : snapshot.activeWorkspace;
    const logicalPath = current && current.logicalPath ? current.logicalPath : snapshot.activeRoute;
    const heading = descriptor ? headingFor(descriptor, snapshot.locale) : translate("route.home.heading", snapshot.locale);
    return {
      kind: descriptor && descriptor.mountKind === "PLATFORM_HOME_MINIMAL" ? "HOME" : "ROUTE",
      workspace,
      logicalPath,
      heading,
      title: heading,
      futureGate: descriptor ? descriptor.futureGate : "Platform Gate P2",
      legacyTargets: descriptor ? descriptor.legacyTargets.slice() : [],
      routeParams: current && current.routeParams ? Object.assign({}, current.routeParams) : {},
      migration: current && current.migration ? Object.assign({}, current.migration) : null,
      selectors: {
        workspaceSwitcher: { workspace, revision },
        sidebar: { route: logicalPath, revision },
        breadcrumb: { route: logicalPath, revision },
        mobileDrawer: { route: logicalPath, open: snapshot.mobileDrawerOpen, revision },
      },
    };
  }

  function createElement(documentValue, tag, className, text) {
    const element = documentValue.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function addDefinition(documentValue, list, label, value) {
    list.append(createElement(documentValue, "dt", "platform-route-term", label));
    list.append(createElement(documentValue, "dd", "platform-route-value", value));
  }

  function createOutlet(options) {
    const documentValue = options.document;
    const core = options.core || null;
    const recorder = options.recorder || { measure(_name, callback) { return callback(); } };
    const commandAdapter = options.commandAdapter || null;
    const designAdapter = options.designAdapter || null;
    const services = dependencies.Services?.create({designAdapter,commandAdapter,studyContext:options.studyContext});
    let structure = null;
    let current = null;
    let controller = null;
    const controlCleanups = [];

    function ensure() {
      if (structure) return structure;
      const main = documentValue.querySelector("main");
      if (!main) throw new Error("Platform route outlet requires the existing main element");
      const view = createElement(documentValue, "section", "view platform-route-view");
      view.id = "platformRouteView";
      view.setAttribute("aria-label", "Supply Chain Decision Platform");

      const shell = createElement(documentValue, "div", "platform-v19-shell");
      shell.dataset.platformShell = "true";
      const sidebar = createElement(documentValue, "aside", "platform-v19-sidebar");
      sidebar.dataset.platformSidebar = "true";
      const display = createElement(documentValue, "header", "platform-v19-display");
      display.dataset.platformDisplay = "true";
      const switcher = createElement(documentValue, "section", "platform-v19-switcher");
      switcher.dataset.workspaceSwitcher = "true";
      const business = createElement(documentValue, "nav", "platform-v19-business-nav");
      business.dataset.workspaceBusinessNav = "true";
      const shared = createElement(documentValue, "nav", "platform-v19-shared-nav");
      shared.dataset.sharedPlatformNav = "true";
      const footer = createElement(documentValue, "footer", "platform-v19-sidebar-footer");
      footer.dataset.sidebarControls = "true";
      sidebar.append(display, switcher, business, shared, footer);

      const stage = createElement(documentValue, "div", "platform-v19-stage");
      const mobileTopbar = createElement(documentValue, "header", "platform-mobile-topbar");
      mobileTopbar.dataset.platformMobileTopbar = "true";
      const breadcrumb = createElement(documentValue, "nav", "platform-breadcrumb");
      breadcrumb.dataset.platformBreadcrumb = "true";
      breadcrumb.setAttribute("aria-label", "Breadcrumb");
      const outlet = createElement(documentValue, "div", "platform-route-outlet");
      outlet.id = "platformRouteOutlet";
      stage.append(mobileTopbar, breadcrumb, outlet);

      const backdrop = createElement(documentValue, "button", "platform-drawer-backdrop");
      backdrop.type = "button";
      backdrop.hidden = true;
      backdrop.dataset.platformDrawerBackdrop = "true";
      backdrop.setAttribute("aria-label", "Close navigation menu");
      const mobileDrawer = createElement(documentValue, "nav", "platform-mobile-drawer");
      mobileDrawer.hidden = true;
      mobileDrawer.dataset.platformMobileDrawer = "true";
      mobileDrawer.setAttribute("aria-label", "Platform navigation");
      const mobileSwitcher = createElement(documentValue, "section", "platform-mobile-switcher");
      mobileSwitcher.dataset.mobileWorkspaceSwitcher = "true";
      const mobileBusiness = createElement(documentValue, "nav", "platform-mobile-business-nav");
      mobileBusiness.dataset.mobileBusinessNav = "true";
      const mobilePlatform = createElement(documentValue, "nav", "platform-mobile-shared-nav");
      mobilePlatform.dataset.mobilePlatformNav = "true";
      mobileDrawer.append(mobileSwitcher, mobileBusiness, mobilePlatform);
      const live = createElement(documentValue, "p", "platform-sr-only");
      live.dataset.platformLive = "true";
      live.setAttribute("aria-live", "polite");
      live.setAttribute("aria-atomic", "true");
      shell.append(sidebar, stage, backdrop, mobileDrawer, live);
      view.append(shell);
      main.append(view);
      structure = { view, shell, sidebar, display, switcher, business, shared, footer, stage, mobileTopbar, backdrop, mobileDrawer, mobileSwitcher, mobileBusiness, mobilePlatform, live, breadcrumb, outlet };
      return structure;
    }

    function activateView() {
      const elements = ensure();
      if (core && typeof core.switchView === "function") core.switchView("platformRouteView");
      documentValue.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view === elements.view));
      const app = documentValue.querySelector(".app");
      if (app) {
        app.classList.add("no-filter", "platform-shell-active");
        app.dataset.platformWorkspace = current && current.descriptor ? current.descriptor.workspace : "PLATFORM";
      }
    }

    function renderHome(documentFragment, locale) {
      if (dependencies.Home && typeof dependencies.Home.render === "function") {
        const currentStudy=options.studyContext?.snapshot().current;
        const value=currentStudy?.studyKind==='SUPPLY_CHAIN_PERIOD'?designAdapter?.supplySnapshot?.():currentStudy?.studyKind==='FACILITY'?designAdapter?.facilitySnapshot?.():null;
        const saved=value?.savedPointer,dirty=value?.study&&(saved?.inputHash!==value.study.inputHash||saved?.scenario&&JSON.stringify(saved.scenario)!==JSON.stringify(value.scenario));
        const saveLabel=dirty?({zh:'存在未保存改动',en:'Unsaved changes',ja:'未保存の変更'})[locale]:saved?({zh:'已保存到本机',en:'Saved locally',ja:'ローカル保存済み'})[locale]:({zh:'保存状态请在研究页核对',en:'Check save status in the study',ja:'保存状態は研究画面で確認'})[locale];
        dependencies.Home.render({ document: documentValue, target: documentFragment, locale, currentStudy:currentStudy?{...currentStudy,name:value?.study?.name,saveLabel}:null,listStudies:services?()=>services.service.list():null });
        return;
      }
      const intro = createElement(documentValue, "div", "platform-home-intro");
      intro.append(createElement(documentValue, "p", "platform-route-eyebrow", "PLATFORM GATE P1"));
      intro.append(createElement(documentValue, "h1", "platform-route-heading", "Supply Chain Decision Platform"));
      const workspaces = createElement(documentValue, "div", "platform-home-workspaces");
      const design = createElement(documentValue, "section", "platform-home-workspace");
      design.append(createElement(documentValue, "h2", "", "DESIGN"));
      design.append(createElement(documentValue, "p", "", translate("workspace.design.description", locale)));
      const command = createElement(documentValue, "section", "platform-home-workspace");
      command.append(createElement(documentValue, "h2", "", "COMMAND"));
      command.append(createElement(documentValue, "p", "", translate("workspace.command.description", locale)));
      workspaces.append(design, command);
      intro.append(workspaces);
      intro.append(createElement(documentValue, "p", "platform-home-next", translate("home.p2", locale)));
      documentFragment.append(intro);
    }

    function renderRoute(documentFragment, model, snapshot) {
      const content = createElement(documentValue, "article", "platform-route-content");
      content.dataset.logicalRoute = model.logicalPath;
      content.append(createElement(documentValue, "p", "platform-route-eyebrow", model.workspace));
      content.append(createElement(documentValue, "h1", "platform-route-heading", model.heading));
      content.append(createElement(documentValue, "p", "platform-route-lead", translate("status.route.active", snapshot.locale)));
      content.append(createElement(documentValue, "p", "platform-route-boundary", translate("status.domain.pending", snapshot.locale)));
      const details = createElement(documentValue, "dl", "platform-route-details");
      addDefinition(documentValue, details, translate("label.logicalRoute", snapshot.locale), model.logicalPath);
      addDefinition(documentValue, details, translate("label.currentGate", snapshot.locale), "P2 NAVIGATION ACTIVE / DOMAIN NOT MIGRATED");
      addDefinition(documentValue, details, translate("label.futureGate", snapshot.locale), model.futureGate);
      addDefinition(documentValue, details, translate("label.legacyTarget", snapshot.locale), model.legacyTargets.join(", ") || translate("label.none", snapshot.locale));
      const parameters = Object.keys(model.routeParams).length ? JSON.stringify(model.routeParams) : translate("label.none", snapshot.locale);
      addDefinition(documentValue, details, translate("label.routeParams", snapshot.locale), parameters);
      content.append(details);
      if (model.logicalPath === "/platform/settings" && dependencies.NavigationI18n) {
        const translateNavigation = dependencies.NavigationI18n.translate;
        const scopes = createElement(documentValue, "section", "platform-settings-scope-preview");
        scopes.append(createElement(documentValue, "h2", "", translateNavigation("settings.scope.title", snapshot.locale)));
        ["platform", "design", "command"].forEach((scope) => {
          scopes.append(createElement(documentValue, "p", "", translateNavigation(`settings.scope.${scope}`, snapshot.locale)));
        });
        scopes.append(createElement(documentValue, "small", "", translateNavigation("settings.scope.pending", snapshot.locale)));
        content.append(scopes);
      }
      if (model.migration && model.migration.message) content.append(createElement(documentValue, "p", "platform-migration-message", model.migration.message));
      documentFragment.append(content);
    }

    function renderError(documentFragment, model, snapshot) {
      const content = createElement(documentValue, "article", "platform-route-content platform-route-error");
      content.dataset.routeErrorCode = model.errorCode;
      content.append(createElement(documentValue, "p", "platform-route-eyebrow", "PLATFORM"));
      content.append(createElement(documentValue, "h1", "platform-route-heading", model.heading));
      content.append(createElement(documentValue, "p", "platform-route-lead", translate("error.body", snapshot.locale)));
      const details = createElement(documentValue, "dl", "platform-route-details");
      addDefinition(documentValue, details, translate("label.logicalRoute", snapshot.locale), model.logicalPath);
      addDefinition(documentValue, details, translate("label.errorCode", snapshot.locale), model.errorCode);
      content.append(details);
      documentFragment.append(content);
    }

    function syncChrome(snapshot, model) {
      const elements = ensure();
      const app = documentValue.querySelector(".app");
      if (app) app.dataset.platformWorkspace = model.workspace;
      elements.view.dataset.logicalRoute = model.logicalPath;
      elements.view.dataset.platformRevision = String(snapshot.revision);
      elements.breadcrumb.textContent = model.kind === "HOME" ? snapshot.platformDisplayName : `${model.workspace} / ${model.heading}`;
      const brandTitle = documentValue.querySelector(".brand h1");
      const brandSubtitle = documentValue.querySelector(".brand p");
      if (brandTitle) brandTitle.textContent = snapshot.platformDisplayName;
      if (brandSubtitle) {
        const descriptionKey = model.workspace === "DESIGN" ? "workspace.design.description"
          : model.workspace === "COMMAND" ? "workspace.command.description"
          : "workspace.platform.description";
        brandSubtitle.textContent = translate(descriptionKey, snapshot.locale);
      }
      documentValue.title = model.kind === "HOME" ? snapshot.platformDisplayName : `${model.title} | ${snapshot.platformDisplayName}`;

      const routeToLegacy = {
        "/command/overview": "serviceView",
        "/command/dispatch": "mapView",
        "/command/mission-control": "experience-replay",
        "/command/execution": "experience-v17",
        "/command/plan-vs-actual": "analysisView",
        "/command/alerts": "exceptionsView",
        "/command/shift-review": "reportView",
        "/design/cost-to-serve": "costView",
        "/platform/data": "uploadView",
      };
      documentValue.querySelectorAll(".navrail .navbtn").forEach((button) => {
        const key = button.dataset.view || (button.hasAttribute("data-experience-open") ? "experience-replay" : button.hasAttribute("data-v16-open") ? "experience-v16" : button.hasAttribute("data-v17-open") ? "experience-v17" : "");
        button.classList.toggle("active", routeToLegacy[model.logicalPath] === key);
      });
    }

    function render(snapshot) {
      const elements = ensure();
      const model = createViewModel(snapshot, current);
      if(services?.has(model.logicalPath)){services.sync(snapshot);syncChrome(snapshot,model);return model;}
      const adapterPath = WORKSPACE_ROOT_VIEWS[model.logicalPath] || model.logicalPath;
      if (model.workspace === "COMMAND" && commandAdapter && commandAdapter.registry.has(adapterPath)) {
        commandAdapter.sync(snapshot);
        syncChrome(snapshot, model);
        return model;
      }
      if (model.workspace === "DESIGN" && designAdapter && designAdapter.registry.has(adapterPath)) {
        designAdapter.sync(snapshot);
        syncChrome(snapshot, model);
        return model;
      }
      const fragment = documentValue.createDocumentFragment();
      if (model.kind === "HOME") recorder.measure("platform-home-render", () => renderHome(fragment, snapshot.locale));
      else if (model.kind === "ERROR") renderError(fragment, model, snapshot);
      else renderRoute(fragment, model, snapshot);
      elements.outlet.replaceChildren(fragment);
      syncChrome(snapshot, model);
      return model;
    }

    function bind(nextController) {
      controller = nextController;
      ensure();
    }

    return Object.freeze({
      ready: services?.ready || Promise.resolve(),
      bind,
      mount(context, snapshot) {
        return recorder.measure("outlet.mount:"+context.logicalPath,()=>{
        globalThis.STCTPlatformV19?.mapRuntime?.park();
        const parent=ensure().outlet;for(let node=parent;node;node=node.parentElement)node.scrollTop=0;
        current = context;
        activateView();
        if(services?.has(context.logicalPath)){
          const elements=ensure();elements.outlet.replaceChildren();syncChrome(snapshot,createViewModel(snapshot,current));
          return services.mount(context,{target:elements.outlet,controller,snapshot});
        }
        const adapterPath = WORKSPACE_ROOT_VIEWS[context.logicalPath] || context.logicalPath;
        const adapterContext = adapterPath === context.logicalPath ? context : Object.assign({}, context, { logicalPath: adapterPath });
        const commandDescriptor = commandAdapter && commandAdapter.registry.get(adapterPath);
        const designDescriptor = designAdapter && designAdapter.registry.get(adapterPath);
        if (commandDescriptor || designDescriptor) {
          const elements = ensure();
          elements.outlet.replaceChildren();
          const model = createViewModel(snapshot, current);
          syncChrome(snapshot, model);
          const adapter = commandDescriptor ? commandAdapter : designAdapter;
          return adapter.mount(adapterContext, { target: elements.outlet, controller, snapshot });
        }
        render(snapshot);
        return { cleanup: () => {} };
        });
      },
      mountError(context, snapshot) {
        current = { error: context.error, logicalPath: context.logicalPath };
        activateView();
        render(snapshot);
        return { cleanup: () => {} };
      },
      sync(snapshot) {
        if (current) return render(snapshot);
        return null;
      },
      current() {
        return current;
      },
      heading() {
        return current ? createViewModel(controller ? controller.snapshot() : { revision: 0, activeWorkspace: "PLATFORM", activeRoute: "/", locale: "en", mobileDrawerOpen: false }, current).heading : "Supply Chain Decision Platform";
      },
      destroy() {
        commandAdapter?.unmount?.();
        designAdapter?.unmount?.();
        services?.destroy();
        while (controlCleanups.length) controlCleanups.pop()();
      },
    });
  }

  return Object.freeze({ COPY, translate, createViewModel, createOutlet });
});
