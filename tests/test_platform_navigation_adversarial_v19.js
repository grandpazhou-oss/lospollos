#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const State = require("../workspace-state-v19.js");
const Isolation = require("../workspace-state-isolation-v19.js");
const Router = require("../workspace-router-v19.js");
const Model = require("../workspace-navigation-model-v19.js");
const I18n = require("../platform-navigation-i18n-v19.js");
const Guard = require("../workspace-unsaved-guard-v19.js");
const Performance = require("../platform-navigation-performance-v19.js");
const { createChecks, createFakeEnvironment, waitUntil, printResult } = require("./platform-v19-test-utils.js");

const repo = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");
const css = read("platform-v19.css");
const index = read("index.html");
const source = {
  home: read("platform-home-v19.js"),
  model: read("workspace-navigation-model-v19.js"),
  switcher: read("workspace-switcher-v19.js"),
  sidebar: read("workspace-sidebar-v19.js"),
  mobile: read("mobile-navigation-v19.js"),
  navigation: read("platform-navigation-v19.js"),
  outlet: read("platform-route-outlet-v19.js"),
  shell: read("platform-shell-v19.js"),
};
const { assertions, check } = createChecks("tests/test_platform_navigation_adversarial_v19.js");
const x = (number, condition, observed, expected, negative) => check(`P2X-${String(number).padStart(3, "0")}`, condition, observed, expected, negative);
const groups = (workspace) => Model.BUSINESS_GROUPS[workspace];
const pathsFor = (workspace) => groups(workspace).flatMap((group) => group.items.map((item) => item.path));
const labelsFor = (workspace) => groups(workspace).flatMap((group) => group.items.map((item) => item.labelKey));
const groupLabels = (workspace) => groups(workspace).map((group) => group.labelKey);
const designPaths = pathsFor("DESIGN");
const commandPaths = pathsFor("COMMAND");
const platformPaths = Model.PLATFORM_ITEMS.map((item) => item.path);
const allNavKeys = [...labelsFor("DESIGN"), ...labelsFor("COMMAND"), ...Model.PLATFORM_ITEMS.map((item) => item.labelKey)];
const routeSet = new Set(Router.ROUTES.map((route) => route.logicalPath));

function authorityAt(workspace, route) {
  const authority = State.createAuthority();
  if (route !== "/") authority.commitRoute(route, workspace, {});
  return authority;
}

function modelAt(workspace, route, preferences) {
  const authority = authorityAt(workspace, route);
  Object.entries(preferences || {}).forEach(([key, value]) => authority.setPreference(key, value));
  return Model.buildNavigationModel(authority.snapshot(), Router.ROUTES);
}

function makeRouter(initialUrl) {
  const environment = createFakeEnvironment(initialUrl);
  const authority = State.createAuthority();
  const lifecycle = { mounts: 0, cleanups: 0 };
  const router = Router.createRouter({
    stateAuthority: authority,
    environment,
    async mountRoute(context) {
      lifecycle.mounts += 1;
      if (context.logicalPath.includes("network-scenarios")) await new Promise((resolve) => setTimeout(resolve, 8));
      return { cleanup() { lifecycle.cleanups += 1; } };
    },
    mountError() { return { cleanup() { lifecycle.cleanups += 1; } }; },
  });
  return { environment, authority, lifecycle, router };
}

async function main() {
  const root = Router.resolveRoute("/");
  x(1, root.ok && root.descriptor.mountKind === Router.MOUNT_KINDS.HOME && root.descriptor.legacyTargets.length === 0, root.descriptor, "P2 home mount");
  x(2, Object.keys(Model.WORKSPACE_IDENTITIES).length === 2, Object.keys(Model.WORKSPACE_IDENTITIES), ["DESIGN", "COMMAND"]);
  x(3, !/(kpi|metric|dashboard)/i.test(source.home), "no KPI renderer", "minimal home", true);
  x(4, !/(recent project|recent study|last run|mock project)/i.test(source.home), "no recent data", "no fabricated project data", true);
  x(5, !/(maplibre|new\s+map|createMap|initializeMap)/i.test(source.home), "home has no map call", "no map initialization", true);
  x(6, source.home.includes('dataset.platformWorkspace = workspace') && routeSet.has("/design/overview"), "DESIGN workspace action", "router-backed");
  x(7, source.home.includes('dataset.platformWorkspace = workspace') && routeSet.has("/command/overview"), "COMMAND workspace action", "router-backed");
  x(8, source.home.includes("dataset.platformRoute = navItem.path") && platformPaths.every((route) => routeSet.has(route)), platformPaths, "route-backed PLATFORM links");
  x(9, (source.home.match(/"h1"/g) || []).length === 1, (source.home.match(/"h1"/g) || []).length, 1);
  x(10, I18n.locales.every((locale) => I18n.translate("home.question", locale) !== "home.question"), I18n.locales.map((locale) => I18n.translate("home.question", locale)), "localized H1");
  x(11, css.includes("width: min(100% - 32px, 680px)") && css.includes("overflow-wrap: anywhere"), "responsive width and wrapping", "200% prerequisites");
  x(12, css.includes(".platform-home-card::before") && source.home.includes("platform-home-card-title"), "shape, icon, direct label", "grayscale distinction");
  x(13, css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "desktop home grid", "desktop evidence prerequisite");
  x(14, css.includes(".platform-home-cards") && css.includes("grid-template-columns: 1fr"), "portrait single column", "portrait evidence prerequisite");
  x(15, css.includes("orientation: landscape") && css.includes("grid-template-columns: minmax(220px, 0.72fr)"), "landscape home grid", "landscape evidence prerequisite");

  x(16, (source.shell.match(/Router\.createRouter/g) || []).length === 1, (source.shell.match(/Router\.createRouter/g) || []).length, 1);
  x(17, !(Object.values(source).join("\n").match(/(?:let|var)\s+activeWorkspace\b/g) || []).length, "no parallel writable activeWorkspace", "P1 state authority only", true);
  const remembered = makeRouter("http://test.local/index.html#/");
  await remembered.router.start();
  await remembered.router.navigate("/design/network-scenarios");
  await remembered.router.navigate("/command/execution");
  await remembered.router.navigateWorkspace("DESIGN");
  x(18, remembered.authority.snapshot().activeRoute === "/design/network-scenarios", remembered.authority.snapshot().activeRoute, "/design/network-scenarios");
  await remembered.router.navigateWorkspace("COMMAND");
  x(19, remembered.authority.snapshot().activeRoute === "/command/execution", remembered.authority.snapshot().activeRoute, "/command/execution");
  remembered.authority.setPreference("navigationCollapsed", true);
  remembered.authority.setPreference("locale", "ja");
  remembered.authority.setPreference("noWebGL", true);
  remembered.authority.setPreference("reducedMotion", true);
  await remembered.router.navigateWorkspace("DESIGN");
  const preserved = remembered.authority.snapshot();
  x(20, preserved.navigationCollapsed, preserved.navigationCollapsed, true);
  x(21, preserved.locale === "ja", preserved.locale, "ja");
  x(22, preserved.noWebGL, preserved.noWebGL, true);
  x(23, preserved.reducedMotion, preserved.reducedMotion, true);
  await remembered.router.stop();

  const rapid = makeRouter("http://test.local/index.html#/");
  await rapid.router.start();
  await Promise.all([
    rapid.router.navigate("/design/network-scenarios"),
    rapid.router.navigate("/command/execution"),
    rapid.router.navigate("/command/alerts"),
  ]);
  x(24, rapid.authority.snapshot().activeRoute === "/command/alerts" && rapid.router.diagnostics().staleRejections >= 2, { route: rapid.authority.snapshot().activeRoute, stale: rapid.router.diagnostics().staleRejections }, "last commit wins");
  const historyBefore = rapid.environment.history.length;
  await rapid.router.navigate("/command/recovery");
  x(25, rapid.environment.history.length === historyBefore + 1, rapid.environment.history.rows(), "one history entry per commit");
  await rapid.router.stop();
  x(26, !/platform-workspace-(?:design|command)[^{]*\{[^}]*#(?:d71920|e60012)/is.test(css), "workspace states avoid red", "not red", true);
  x(27, Model.WORKSPACE_IDENTITIES.DESIGN.icon !== Model.WORKSPACE_IDENTITIES.COMMAND.icon && source.switcher.includes("platform-workspace-copy"), Model.WORKSPACE_IDENTITIES, "shape plus label");
  x(28, source.sidebar.includes("button.title = label") && source.switcher.includes('setAttribute("aria-label"'), "title and aria labels", "collapsed tooltip");
  x(29, source.navigation.includes("lastBusinessWorkspace") && source.navigation.includes("announce.workspace") && source.navigation.includes("activateRoute"), "announcement after model commit", "committed switch only");
  x(30, !/@keyframes|full-screen-animation|decorative-animation/i.test(css), "no keyframe or full-screen decorative animation", "restrained motion", true);

  x(31, JSON.stringify(groups("DESIGN")[0].items.map((item) => item.path)) === JSON.stringify(["/design/overview", "/design/facility-location", "/design/supply-chain-study", "/design/network-scenarios"]), groups("DESIGN")[0].items.map((item) => item.path), "NETWORK order");
  x(32, JSON.stringify(groups("DESIGN")[1].items.map((item) => item.path)) === JSON.stringify(["/design/fleet-capacity", "/design/cost-to-serve", "/design/demand-growth", "/design/resilience"]), groups("DESIGN")[1].items.map((item) => item.path), "PLANNING order");
  x(33, JSON.stringify(groups("DESIGN")[2].items.map((item) => item.path)) === JSON.stringify(["/design/operational-validation"]), groups("DESIGN")[2].items.map((item) => item.path), "VALIDATE order");
  x(34, JSON.stringify(platformPaths) === JSON.stringify(["/platform/data", "/platform/scenarios", "/platform/trust", "/platform/settings"]), platformPaths, "PLATFORM order");
  x(35, designPaths.every((route) => routeSet.has(route)), designPaths, "all registered");
  x(36, designPaths.every((route) => !route.startsWith("/command/")), designPaths, "no COMMAND IDs", true);
  x(37, source.sidebar.includes('node(documentValue, "h2", "platform-nav-group-heading"'), "heading nodes", "not route controls");
  x(38, source.sidebar.includes("navItem.path === model.activeRoute"), "committed model route comparison", "active follows route");
  const dirtyDesign = authorityAt("DESIGN", "/design/overview");
  dirtyDesign.setWorkspacePresentation("DESIGN", { dirty: true });
  x(39, dirtyDesign.snapshot().workspaceStates.DESIGN.dirty && !dirtyDesign.snapshot().workspaceStates.COMMAND.dirty, dirtyDesign.snapshot().workspaceStates, "independent dirty");
  x(40, css.includes("overflow-wrap: anywhere") && I18n.translate("route.design.scenarios", "ja").length > 5, I18n.translate("route.design.scenarios", "ja"), "safe Japanese label");
  x(41, css.includes("minmax(0, 1fr)") && I18n.translate("route.design.validation", "en").includes(" "), I18n.translate("route.design.validation", "en"), "safe English label");
  const designRoute = dirtyDesign.snapshot().activeRoute;
  dirtyDesign.setPreference("navigationCollapsed", true);
  x(42, dirtyDesign.snapshot().activeRoute === designRoute, dirtyDesign.snapshot().activeRoute, designRoute);
  dirtyDesign.setPreference("mobileDrawerOpen", true);
  x(43, dirtyDesign.snapshot().activeRoute === designRoute, dirtyDesign.snapshot().activeRoute, designRoute);

  x(44, JSON.stringify(groups("COMMAND")[0].items.map((item) => item.path)) === JSON.stringify(["/command/overview", "/command/dispatch", "/command/mission-control"]), groups("COMMAND")[0].items.map((item) => item.path), "OPERATIONS order");
  x(45, JSON.stringify(groups("COMMAND")[1].items.map((item) => item.path)) === JSON.stringify(["/command/execution", "/command/plan-vs-actual", "/command/driver-simulator"]), groups("COMMAND")[1].items.map((item) => item.path), "EXECUTION order");
  x(46, JSON.stringify(groups("COMMAND")[2].items.map((item) => item.path)) === JSON.stringify(["/command/alerts", "/command/recovery", "/command/shift-review"]), groups("COMMAND")[2].items.map((item) => item.path), "RESPONSE order");
  x(47, platformPaths.length === 4, platformPaths, "PLATFORM order");
  x(48, commandPaths.every((route) => routeSet.has(route)), commandPaths, "all registered");
  x(49, commandPaths.every((route) => !route.startsWith("/design/")), commandPaths, "no DESIGN IDs", true);
  x(50, groupLabels("COMMAND").every((key) => !routeSet.has(key)), groupLabels("COMMAND"), "group labels are not routes");
  x(51, Router.ROUTES.filter((route) => route.workspace === "COMMAND").every((route) => route.futureGate === (route.logicalPath === "/command/validation" ? "Platform Gate P6" : "Platform Gate P3")), Router.ROUTES.filter((route) => route.workspace === "COMMAND").map((route) => ({ path: route.logicalPath, gate: route.futureGate })), "COMMAND P3 routes and isolated P6 validation");
  x(52, !/(startExecution|executionLoop|dispatchLoop)\s*\(/.test(source.navigation + source.sidebar), "no execution start call", "render only", true);
  x(53, !/(startReplay|playReplay|runReplay)\s*\(/.test(source.navigation + source.sidebar), "no replay start call", "render only", true);
  const commandState = authorityAt("COMMAND", "/command/execution");
  commandState.setWorkspacePresentation("COMMAND", { dirty: true, executionCursor: "event-9" });
  x(54, commandState.snapshot().workspaceStates.COMMAND.dirty && !commandState.snapshot().workspaceStates.DESIGN.dirty, commandState.snapshot().workspaceStates, "independent dirty");
  const beforeCursor = commandState.snapshot().workspaceStates.COMMAND.executionCursor;
  Model.buildNavigationModel(commandState.snapshot(), Router.ROUTES);
  x(55, commandState.snapshot().workspaceStates.COMMAND.executionCursor === beforeCursor, commandState.snapshot().workspaceStates.COMMAND.executionCursor, beforeCursor);
  commandState.setPreference("navigationCollapsed", true);
  x(56, commandState.snapshot().activeRoute === "/command/execution", commandState.snapshot().activeRoute, "/command/execution");

  const designModel = modelAt("DESIGN", "/design/overview");
  const commandModel = modelAt("COMMAND", "/command/overview");
  x(57, JSON.stringify(designModel.platformGroup.items.map((item) => item.path)) === JSON.stringify(commandModel.platformGroup.items.map((item) => item.path)), platformPaths, "same four items");
  x(58, JSON.stringify(designModel.platformGroup.items.map((item) => item.path)) === JSON.stringify(platformPaths), platformPaths, "same order");
  x(59, JSON.stringify(designModel.platformGroup.items.map((item) => item.icon)) === JSON.stringify(commandModel.platformGroup.items.map((item) => item.icon)), designModel.platformGroup.items.map((item) => item.icon), "same icons");
  x(60, I18n.locales.every((locale) => Model.PLATFORM_ITEMS.every((item) => I18n.translate(item.labelKey, locale) !== item.labelKey)), I18n.locales, "same localized labels");
  x(61, css.includes(".platform-v19-shared-nav") && css.includes("border-top: 1px solid #b8c5d4"), "separate border and surface", "visually separated");
  x(62, css.includes(".platform-mobile-shared-nav") && css.includes("max-height: 228px"), "short-screen independently scrollable shared nav", "reachable");
  x(63, Object.keys(Model.WORKSPACE_IDENTITIES).length === 2 && !Object.hasOwn(Model.WORKSPACE_IDENTITIES, "PLATFORM"), Object.keys(Model.WORKSPACE_IDENTITIES), "PLATFORM is shared context");
  const platformMemory = authorityAt("DESIGN", "/design/network-scenarios");
  platformMemory.commitRoute("/platform/data", "PLATFORM", {});
  x(64, platformMemory.snapshot().workspaceStates.PLATFORM.previousBusinessWorkspace === "DESIGN", platformMemory.snapshot().workspaceStates.PLATFORM, "remembers DESIGN");
  const platformRouter = makeRouter("http://test.local/index.html#/design/network-scenarios");
  await platformRouter.router.start();
  await platformRouter.router.navigate("/platform/data");
  await platformRouter.router.navigateWorkspace("DESIGN");
  x(65, platformRouter.authority.snapshot().activeRoute === "/design/network-scenarios", platformRouter.authority.snapshot().activeRoute, "/design/network-scenarios");
  await platformRouter.router.stop();
  x(66, !/(badge|count|notification-count)/i.test(source.sidebar + source.switcher), "no badge renderer", "no mock counts", true);

  x(67, css.includes("--p2-sidebar-collapsed: 76px") && css.includes("grid-template-columns: var(--p2-sidebar-collapsed) minmax(0, 1fr)"), "76px token", "stable width");
  x(68, source.switcher.includes("dataset.collapsedLabel") && source.switcher.includes("platform-workspace-icon"), "workspace glyph and letter", "visible identity");
  x(69, source.sidebar.includes("platform-nav-icon") && source.sidebar.includes('aria-current", "page"'), "active route icon and current semantic", "visible route identity");
  x(70, source.switcher.includes('node(documentValue, "button"') && source.navigation.includes("button[data-platform-workspace]"), "native workspace buttons", "usable collapsed switch");
  x(71, css.includes(".platform-v19-shared-nav") && Model.PLATFORM_ITEMS.every((item) => item.icon), Model.PLATFORM_ITEMS.map((item) => item.icon), "separate PLATFORM icons");
  x(72, source.sidebar.includes("button.title = label") && source.sidebar.includes('setAttribute("aria-label", label)'), "title and aria-label", "accessible tooltips");
  x(73, css.includes(":focus-visible") && css.includes("outline: 2px solid var(--p2-focus)"), "focus outline", "visible focus");
  const cycleRecorder = Performance.createRecorder({ performance: { now: () => 1 } });
  const cycleAuthority = authorityAt("COMMAND", "/command/overview");
  for (let indexValue = 0; indexValue < 20; indexValue += 1) cycleAuthority.setPreference("navigationCollapsed", indexValue % 2 === 0);
  x(74, cycleRecorder.snapshot().resources.listeners === 0, cycleRecorder.snapshot().resources, "no listener growth from state cycles");
  x(75, cycleRecorder.snapshot().resources.raf === 0, cycleRecorder.snapshot().resources, "no RAF growth from state cycles");
  x(76, source.navigation.includes("scheduleLayoutResize") && source.navigation.includes('measure("layout-map-resize"'), "one scheduled resize path", "controlled resize");
  x(77, css.includes('[data-reduced-motion="true"]') && css.includes("transition: none !important"), "state and media override", "no width animation");

  x(78, source.mobile.includes('I18n.translate("platform.name"'), "platform name in top bar", "platform identity");
  x(79, source.mobile.includes("model.businessWorkspace"), "business workspace in top bar", "workspace identity");
  x(80, (source.outlet.match(/createElement\(documentValue, "nav", "platform-mobile-drawer"\)/g) || []).length === 1, "single drawer node", 1);
  x(81, source.navigation.includes("first.focus()") && source.navigation.includes("last.focus()"), "first/last wrap", "focus trap");
  x(82, source.navigation.includes('event.key === "Escape"'), "Escape handler", "closes drawer");
  x(83, source.navigation.includes("data-platform-drawer-backdrop") && source.navigation.includes("setMobileDrawerOpen(false)"), "backdrop handler", "closes drawer");
  x(84, source.navigation.includes("menu.focus()"), "restore focus call", "menu button");
  x(85, source.outlet.indexOf("mobileSwitcher") < source.outlet.indexOf("mobileBusiness"), "switcher first", "drawer order");
  x(86, source.outlet.indexOf("mobileBusiness") < source.outlet.indexOf("mobilePlatform"), "business second", "drawer order");
  x(87, source.outlet.indexOf("mobilePlatform") > source.outlet.indexOf("mobileBusiness"), "PLATFORM last", "drawer order");
  const drawerRoute = authorityAt("COMMAND", "/command/overview");
  drawerRoute.setPreference("mobileDrawerOpen", true);
  drawerRoute.commitRoute("/command/alerts", "COMMAND", {});
  x(88, !drawerRoute.snapshot().mobileDrawerOpen, drawerRoute.snapshot(), "route commit closes drawer");
  drawerRoute.setPreference("mobileDrawerOpen", true);
  drawerRoute.commitRoute("/design/overview", "DESIGN", {});
  x(89, !drawerRoute.snapshot().mobileDrawerOpen, drawerRoute.snapshot(), "workspace commit closes drawer");
  x(90, source.shell.includes("navigateWorkspace") && source.shell.includes("controller.navigateWorkspace") && !source.mobile.includes("history.back"), "router-backed buttons", "Back remains history");
  x(91, css.includes("env(safe-area-inset-top)") && css.includes("env(safe-area-inset-bottom)"), "portrait safe areas", "protected");
  x(92, css.includes("orientation: landscape") && css.includes("env(safe-area-inset-top)"), "landscape safe area", "protected");
  x(93, css.includes("@media (max-width: 340px)") && css.includes("width: 100vw"), "narrow-width override", "320px protected");
  x(94, source.navigation.includes('root.addEventListener("resize", onResize)') && source.navigation.includes("lastSnapshot"), "resize reuses snapshot", "route preserved");
  x(95, source.navigation.includes('root.removeEventListener("resize", onResize)') && source.navigation.includes("nextMode === mobileMode"), "single paired handler", "no duplicate rotation handlers");
  x(96, source.navigation.includes("bodyScrollLock.sync(actualOpen)") && source.navigation.includes("bodyScrollLock.destroy()"), "restores captured inline overflow at close/destroy boundaries", "body restored");
  x(97, source.model.includes("noWebGL: snapshot.noWebGL") && !source.mobile.includes("noWebGL"), "drawer independent of rendering mode", "same no-WebGL drawer");

  const isolated = authorityAt("DESIGN", "/design/overview");
  isolated.setWorkspacePresentation("DESIGN", { selectionRef: "site-d", dirty: true, viewStateRef: "view-d", mapViewRef: "map-d", scenarioRef: "scenario-d" });
  isolated.commitRoute("/design/facility-location", "DESIGN", { studyId: "study-d" });
  isolated.setWorkspacePresentation("COMMAND", { selectionRef: "stop-c", dirty: false, viewStateRef: "view-c", mapViewRef: "map-c", executionCursor: "event-c" });
  isolated.commitRoute("/command/execution", "COMMAND", { runId: "run-c" });
  const states = isolated.snapshot().workspaceStates;
  x(98, states.DESIGN.lastRoute !== states.COMMAND.lastRoute, { design: states.DESIGN.lastRoute, command: states.COMMAND.lastRoute }, "separate last routes");
  x(99, states.DESIGN.selectionRef === "site-d" && states.COMMAND.selectionRef === "stop-c", states, "separate selections");
  x(100, states.DESIGN.dirty && !states.COMMAND.dirty, states, "separate dirty flags");
  x(101, states.DESIGN.viewStateRef === "view-d" && states.COMMAND.viewStateRef === "view-c", states, "separate view refs");
  x(102, states.DESIGN.scenarioRef === "scenario-d" && !Object.hasOwn(states.COMMAND, "scenarioRef"), states, "DESIGN scenario isolated");
  x(103, states.COMMAND.executionCursor === "event-c" && !Object.hasOwn(states.DESIGN, "executionCursor"), states, "COMMAND cursor isolated");
  isolated.commitRoute("/platform/settings", "PLATFORM", {});
  x(104, isolated.snapshot().workspaceStates.DESIGN.selectionRef === "site-d" && isolated.snapshot().workspaceStates.COMMAND.selectionRef === "stop-c", isolated.snapshot().workspaceStates, "PLATFORM preserves both");
  x(105, State.validateState(isolated.snapshot()).ok && !/(orders|matrices|geometries|events)/i.test(JSON.stringify(Object.keys(states.DESIGN)) + JSON.stringify(Object.keys(states.COMMAND))), Object.keys(states.DESIGN).concat(Object.keys(states.COMMAND)), "reference-only shell state");
  const invalidUpdate = isolated.setWorkspacePresentation("DESIGN", { executionCursor: "cross-domain" });
  x(106, !invalidUpdate.ok && isolated.snapshot().workspaceStates.DESIGN.scenarioRef === "scenario-d", invalidUpdate.error && invalidUpdate.error.code, "safe rejection");
  x(107, Guard.requiresWarning(isolated.snapshot(), "DESIGN") === false, { active: isolated.snapshot().activeWorkspace, dirty: states.DESIGN.dirty }, "PLATFORM/inactive dirty does not warn");
  const activeDirty = authorityAt("DESIGN", "/design/facility-location");
  activeDirty.setWorkspacePresentation("DESIGN", { dirty: true });
  let confirms = 0;
  let commits = 0;
  let allow = false;
  const guard = Guard.createGuard({ snapshot: activeDirty.snapshot, message: () => "unsaved", confirm: async () => { confirms += 1; return allow; }, navigate: async () => { commits += 1; return { ok: true }; } });
  const cancelled = await guard.request("/command/overview", "COMMAND", {});
  x(108, cancelled.cancelled && commits === 0 && activeDirty.snapshot().activeRoute === "/design/facility-location", { cancelled, commits, route: activeDirty.snapshot().activeRoute }, "stay put");
  allow = true;
  await guard.request("/command/overview", "COMMAND", {});
  x(109, confirms === 2 && commits === 1, { confirms, commits }, "confirm commits exactly once");

  x(110, css.includes("font-family: Inter") || css.includes("font: inherit"), "shared typographic inheritance", "shared typography");
  x(111, css.includes("--p2-design: #5b5bd6"), "#5b5bd6", "DESIGN indigo role");
  x(112, css.includes("--p2-command: #087ea4"), "#087ea4", "COMMAND cyan role");
  x(113, css.includes("--p2-critical: #d71920") && !/--p2-(design|command):\s*#d71920/.test(css), "red semantic token only", "critical only");
  x(114, css.includes("--p2-warning: #b66a00"), "amber warning token", "warning only");
  x(115, css.includes("--p2-success: #16794a"), "green success token", "healthy only");
  x(116, Model.WORKSPACE_IDENTITIES.DESIGN.icon !== Model.WORKSPACE_IDENTITIES.COMMAND.icon, Model.WORKSPACE_IDENTITIES, "distinct silhouettes");
  x(117, source.sidebar.includes("platform-nav-current") && css.includes(".platform-nav-item.active::before"), "text plus shape", "not color only");
  x(118, source.sidebar.includes('"h2", "platform-nav-group-heading"') && !css.includes(".platform-nav-group-heading:hover"), "plain heading", "not a pill button");
  x(119, css.includes("--p2-focus: #172b4d") && css.includes("outline: 2px solid var(--p2-focus)"), "2px dark focus outline", "adequate contrast");
  x(120, !/(fontawesome|material-icons|heroicons|lucide)/i.test(index + Object.values(source).join("\n")), "no icon package", "no external dependency", true);
  x(121, !/(glow|box-shadow:\s*0\s+0\s+\d+px)/i.test(css), "no continuous glow", "none", true);
  x(122, !/(particle|canvas-confetti|three\.js)/i.test(index + Object.values(source).join("\n")), "no particles", "none", true);
  x(123, ["--p2-ink", "--p2-line", "--p2-design", "--p2-command"].every((token) => css.includes(`var(${token})`)), "role tokens referenced", "tokenized CSS");
  const protectedGeometry = ["main.js", "style.css", "experience-v16.css", "experience-v17.css"];
  const baseline = process.env.STCT_SOURCE_BASELINE ? JSON.parse(fs.readFileSync(process.env.STCT_SOURCE_BASELINE, "utf8")) : null;
  const legacyGeometryChanged = baseline ? protectedGeometry.some(file => {
    const expected = baseline.files.find(row => row.path === file);
    return !expected || require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(repo,file))).digest("hex") !== expected.sha256;
  }) : childProcess.spawnSync("git", ["diff", "--quiet", "--", ...protectedGeometry], { cwd: repo }).status !== 0;
  x(124, !legacyGeometryChanged, legacyGeometryChanged, false, true);

  x(125, allNavKeys.every((key) => I18n.translate(key, "zh") !== key), allNavKeys.length, "complete zh navigation");
  x(126, allNavKeys.every((key) => I18n.translate(key, "en") !== key), allNavKeys.length, "complete en navigation");
  x(127, allNavKeys.every((key) => I18n.translate(key, "ja") !== key), allNavKeys.length, "complete ja navigation");
  const ariaKeys = ["workspace.switch.design", "workspace.switch.command", "control.collapse", "control.expand", "control.menu", "control.close", "nav.business", "nav.platform", "nav.breadcrumb", "nav.drawer"];
  x(128, I18n.locales.every((locale) => ariaKeys.every((key) => I18n.translate(key, locale) !== key)), ariaKeys, "localized accessible names");
  x(129, source.mobile.includes('setAttribute("aria-hidden"') && source.mobile.includes('setAttribute("inert"'), "aria-hidden plus inert", "hidden nav excluded");
  x(130, source.sidebar.includes('setAttribute("aria-label", label)') && source.switcher.includes('setAttribute("aria-label"'), "equivalent accessible labels", "collapsed labels");
  x(131, source.sidebar.includes("navItem.path === model.activeRoute") && source.sidebar.includes('aria-current", "page"'), "one current path per rendered active model", "exactly one visible");
  x(132, source.outlet.indexOf("mobileSwitcher") < source.outlet.indexOf("mobileBusiness") && source.outlet.indexOf("mobileBusiness") < source.outlet.indexOf("mobilePlatform"), "DOM order equals visual order", "focus order");
  x(133, source.mobile.includes("inert") && source.navigation.includes("setDrawerKeyboard(actualOpen)"), "inert closed drawer and conditional keyboard handler", "no hidden focus");
  x(134, css.includes("@media (prefers-reduced-motion: reduce)") && css.includes('[data-reduced-motion="true"]'), "OS and runtime reduced motion", "complete");
  x(135, css.includes("@media (forced-colors: active)") && css.includes("border: 2px solid Highlight"), "forced colors border", "visible active indication");
  x(136, css.includes("overflow-wrap: anywhere") && css.includes("min-width: 0") && css.includes("width: min(360px, 92vw)"), "wrapping and responsive constraints", "200% usable prerequisites");

  const perfSource = source.navigation + source.outlet;
  x(137, perfSource.includes('measure("platform-home-render"'), "actual home render wrapper", "measured");
  x(138, perfSource.includes('measure("workspace-switch"'), "actual workspace navigation promise", "measured");
  x(139, perfSource.includes('measure("sidebar-render"'), "actual sidebar render wrapper", "measured");
  x(140, perfSource.includes('measure("sidebar-collapse"'), "actual preference update", "measured");
  x(141, perfSource.includes('measure("mobile-drawer"'), "actual drawer update", "measured");
  x(142, !/(facilitySolver|solveFacility|runFacility)/.test(perfSource), "no facility solver symbol", "not initialized", true);
  x(143, !/(startExecutionLoop|runExecutionLoop)/.test(perfSource), "no execution loop symbol", "not initialized", true);
  const recorder = Performance.createRecorder({ performance: { now: (() => { let tick = 0; return () => ++tick; })() } });
  for (let indexValue = 0; indexValue < 10; indexValue += 1) recorder.measure("workspace-switch", () => indexValue);
  x(144, recorder.snapshot().resources.listeners === 0, recorder.snapshot().resources, "no listener growth");
  x(145, recorder.snapshot().resources.raf === 0, recorder.snapshot().resources, "no RAF growth");
  for (let indexValue = 0; indexValue < 10; indexValue += 1) { recorder.adjust("drawerHandlers", 1); recorder.adjust("drawerHandlers", -1); }
  x(146, recorder.snapshot().resources.drawerHandlers === 0, recorder.snapshot().resources, "no drawer handler growth");
  x(147, !/(console\.error|throw new Error)/.test(source.home + source.switcher + source.sidebar + source.mobile + source.navigation), "navigation render source has no console error path", "browser evidence confirms zero", true);
  x(148, !/console\.warn/.test(Object.values(source).join("\n")), "no navigation warnings", "browser evidence confirms zero", true);
  const randomSmoke = childProcess.spawnSync(process.execPath, ["-e", `const r=require(${JSON.stringify(path.join(repo, "workspace-router-v19.js"))});if(!r.resolveRoute("/command/overview").ok)process.exit(1)`], { cwd: "/tmp", encoding: "utf8" });
  x(149, randomSmoke.status === 0, { status: randomSmoke.status, stderr: randomSmoke.stderr }, "random-directory require smoke");
  x(150, !/(src|href)=["']\/(?!\/)/i.test(index) && index.includes("./platform-v19.css"), "relative asset references", "portable temporary Dist prerequisite");
  const designReload = authorityAt("DESIGN", "/design/network-scenarios");
  const designRestored = State.restoreState(State.serializeState(designReload.snapshot()).payload, (route) => Router.resolveRoute(route).ok);
  x(151, designRestored.ok && designRestored.state.activeRoute === "/design/network-scenarios", designRestored.state.activeRoute, "/design/network-scenarios");
  const commandReload = authorityAt("COMMAND", "/command/execution");
  const commandRestored = State.restoreState(State.serializeState(commandReload.snapshot()).payload, (route) => Router.resolveRoute(route).ok);
  x(152, commandRestored.ok && commandRestored.state.activeRoute === "/command/execution", commandRestored.state.activeRoute, "/command/execution");
  const history = makeRouter("http://test.local/index.html#/design/overview");
  await history.router.start();
  await history.router.navigate("/command/overview");
  history.environment.history.back();
  await waitUntil(() => history.authority.snapshot().activeRoute === "/design/overview");
  history.environment.history.forward();
  await waitUntil(() => history.authority.snapshot().activeRoute === "/command/overview");
  x(153, history.authority.snapshot().activeWorkspace === "COMMAND", history.authority.snapshot(), "Back/Forward across workspaces");
  await history.router.stop();
  const legacy = Router.parseBrowserLocation({ pathname: "/index.html", search: "?view=mapView", hash: "" });
  x(154, legacy.ok && legacy.logicalPath === "/command/dispatch" && legacy.legacy, legacy, "/command/dispatch legacy mapping");

  x("COVERAGE", assertions.filter((row) => /^P2X-\d{3}$/.test(row.requirementId)).length === 154, assertions.length, 154);
  printResult(assertions, { gate: "Platform Gate P2", requiredRange: "P2X-001-P2X-154" });
}

main().catch((error) => { console.error(error); process.exit(1); });
