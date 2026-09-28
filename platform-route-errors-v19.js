(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.errors = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CODES = Object.freeze({
    NOT_FOUND: "PLATFORM_ROUTE_NOT_FOUND",
    INVALID_ENCODING: "PLATFORM_ROUTE_INVALID_ENCODING",
    UNSAFE_VALUE: "PLATFORM_ROUTE_UNSAFE_VALUE",
    RESTORE_INVALID: "PLATFORM_ROUTE_RESTORE_INVALID",
    MOUNT_ABORTED: "PLATFORM_ROUTE_MOUNT_ABORTED",
    MOUNT_FAILED: "PLATFORM_ROUTE_MOUNT_FAILED",
  });

  class PlatformRouteError extends Error {
    constructor(code, message, detail) {
      super(message || code);
      this.name = "PlatformRouteError";
      this.code = code;
      this.detail = detail || null;
    }

    toJSON() {
      return { name: this.name, code: this.code, message: this.message, detail: this.detail };
    }
  }

  function create(code, message, detail) {
    return new PlatformRouteError(code, message, detail);
  }

  function normalize(error, fallbackCode) {
    if (error instanceof PlatformRouteError) return error;
    return create(
      fallbackCode || CODES.MOUNT_FAILED,
      error && error.message ? error.message : String(error || "Unknown route error"),
    );
  }

  function isStableCode(code) {
    return Object.values(CODES).includes(code);
  }

  return Object.freeze({ CODES, PlatformRouteError, create, normalize, isStableCode });
});
