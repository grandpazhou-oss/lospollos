(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.unsavedGuard = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function requiresWarning(snapshot, targetWorkspace) {
    const active = snapshot.activeWorkspace;
    if (active !== "DESIGN" && active !== "COMMAND") return false;
    if (targetWorkspace === active) return false;
    return Boolean(snapshot.workspaceStates[active].dirty);
  }

  function createGuard(options) {
    let activeRequest = null;
    let queuedLatestRequest = null;
    let generation = 0;
    let approvedContext = null;

    function superseded(request, supersededBy) {
      request.resolve({
        ok: false,
        controlled: true,
        stale: true,
        code: "GUARDED_NAVIGATION_SUPERSEDED",
        generation: request.generation,
        supersededBy,
      });
    }

    function approvedFor(snapshot) {
      return approvedContext
        && approvedContext.workspace === snapshot.activeWorkspace
        && approvedContext.revision === snapshot.revision;
    }

    async function drain(request) {
      activeRequest = request;
      const snapshot = options.snapshot();
      const message = options.message(snapshot.activeWorkspace, snapshot.locale);
      const accepted = await options.confirm(message);
      if (!accepted) {
        const cancelled = { ok: false, cancelled: true, route: snapshot.activeRoute };
        activeRequest.resolve(cancelled);
        if (queuedLatestRequest) queuedLatestRequest.resolve(cancelled);
        activeRequest = null;
        queuedLatestRequest = null;
        approvedContext = null;
        return;
      }

      const selected = queuedLatestRequest || activeRequest;
      if (selected !== activeRequest) superseded(activeRequest, selected.generation);
      queuedLatestRequest = null;
      activeRequest = null;
      approvedContext = { workspace: snapshot.activeWorkspace, revision: snapshot.revision };
      try {
        selected.resolve(await options.navigate(selected.target, selected.navigateOptions));
      } finally {
        const current = options.snapshot();
        if (!approvedFor(current)) approvedContext = null;
      }
    }

    return Object.freeze({
      request(target, targetWorkspace, navigateOptions) {
        const snapshot = options.snapshot();
        if (!requiresWarning(snapshot, targetWorkspace) || approvedFor(snapshot)) {
          return options.navigate(target, navigateOptions);
        }

        const request = { target, targetWorkspace, navigateOptions, generation: ++generation };
        request.promise = new Promise((resolve) => { request.resolve = resolve; });
        if (activeRequest) {
          if (queuedLatestRequest) superseded(queuedLatestRequest, request.generation);
          queuedLatestRequest = request;
        } else {
          Promise.resolve().then(() => drain(request));
        }
        return request.promise;
      },
      pending() {
        return Boolean(activeRequest);
      },
    });
  }

  return Object.freeze({ requiresWarning, createGuard });
});
