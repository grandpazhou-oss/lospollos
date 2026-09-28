#!/usr/bin/env node
"use strict";

const Router = require("../workspace-router-v19.js");
const State = require("../workspace-state-v19.js");
const { createChecks, createFakeEnvironment, waitUntil, printResult } = require("./platform-v19-test-utils.js");

const { assertions, check } = createChecks("tests/test_route_lifecycle_v19.js");

function createRouter(environment, hooks) {
  const authority = State.createAuthority();
  const errors = [];
  const router = Router.createRouter({
    stateAuthority: authority,
    environment,
    mountRoute: hooks.mountRoute,
    mountError(context) { errors.push(context.error.code); return hooks.mountError ? hooks.mountError(context) : { cleanup() {} }; },
  });
  return { authority, router, errors };
}

async function main() {
  const rapidEnvironment = createFakeEnvironment("http://test.local/index.html#/");
  let firstMountStarted = false;
  const rapid = createRouter(rapidEnvironment, {
    mountRoute(context) {
      if (context.logicalPath === "/design/facility-location") {
        firstMountStarted = true;
        return new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ cleanup() {} }), { once: true }));
      }
      return { cleanup() {} };
    },
  });
  const first = rapid.router.navigate("/design/facility-location");
  await waitUntil(() => firstMountStarted);
  const second = rapid.router.navigate("/command/dispatch");
  const third = rapid.router.navigate("/platform/trust");
  const fourth = rapid.router.navigate("/design/overview");
  const rapidResults = await Promise.all([first, second, third, fourth]);
  check("T0092", rapidResults.slice(0, 3).every((row) => !row.ok && row.error.code === "PLATFORM_ROUTE_MOUNT_ABORTED") && rapidResults[3].ok && rapid.authority.snapshot().activeRoute === "/design/overview", { results: rapidResults.map((row) => row.ok ? "COMMITTED" : row.error.code), final: rapid.authority.snapshot().activeRoute }, "only latest rapid navigation commits", true);
  check("ADV-01", rapid.router.diagnostics().staleRejections === 3, rapid.router.diagnostics(), "DESIGN to COMMAND to PLATFORM to DESIGN stale mounts rejected", true);
  await rapid.router.stop();

  const order = [];
  const ordered = createRouter(createFakeEnvironment(), {
    mountRoute(context) {
      order.push(`mount:${context.descriptor.workspace}`);
      if (context.descriptor.workspace === "DESIGN") {
        return { cleanup: async () => { order.push("cleanup:DESIGN:start"); await new Promise((resolve) => setTimeout(resolve, 5)); order.push("cleanup:DESIGN:end"); } };
      }
      return { cleanup() {} };
    },
  });
  await ordered.router.navigate("/design/overview");
  await ordered.router.navigate("/command/overview");
  check("T0093", order.indexOf("cleanup:DESIGN:end") < order.indexOf("mount:COMMAND"), order, "DESIGN unmount completes before COMMAND mount");
  await ordered.router.stop();

  const listenerEnvironment = createFakeEnvironment();
  const listenerRoute = createRouter(listenerEnvironment, {
    mountRoute(context) {
      if (context.logicalPath === "/design/overview") context.scope.listen(listenerEnvironment, "route-owned", () => {});
      return { cleanup() {} };
    },
  });
  await listenerRoute.router.navigate("/design/overview");
  const listenerDuring = listenerEnvironment.listenerCount("route-owned");
  await listenerRoute.router.navigate("/command/overview");
  check("T0094", listenerDuring === 1 && listenerEnvironment.listenerCount("route-owned") === 0, { during: listenerDuring, after: listenerEnvironment.listenerCount("route-owned") }, "route-owned listener removed on cancellation");
  await listenerRoute.router.stop();

  const frameEnvironment = createFakeEnvironment();
  const frameRoute = createRouter(frameEnvironment, {
    mountRoute(context) {
      if (context.logicalPath === "/design/overview") context.scope.requestFrame(() => {});
      return { cleanup() {} };
    },
  });
  await frameRoute.router.navigate("/design/overview");
  const framesDuring = frameEnvironment.pendingFrames();
  await frameRoute.router.navigate("/command/overview");
  check("T0095", framesDuring === 1 && frameEnvironment.pendingFrames() === 0, { during: framesDuring, after: frameEnvironment.pendingFrames() }, "pending animation frame cancelled");
  await frameRoute.router.stop();

  let mapCleanup = 0;
  const mapRoute = createRouter(createFakeEnvironment(), {
    mountRoute(context) {
      if (context.logicalPath === "/design/overview") context.scope.ownMap({ remove() { mapCleanup += 1; } });
      return { cleanup() {} };
    },
  });
  await mapRoute.router.navigate("/design/overview");
  await mapRoute.router.navigate("/command/overview");
  check("T0096", mapCleanup === 1, mapCleanup, "route-owned map owner cleaned once");
  await mapRoute.router.stop();

  const failureRoute = createRouter(createFakeEnvironment(), {
    mountRoute(context) {
      if (context.logicalPath === "/command/recovery") throw new Error("deliberate mount rejection");
      return { cleanup() {} };
    },
  });
  await failureRoute.router.navigate("/design/overview");
  const beforeFailure = failureRoute.authority.snapshot().activeRoute;
  const failed = await failureRoute.router.navigate("/command/recovery");
  check("T0097", !failed.ok && failed.error.code === "PLATFORM_ROUTE_MOUNT_FAILED" && failureRoute.errors.includes("PLATFORM_ROUTE_MOUNT_FAILED"), { failed, errors: failureRoute.errors }, "stable controlled mount failure code", true);
  check("ADV-08", failureRoute.authority.snapshot().activeRoute === beforeFailure, { beforeFailure, afterFailure: failureRoute.authority.snapshot().activeRoute }, "rejected mount preserves previous valid route", true);
  await failureRoute.router.stop();

  const cleanupEnvironment = createFakeEnvironment();
  const scope = Router.createMountScope(cleanupEnvironment);
  const cleanupOrder = [];
  scope.register(() => cleanupOrder.push("later-cleanup-ran"), "later");
  scope.register(() => { cleanupOrder.push("throwing-cleanup-ran"); throw new Error("cleanup failure"); }, "throwing");
  const cleanupResult = await scope.cleanup();
  check("ADV-07", cleanupResult.errors.length === 1 && cleanupOrder.join(",") === "throwing-cleanup-ran,later-cleanup-ran", { cleanupResult, cleanupOrder }, "cleanup failure collected while later cleanup runs", true);
  printResult(assertions);
}

main().catch((error) => { console.error(error); process.exit(1); });
