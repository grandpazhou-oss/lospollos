"use strict";

const assert = require("assert");

function createChecks(evidence) {
  const assertions = [];
  function check(requirementId, condition, observed, expected, negative) {
    const row = {
      assertionId: `${requirementId}-A1`,
      requirementId,
      status: condition ? "PASS" : "FAIL",
      observed,
      expected,
      negative: Boolean(negative),
      evidence,
    };
    assertions.push(row);
    assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
  }
  return { assertions, check };
}

function createFakeEnvironment(initialUrl) {
  let url = new URL(initialUrl || "http://test.local/index.html#/");
  let historyIndex = 0;
  let historyRows = [url.href];
  const listeners = new Map();
  const frames = new Map();
  let nextFrame = 1;

  function eventRows(type) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    return listeners.get(type);
  }
  function emit(type) {
    [...eventRows(type)].forEach((listener) => listener({ type }));
  }
  function update(next) {
    url = new URL(next, url.href);
  }

  const environment = {
    location: {
      get href() { return url.href; },
      get pathname() { return url.pathname; },
      get search() { return url.search; },
      get hash() { return url.hash; },
    },
    history: {
      get length() { return historyRows.length; },
      pushState(_state, _title, next) {
        update(next);
        historyRows = historyRows.slice(0, historyIndex + 1);
        historyRows.push(url.href);
        historyIndex = historyRows.length - 1;
      },
      replaceState(_state, _title, next) {
        update(next);
        historyRows[historyIndex] = url.href;
      },
      back() {
        if (historyIndex === 0) return;
        historyIndex -= 1;
        url = new URL(historyRows[historyIndex]);
        emit("popstate");
        emit("hashchange");
      },
      forward() {
        if (historyIndex >= historyRows.length - 1) return;
        historyIndex += 1;
        url = new URL(historyRows[historyIndex]);
        emit("popstate");
        emit("hashchange");
      },
      rows() { return historyRows.slice(); },
      index() { return historyIndex; },
    },
    addEventListener(type, listener) { eventRows(type).add(listener); },
    removeEventListener(type, listener) { eventRows(type).delete(listener); },
    listenerCount(type) { return eventRows(type).size; },
    emit,
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    pendingFrames() { return frames.size; },
  };
  return environment;
}

function waitUntil(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      if (predicate()) return resolve();
      if (Date.now() - started > (timeoutMs || 1000)) return reject(new Error("Timed out waiting for condition"));
      setTimeout(poll, 2);
    }
    poll();
  });
}

function printResult(assertions, extras) {
  process.stdout.write(`${JSON.stringify(Object.assign({
    status: assertions.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    checks: assertions.length,
    assertions,
  }, extras || {}), null, 2)}\n`);
}

module.exports = { createChecks, createFakeEnvironment, waitUntil, printResult };
