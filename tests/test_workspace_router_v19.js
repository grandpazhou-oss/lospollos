#!/usr/bin/env node
"use strict";

const Router = require("../workspace-router-v19.js");
const State = require("../workspace-state-v19.js");
const Workspaces = require("../workspace-registry-v19.js");
const Outlet = require("../platform-route-outlet-v19.js");
const { createChecks, createFakeEnvironment, printResult } = require("./platform-v19-test-utils.js");

const { assertions, check } = createChecks("tests/test_workspace_router_v19.js");

async function main() {
  for (const [requirementId, route, expectedWorkspace] of [
    ["T0053", "/", "PLATFORM"],
    ["T0054", "/design", "DESIGN"],
    ["T0055", "/command", "COMMAND"],
    ["T0056", "/platform/data", "PLATFORM"],
    ["T0057", "/platform/scenarios", "PLATFORM"],
    ["T0058", "/platform/trust", "PLATFORM"],
    ["T0059", "/platform/settings", "PLATFORM"],
  ]) {
    const resolved = Router.resolveRoute(route);
    check(requirementId, resolved.ok && resolved.descriptor.workspace === expectedWorkspace, resolved.ok ? resolved.descriptor : resolved.error, `${route} resolves to ${expectedWorkspace}`);
  }

  const designChildren = Workspaces.ROUTES.DESIGN.filter((route) => route !== "/design");
  check("T0060", designChildren.every((route) => Router.resolveRoute(route).ok && Router.resolveRoute(route).descriptor.workspace === "DESIGN"), designChildren.map((route) => Router.resolveRoute(route).ok), "all DESIGN children resolve");
  const commandChildren = Workspaces.ROUTES.COMMAND.filter((route) => route !== "/command");
  check("T0061", commandChildren.every((route) => Router.resolveRoute(route).ok && Router.resolveRoute(route).descriptor.workspace === "COMMAND"), commandChildren.map((route) => Router.resolveRoute(route).ok), "all COMMAND children resolve");

  const authority = State.createAuthority();
  const environment = createFakeEnvironment("http://test.local/index.html#/");
  let rendered = null;
  const router = Router.createRouter({
    stateAuthority: authority,
    environment,
    mountRoute(context) { rendered = { descriptor: context.descriptor, logicalPath: context.logicalPath, routeParams: context.routeParams }; return { cleanup() {} }; },
    mountError(context) { rendered = { error: context.error, logicalPath: context.logicalPath }; return { cleanup() {} }; },
  });
  await router.start();
  const unknown = await router.navigate("/design/does-not-exist");
  check("T0062", !unknown.ok && unknown.controlled && unknown.error.code === "PLATFORM_ROUTE_NOT_FOUND", unknown, "controlled PLATFORM_ROUTE_NOT_FOUND", true);
  const model = Outlet.createViewModel(authority.snapshot(), rendered);
  check("T0063", model.kind === "ERROR" && model.heading.length > 0 && model.errorCode === "PLATFORM_ROUTE_NOT_FOUND", model, "nonblank controlled error model", true);
  await router.stop();
  printResult(assertions, { routeCount: Router.ROUTES.length });
}

main().catch((error) => { console.error(error); process.exit(1); });
