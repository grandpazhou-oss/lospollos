#!/usr/bin/env node
"use strict";

const State = require("../workspace-state-v19.js");
const Workspaces = require("../workspace-registry-v19.js");
const Router = require("../workspace-router-v19.js");
const Outlet = require("../platform-route-outlet-v19.js");
const { createChecks, createFakeEnvironment, printResult } = require("./platform-v19-test-utils.js");

const { assertions, check } = createChecks("tests/test_platform_shell_v19.js");

async function main() {
  const baseline = State.defaults();
  check("T0045", State.validateState(baseline).ok && State.REQUIRED_KEYS.every((key) => Object.hasOwn(baseline, key)), Object.keys(baseline), State.REQUIRED_KEYS);
  for (const [requirementId, workspace] of [["T0046", "DESIGN"], ["T0047", "COMMAND"], ["T0048", "PLATFORM"]]) {
    const candidate = JSON.parse(JSON.stringify(baseline));
    candidate.activeWorkspace = workspace;
    check(requirementId, State.validateState(candidate).ok, workspace, "accepted");
  }
  const invalidWorkspace = JSON.parse(JSON.stringify(baseline));
  invalidWorkspace.activeWorkspace = "STRATEGY";
  check("T0049", !State.validateState(invalidWorkspace).ok, State.validateState(invalidWorkspace).errors, "activeWorkspace:invalid", true);

  const registry = Workspaces.createRegistry();
  for (const [requirementId, key] of [["T0050", "design"], ["T0051", "command"], ["T0052", "platform"]]) {
    const before = registry.get(key).key;
    const localizedModels = ["zh", "en", "ja"].map((locale) => ({ locale, key: registry.get(key).key }));
    check(requirementId, localizedModels.every((row) => row.key === before), localizedModels, `${key} remains stable`);
  }

  const environment = createFakeEnvironment("http://test.local/index.html#/");
  const authority = State.createAuthority();
  let current = null;
  const router = Router.createRouter({
    stateAuthority: authority,
    workspaceRegistry: registry,
    environment,
    mountRoute(context) { current = context; return { cleanup() {} }; },
    mountError(context) { current = { error: context.error, logicalPath: context.logicalPath }; return { cleanup() {} }; },
  });
  await router.start();
  await router.navigate("/design/facility-location");
  check("T0073", authority.snapshot().activeWorkspace === "DESIGN", authority.snapshot(), "route derives DESIGN workspace");
  await router.navigateWorkspace("COMMAND");
  check("T0074", authority.snapshot().activeRoute === "/command/overview", authority.snapshot().activeRoute, "/command/overview");

  const model = Outlet.createViewModel(authority.snapshot(), current);
  check("T0075", model.selectors.workspaceSwitcher.workspace === authority.snapshot().activeWorkspace && model.selectors.workspaceSwitcher.revision === authority.snapshot().revision, model.selectors.workspaceSwitcher, "single shell snapshot");
  check("T0076", model.selectors.sidebar.route === authority.snapshot().activeRoute && model.selectors.sidebar.revision === authority.snapshot().revision, model.selectors.sidebar, "single shell snapshot");
  check("T0077", model.selectors.breadcrumb.route === authority.snapshot().activeRoute && model.selectors.breadcrumb.revision === authority.snapshot().revision, model.selectors.breadcrumb, "single shell snapshot");
  check("T0078", model.selectors.mobileDrawer.route === authority.snapshot().activeRoute && model.selectors.mobileDrawer.revision === authority.snapshot().revision, model.selectors.mobileDrawer, "single shell snapshot");

  const invalidStored = JSON.parse(JSON.stringify(State.defaults()));
  invalidStored.activeRoute = "/design/not-registered";
  invalidStored.activeWorkspace = "DESIGN";
  const restored = State.restoreState(JSON.stringify(invalidStored), (route) => Router.resolveRoute(route).ok);
  check("T0079", !restored.ok && restored.state.activeRoute === "/" && restored.error.code === "PLATFORM_ROUTE_RESTORE_INVALID", { ok: restored.ok, route: restored.state.activeRoute, code: restored.error.code }, "safe root fallback", true);

  const serialized = State.serializeState(authority.snapshot());
  check("T0085", serialized.ok && JSON.parse(serialized.payload).activeRoute === "/command/overview", serialized.ok ? JSON.parse(serialized.payload).activeRoute : serialized.error.code, "/command/overview");
  const withSecret = JSON.parse(JSON.stringify(authority.snapshot()));
  withSecret.workspaceStates.COMMAND.apiToken = "not-a-real-token";
  const secretResult = State.serializeState(withSecret);
  check("T0086", !secretResult.ok, secretResult.error && secretResult.error.code, "secret-bearing state rejected", true);
  const withSecretValue = JSON.parse(JSON.stringify(authority.snapshot()));
  withSecretValue.workspaceStates.COMMAND.viewStateRef = "Bearer abcdefghijklmnopqrstuvwxyz";
  const secretValueResult = State.serializeState(withSecretValue);
  check("ADV-14", !secretResult.ok && !secretValueResult.ok, { key: secretResult.error && secretResult.error.code, value: secretValueResult.error && secretValueResult.error.code }, "token-like keys and credential-shaped values rejected", true);
  const withLargeData = JSON.parse(JSON.stringify(authority.snapshot()));
  withLargeData.workspaceStates.DESIGN.rows = Array.from({ length: 51 }, (_, index) => index);
  const largeResult = State.serializeState(withLargeData);
  check("T0087", !largeResult.ok, largeResult.error && largeResult.error.code, "large business array rejected", true);
  check("ADV-13", !largeResult.ok, largeResult.error && largeResult.error.code, "raw large arrays rejected", true);

  const stableRoute = authority.snapshot().activeRoute;
  authority.setPreference("locale", "ja");
  check("T0088", authority.snapshot().activeRoute === stableRoute && authority.snapshot().locale === "ja", authority.snapshot(), "route preserved");
  authority.setPreference("reducedMotion", true);
  check("T0089", authority.snapshot().activeRoute === stableRoute && authority.snapshot().reducedMotion, authority.snapshot(), "route preserved");
  authority.setPreference("noWebGL", true);
  check("T0090", authority.snapshot().activeRoute === stableRoute && authority.snapshot().noWebGL, authority.snapshot(), "route preserved");
  authority.setPreference("platformPanel", "TRUST_SUMMARY");
  check("T0091", authority.snapshot().activeRoute === stableRoute && authority.snapshot().platformPanel === "TRUST_SUMMARY", authority.snapshot(), "panel independent from route");
  await router.stop();
  printResult(assertions);
}

main().catch((error) => { console.error(error); process.exit(1); });
