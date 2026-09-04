"use strict";

const assert = require("assert");
const Layers = require("../map-layer-registry-v15.js");

function fakeMap() {
  const sources = new Map(); const layers = new Map(); const handlers = [];
  return {
    sources, layers, handlers,
    addSource(id, definition) { const source = { definition, data: definition.data, setData(data) { this.data = data; } }; sources.set(id, source); },
    getSource(id) { return sources.get(id); },
    removeSource(id) { if ([...layers.values()].some((layer) => layer.source === id)) throw new Error(`source ${id} still in use`); sources.delete(id); },
    addLayer(definition) { layers.set(definition.id, definition); },
    getLayer(id) { return layers.get(id); },
    removeLayer(id) { layers.delete(id); },
    setLayoutProperty(id, property, value) { layers.get(id)[property] = value; },
    on(event, layer, handler) { handlers.push({ event, layer, handler }); },
    off(event, layer, handler) { const index = handlers.findIndex((row) => row.event === event && row.layer === layer && row.handler === handler); if (index >= 0) handlers.splice(index, 1); },
  };
}

const map = fakeMap();
const registry = Layers.createDefaultRegistry({ map });
assert.deepStrictEqual([...Layers.REQUIRED_PLUGIN_IDS].sort(), registry.list().sort());
assert.strictEqual(Layers.createDeckAdapterHook().enabled, false);

registry.mount("INCIDENT", {
  sources: [{ id: "stct-v15-incident", data: { type: "FeatureCollection", features: [] } }],
  layers: [{ id: "stct-v15-incident-layer", type: "circle", source: "stct-v15-incident" }],
});
assert.strictEqual(map.layers.size, 1);
assert.strictEqual(map.sources.size, 1);
registry.update("INCIDENT", { sources: [{ id: "stct-v15-incident", data: { type: "FeatureCollection", features: [{ type: "Feature", geometry: null }] } }] });
assert.strictEqual(map.getSource("stct-v15-incident").data.features.length, 1);
registry.setVisible("INCIDENT", false);
assert.strictEqual(map.getLayer("stct-v15-incident-layer").visibility, "none");
const clean = registry.unmount("INCIDENT");
assert.strictEqual(clean.status, "PASS");
assert.strictEqual(clean.remainingLayers, 0);
assert.strictEqual(clean.remainingSources, 0);
assert.strictEqual(map.layers.size, 0);
assert.strictEqual(map.sources.size, 0);
process.stdout.write("PASS T261 registry unmount leaves zero owned layers and sources\n");

const broken = Layers.createDeclarativePlugin({
  id: "BROKEN_CLEANUP",
  owner: "Synthetic test",
  zIndex: 999,
  onMount(scope) {
    scope.addCleanup(() => { throw Object.assign(new Error("expected cleanup failure"), { code: "EXPECTED_CLEANUP_FAILURE" }); });
  },
  onUnmount() { throw Object.assign(new Error("expected plugin failure"), { code: "EXPECTED_PLUGIN_FAILURE" }); },
});
registry.register(broken);
registry.mount("BROKEN_CLEANUP", {
  sources: [{ id: "stct-v15-broken", data: { type: "FeatureCollection", features: [] } }],
  layers: [{ id: "stct-v15-broken-layer", type: "fill", source: "stct-v15-broken" }],
});
const aggregate = registry.unmountAll({ reason: "synthetic-test" });
assert.strictEqual(aggregate.status, "CLEANED_WITH_ERRORS");
assert.deepStrictEqual(aggregate.errors.map((row) => row.code).sort(), ["EXPECTED_CLEANUP_FAILURE", "EXPECTED_PLUGIN_FAILURE"]);
assert.strictEqual(map.layers.size, 0);
assert.strictEqual(map.sources.size, 0);
assert.strictEqual(map.handlers.length, 0);
process.stdout.write("PASS T262 cleanup errors aggregate while resources reach zero\n");
