'use strict';
const assert = require('node:assert/strict');
const { create } = require('../platform-service-directory-v8.js');

const directory = create({ facilityOptimizerApiUrl: 'http://127.0.0.1:51001/facility-optimize-v19', optimizerApiUrl: 'http://127.0.0.1:51001/optimize', expectedOptimizerBuildFingerprint: 'OLD_BUILD' });
assert.equal(directory.endpoint('SUPPLY_CHAIN_PERIOD'), directory.endpoint('FACILITY'));
assert.equal(directory.endpoint('OPERATIONS_PLAN'), 'http://127.0.0.1:51001/optimize');
assert.equal(directory.describe('SUPPLY_CHAIN_PERIOD').status, 'NOT_RUN');
assert.equal(directory.describe('SUPPLY_CHAIN_PERIOD', { endpoint: directory.endpoint('SUPPLY_CHAIN_PERIOD'), buildFingerprint: 'NEW_BUILD', capabilities: ['FACILITY', 'SUPPLY_CHAIN_JOBS_V6'] }).status, 'COMPATIBLE_BUILD_DIFFERS');
assert.equal(directory.describe('SUPPLY_CHAIN_PERIOD', { endpoint: 'http://127.0.0.1:8787/facility-optimize-v19', buildFingerprint: 'OLD_BUILD' }).status, 'ENDPOINT_MISMATCH');
assert.throws(() => create({ facilityOptimizerApiUrl: 'https://public.example/facility-optimize-v19' }), /SERVICE_DIRECTORY_LOCAL_ENDPOINT_REQUIRED/);
assert.throws(() => directory.endpoint('UNKNOWN'), /SERVICE_DIRECTORY_STUDY_KIND_UNSUPPORTED/);
console.log('V8 service directory: loopback selection, observed build and endpoint mismatch PASS');
