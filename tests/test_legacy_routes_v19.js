#!/usr/bin/env node
"use strict";

const Legacy = require("../legacy-route-mapping-v19.js");
const Router = require("../workspace-router-v19.js");
const State = require("../workspace-state-v19.js");
const Outlet = require("../platform-route-outlet-v19.js");
const { createChecks, createFakeEnvironment, printResult } = require("./platform-v19-test-utils.js");

const { assertions, check } = createChecks("tests/test_legacy_routes_v19.js");

async function main() {
  check("T0080", Legacy.currentInventoryComplete() && Legacy.CURRENT_NAV_INVENTORY.length === 13, { inventory: Legacy.CURRENT_NAV_INVENTORY, mappings: Legacy.MAPPINGS.length }, "all 11 P0 controls plus 2 runtime-injected controls mapped");
  check("T0081", Legacy.mapsOperationalTabsToCommand(), Legacy.MAPPINGS.filter((row) => Legacy.CURRENT_NAV_INVENTORY.includes(row.legacyId)).map((row) => [row.legacyId, row.targetLogicalPath]), "operational tabs target COMMAND; strategic Cost and shared Data use their owning workspace");

  const environment = createFakeEnvironment("http://test.local/index.html?optPort=8787#mapView");
  const authority = State.createAuthority();
  let current = null;
  const router = Router.createRouter({
    stateAuthority: authority,
    environment,
    mountRoute(context) { current = context; return { cleanup() {} }; },
    mountError(context) { current = { error: context.error, logicalPath: context.logicalPath }; return { cleanup() {} }; },
  });
  const beforeLength = environment.history.length;
  const redirected = await router.start();
  check("T0082", redirected.ok && redirected.legacy.legacyId === "mapView" && authority.snapshot().activeRoute === "/command/dispatch" && environment.location.hash === "#/command/dispatch", { redirected, href: environment.location.href }, "legacy mapView redirects with evidence");

  const deprecated = Router.parseBrowserLocation({ pathname: "/index.html", search: "", hash: "#legacy-report-builder" });
  const deprecatedModel = Outlet.createViewModel(State.defaults(), {
    descriptor: deprecated.descriptor,
    logicalPath: deprecated.logicalPath,
    routeParams: deprecated.routeParams,
    migration: deprecated.migration,
  });
  check("T0083", deprecated.ok && deprecated.migration && deprecated.migration.message.includes("not declared removed") && deprecatedModel.migration.message.length > 0, deprecated.migration, "visible controlled migration message", true);
  check("T0084", environment.history.length === beforeLength && environment.history.rows().length === 1, environment.history.rows(), "replace without duplicate history entry");

  const loopAttempt = {
    legacyId: "loop",
    targetLogicalPath: "#mapView",
  };
  check("ADV-06", !Legacy.validateMapping(loopAttempt), loopAttempt, "legacy redirect loop rejected", true);
  await router.stop();
  printResult(assertions);
}

main().catch((error) => { console.error(error); process.exit(1); });
