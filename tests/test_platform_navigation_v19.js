#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const State = require("../workspace-state-v19.js");
const Isolation = require("../workspace-state-isolation-v19.js");
const Router = require("../workspace-router-v19.js");
const Model = require("../workspace-navigation-model-v19.js");
const I18n = require("../platform-navigation-i18n-v19.js");
const Guard = require("../workspace-unsaved-guard-v19.js");
const { createChecks, createFakeEnvironment, waitUntil, printResult } = require("./platform-v19-test-utils.js");

const repo = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(repo, "platform-v19.css"), "utf8");
const sources = Object.fromEntries([
  "home", "switcher", "sidebar", "navigation", "mobile", "outlet",
].map((name) => [name, fs.readFileSync(path.join(repo, ({
  home: "platform-home-v19.js",
  switcher: "workspace-switcher-v19.js",
  sidebar: "workspace-sidebar-v19.js",
  navigation: "platform-navigation-v19.js",
  mobile: "mobile-navigation-v19.js",
  outlet: "platform-route-outlet-v19.js",
})[name]), "utf8")]));
const { assertions, check } = createChecks("tests/test_platform_navigation_v19.js");

function snapshotAt(workspace, route, changes) {
  const authority = State.createAuthority();
  if (workspace !== "PLATFORM" || route !== "/") authority.commitRoute(route, workspace, {});
  Object.entries(changes || {}).forEach(([key, value]) => authority.setPreference(key, value));
  return authority.snapshot();
}

function modelAt(workspace, route, changes) {
  return Model.buildNavigationModel(snapshotAt(workspace, route, changes), Router.ROUTES);
}

function groupKeys(model) {
  return model.businessGroups.map((group) => group.labelKey);
}

function itemPaths(model) {
  return model.businessGroups.flatMap((group) => group.items.map((item) => item.path));
}

async function main() {
  const design = modelAt("DESIGN", "/design/overview");
  const command = modelAt("COMMAND", "/command/overview");
  const identityKeys = Object.keys(Model.WORKSPACE_IDENTITIES);
  const designPaths = itemPaths(design);
  const commandPaths = itemPaths(command);
  const platformPaths = Model.PLATFORM_ITEMS.map((item) => item.path);
  const routePaths = new Set(Router.ROUTES.map((route) => route.logicalPath));

  check("T0107", identityKeys.length === 2 && sources.home.includes('workspaceCard(documentValue, locale, "DESIGN"), workspaceCard(documentValue, locale, "COMMAND")'), identityKeys, ["DESIGN", "COMMAND"]);
  check("T0108", Model.WORKSPACE_IDENTITIES.DESIGN.key === "DESIGN", Model.WORKSPACE_IDENTITIES.DESIGN, "direct DESIGN label");
  check("T0109", Model.WORKSPACE_IDENTITIES.COMMAND.key === "COMMAND", Model.WORKSPACE_IDENTITIES.COMMAND, "direct COMMAND label");
  check("T0110", I18n.locales.every((locale) => I18n.translate("workspace.design.subtitle", locale) !== "workspace.design.subtitle"), I18n.locales.map((locale) => I18n.translate("workspace.design.subtitle", locale)), "localized visible subtitle");
  check("T0111", I18n.locales.every((locale) => I18n.translate("workspace.command.subtitle", locale) !== "workspace.command.subtitle"), I18n.locales.map((locale) => I18n.translate("workspace.command.subtitle", locale)), "localized visible subtitle");
  check("T0112", sources.switcher.includes("platform-workspace-copy") && css.includes("min-height: 54px"), "copy plus stable height", "substantial switcher");
  check("T0113", sources.switcher.includes('node(documentValue, "button"'), sources.switcher.match(/node\(documentValue, "button"/g)?.length, "native keyboard button");
  check("T0114", sources.switcher.includes('setAttribute("aria-label"'), "localized aria-label", "accessible names");
  check("T0115", sources.switcher.includes('setAttribute("aria-pressed"') && sources.switcher.includes("workspace.current"), "pressed plus current copy", "direct active state");
  check("T0116", css.includes(".platform-workspace-option[aria-pressed=\"true\"]") && sources.switcher.includes("platform-workspace-status"), "shape/border plus status", "not color only");

  [["T0117", "group.network"], ["T0118", "group.planning"], ["T0119", "group.validate"]].forEach(([id, key]) => check(id, groupKeys(design).includes(key), groupKeys(design), key));
  check("T0120", design.platformGroup.labelKey === "group.platform", design.platformGroup, "PLATFORM group");
  [
    ["T0121", "/design/facility-location"], ["T0122", "/design/network-scenarios"],
    ["T0123", "/design/fleet-capacity"], ["T0124", "/design/cost-to-serve"],
    ["T0125", "/design/demand-growth"], ["T0126", "/design/resilience"],
    ["T0127", "/design/operational-validation"],
  ].forEach(([id, route]) => check(id, designPaths.includes(route), designPaths, route));
  [
    ["T0128", "/command/dispatch"], ["T0129", "/command/mission-control"],
    ["T0130", "/command/driver-simulator"], ["T0131", "/command/alerts"], ["T0132", "/command/recovery"],
  ].forEach(([id, route]) => check(id, !designPaths.includes(route), designPaths, `excludes ${route}`, true));

  [["T0133", "group.operations"], ["T0134", "group.execution"], ["T0135", "group.response"]].forEach(([id, key]) => check(id, groupKeys(command).includes(key), groupKeys(command), key));
  check("T0136", command.platformGroup.labelKey === "group.platform", command.platformGroup, "PLATFORM group");
  [
    ["T0137", "/command/dispatch"], ["T0138", "/command/mission-control"],
    ["T0139", "/command/execution"], ["T0140", "/command/plan-vs-actual"],
    ["T0141", "/command/driver-simulator"], ["T0142", "/command/alerts"],
    ["T0143", "/command/recovery"], ["T0144", "/command/shift-review"],
  ].forEach(([id, route]) => check(id, commandPaths.includes(route), commandPaths, route));
  [
    ["T0145", "/design/facility-location"], ["T0146", "greenfield"],
    ["T0147", "brownfield"], ["T0148", "facility-count-curve"],
  ].forEach(([id, route]) => check(id, !commandPaths.some((pathValue) => pathValue.includes(route)), commandPaths, `excludes ${route}`, true));

  check("T0149", JSON.stringify(design.platformGroup.items) === JSON.stringify(command.platformGroup.items), platformPaths, "identical PLATFORM items");
  check("T0150", css.includes(".platform-v19-shared-nav") && css.includes("border-top: 1px solid var(--ui-line, #b8c5d4)"), "separate shared region and rule", "visually separated");
  check("T0151", designPaths.every((route) => route.startsWith("/design/")) && !designPaths.some((route) => route.startsWith("/command/")), designPaths, "DESIGN only");
  check("T0152", commandPaths.every((route) => route.startsWith("/command/")) && !commandPaths.some((route) => route.startsWith("/design/")), commandPaths, "COMMAND only");
  check("T0153", new Set([...designPaths, ...commandPaths]).size === designPaths.length + commandPaths.length, { design: designPaths.length, command: commandPaths.length }, "separate domains");

  const collapsedDesign = modelAt("DESIGN", "/design/facility-location", { navigationCollapsed: true });
  const collapsedCommand = modelAt("COMMAND", "/command/dispatch", { navigationCollapsed: true });
  check("T0154", collapsedDesign.collapsed && collapsedDesign.identity.key === "DESIGN" && collapsedDesign.activeRoute === "/design/facility-location", collapsedDesign, "identity and active route retained");
  check("T0155", Model.WORKSPACE_IDENTITIES.DESIGN.icon !== Model.WORKSPACE_IDENTITIES.COMMAND.icon && Model.WORKSPACE_IDENTITIES.DESIGN.key !== Model.WORKSPACE_IDENTITIES.COMMAND.key, Model.WORKSPACE_IDENTITIES, "distinct silhouette and label");
  check("T0156", sources.sidebar.includes("platform-nav-icon") && sources.sidebar.includes("platform-nav-label"), "icon and text nodes", "expanded item anatomy");
  check("T0157", sources.sidebar.includes("button.title = label") && sources.sidebar.includes('setAttribute("aria-label", label)'), "title and aria-label", "collapsed access");
  check("T0158", sources.sidebar.includes('setAttribute("aria-current", "page")'), "committed active route sets aria-current", "aria-current=page");
  check("T0159", sources.sidebar.includes('node(documentValue, "h2", "platform-nav-group-heading"'), "h2", "non-clickable group heading");
  check("T0160", css.includes(".platform-v19-business-nav") && css.includes("overflow: auto") && css.includes(".platform-v19-shared-nav"), "scrolling business region plus separate shared region", "PLATFORM remains reachable");
  check("T0161", sources.outlet.indexOf("mobileSwitcher") < sources.outlet.indexOf("mobileBusiness"), "switcher before business", "drawer order 1");
  check("T0162", sources.outlet.indexOf("mobileBusiness") < sources.outlet.indexOf("mobilePlatform"), "business before platform", "drawer order 2");
  check("T0163", sources.outlet.indexOf("mobilePlatform") > sources.outlet.indexOf("mobileBusiness"), "platform after business", "drawer order 3");

  const mobileAuthority = State.createAuthority();
  mobileAuthority.setPreference("mobileDrawerOpen", true);
  mobileAuthority.commitRoute("/design/overview", "DESIGN", {});
  check("T0164", mobileAuthority.snapshot().mobileDrawerOpen === false, mobileAuthority.snapshot().mobileDrawerOpen, false);

  const environment = createFakeEnvironment("http://test.local/index.html#/design/overview");
  const historyAuthority = State.createAuthority();
  const historyRouter = Router.createRouter({
    stateAuthority: historyAuthority,
    environment,
    mountRoute() { return { cleanup() {} }; },
    mountError() { return { cleanup() {} }; },
  });
  await historyRouter.start();
  await historyRouter.navigate("/command/overview");
  environment.history.back();
  await waitUntil(() => historyAuthority.snapshot().activeRoute === "/design/overview");
  check("T0165", historyAuthority.snapshot().activeWorkspace === "DESIGN", historyAuthority.snapshot(), "Back follows route history");
  await historyRouter.stop();

  const isolated = State.createAuthority();
  isolated.setWorkspacePresentation("DESIGN", { selectionRef: "design-site-3", mapViewRef: "design-map", scenarioRef: "scenario-a", dirty: true });
  isolated.setWorkspacePresentation("COMMAND", { selectionRef: "command-stop-9", mapViewRef: "command-map", executionCursor: "event-42", dirty: false });
  isolated.commitRoute("/design/network-scenarios", "DESIGN", { scenarioId: "a" });
  isolated.commitRoute("/command/execution", "COMMAND", { runId: "r1" });
  const envelopes = isolated.snapshot().workspaceStates;
  check("T0166", envelopes.DESIGN.lastRoute === "/design/network-scenarios" && envelopes.COMMAND.lastRoute === "/command/execution", envelopes, "independent remembered routes");
  check("T0167", envelopes.DESIGN.selectionRef === "design-site-3" && envelopes.COMMAND.selectionRef === "command-stop-9", envelopes, "independent selections");
  check("T0168", envelopes.DESIGN.scenarioRef === "scenario-a" && envelopes.COMMAND.executionCursor === "event-42", envelopes, "domain state isolated");
  check("T0169", envelopes.DESIGN.dirty === true && envelopes.COMMAND.dirty === false, envelopes, "independent dirty flags");

  let confirmations = 0;
  let navigations = 0;
  const guard = Guard.createGuard({
    snapshot: isolated.snapshot,
    message: (workspace) => workspace,
    confirm: async () => { confirmations += 1; return false; },
    navigate: async () => { navigations += 1; return { ok: true }; },
  });
  const cancelled = await guard.request("/design/overview", "DESIGN", {});
  check("T0170", confirmations === 0 && navigations === 1 && cancelled.ok, { confirmations, navigations, cancelled }, "inactive dirty state does not warn active workspace");

  [["T0171", "settings.scope.platform"], ["T0172", "settings.scope.design"], ["T0173", "settings.scope.command"]].forEach(([id, key]) => {
    const labels = I18n.locales.map((locale) => I18n.translate(key, locale));
    check(id, labels.every((value) => value !== key) && new Set(labels).size === 3, labels, "localized distinct scope");
  });
  check("T0174", css.includes("--p2-design: #5b5bd6") && css.includes("--p2-command: #087ea4"), "indigo DESIGN and cyan COMMAND tokens", "visual contract");
  check("T0175", !/--p2-(?:design|command):\s*#(?:d71920|e60012)/i.test(css), css.match(/--p2-(?:design|command):[^;]+/g), "workspace accent is not critical red", true);
  check("T0176", css.includes("@media (prefers-reduced-motion: reduce)") && css.includes("transition: none !important"), "reduced motion override", "no transition animation");
  const noWebglModel = modelAt("DESIGN", "/design/overview", { noWebGL: true });
  check("T0177", noWebglModel.noWebGL && JSON.stringify(itemPaths(noWebglModel)) === JSON.stringify(designPaths), itemPaths(noWebglModel), designPaths);

  const requiredKeys = new Set(Object.keys(I18n.COPY.en));
  const completeLocales = I18n.locales.every((locale) => [...requiredKeys].every((key) => I18n.COPY[locale][key]));
  check("T0178", completeLocales && I18n.locales.length === 3, I18n.locales.map((locale) => ({ locale, keys: Object.keys(I18n.COPY[locale]).length })), "three complete locale dictionaries");
  check("T0179", css.includes("overflow-wrap: anywhere") && css.includes("min-width: 0"), "overflow wrapping and constrained tracks", "long labels safe");
  check("T0180", css.includes("@media (max-width: 900px)") && css.includes("width: min(360px, 92vw)"), "mobile portrait rule", "390x844 contract");
  check("T0181", css.includes("orientation: landscape") && css.includes("max-height: 500px"), "landscape rule", "844x390 contract");
  check("T0182", css.includes("--p2-sidebar-expanded: 280px") && css.includes("grid-template-columns: var(--p2-sidebar-expanded) minmax(0, 1fr)"), "desktop track", "1440x900 contract");

  check("NAV-REGISTRY", Model.validateAgainstRoutes(Router.ROUTES).ok && [...designPaths, ...commandPaths, ...platformPaths].every((route) => routePaths.has(route)), Model.validateAgainstRoutes(Router.ROUTES), "all nav routes from P1 registry");
  check("NAV-ENVELOPE", Isolation.validateWorkspaceStates(envelopes), envelopes, "valid isolated workspace envelopes");
  printResult(assertions, { gate: "Platform Gate P2", requiredRange: "T0107-T0182" });
}

main().catch((error) => { console.error(error); process.exit(1); });
