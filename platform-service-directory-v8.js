(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) (root.STCTPlatformV19 = root.STCTPlatformV19 || {}).serviceDirectory = api;
})(globalThis, function () {
  'use strict';
  function create(config = {}) {
    const facilityEndpoint = config.facilityOptimizerApiUrl || 'http://127.0.0.1:8787/facility-optimize-v19';
    const operationsEndpoint = config.optimizerApiUrl || 'http://127.0.0.1:8787/optimize';
    const endpoints = Object.freeze({ SUPPLY_CHAIN_PERIOD: facilityEndpoint, FACILITY: facilityEndpoint, NETWORK_ORDERS: operationsEndpoint, OPERATIONS_PLAN: operationsEndpoint });
    for (const endpoint of Object.values(endpoints)) {
      const url = new URL(endpoint);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('SERVICE_DIRECTORY_LOCAL_ENDPOINT_REQUIRED');
    }
    const expectedBuildFingerprint = config.expectedOptimizerBuildFingerprint || null;
    return Object.freeze({
      endpoint(studyKind) {
        if (!Object.hasOwn(endpoints, studyKind)) throw new Error('SERVICE_DIRECTORY_STUDY_KIND_UNSUPPORTED');
        return endpoints[studyKind];
      },
      describe(studyKind, observed = null) {
        const endpoint = this.endpoint(studyKind);
        return Object.freeze({ endpoint, expectedBuildFingerprint, observedBuildFingerprint: observed?.buildFingerprint || null, observedCapabilities: observed?.capabilities || null, instanceId: observed?.instanceId || null, status: observed ? observed.endpoint === endpoint ? expectedBuildFingerprint && observed.buildFingerprint !== expectedBuildFingerprint ? 'COMPATIBLE_BUILD_DIFFERS' : 'OBSERVED' : 'ENDPOINT_MISMATCH' : 'NOT_RUN' });
      }
    });
  }
  return Object.freeze({ create });
});
