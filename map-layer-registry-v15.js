(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.mapLayers = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "stct-map-layer-registry-v1.5";
  const REQUIRED_PLUGIN_IDS = Object.freeze([
    "REPLAY",
    "ARENA",
    "TIMELINE_SELECTION",
    "INCIDENT",
    "BLAST_RADIUS",
    "RECOVERY_MORPH",
    "SERVICE_ZONE",
    "EXPLANATION",
  ]);

  function text(value) { return String(value ?? "").trim(); }
  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function issue(code, message, detail = {}) {
    const value = new Error(message);
    value.code = code;
    value.detail = clone(detail);
    return value;
  }
  function errorRecord(error, phase, pluginId) {
    return {
      code: text(error?.code || "MAP_LAYER_CLEANUP_ERROR"),
      message: text(error?.message || error),
      phase,
      pluginId,
    };
  }
  function normalizePlugin(plugin) {
    const id = text(plugin?.id).toUpperCase();
    if (!id || !text(plugin?.owner) || !Number.isFinite(Number(plugin?.zIndex))) {
      throw issue("MAP_LAYER_PLUGIN_INVALID", "Map layer plugin requires id, owner, and finite zIndex.");
    }
    ["mount", "update", "setVisible", "legend", "unmount"].forEach((method) => {
      if (typeof plugin?.[method] !== "function") throw issue("MAP_LAYER_PLUGIN_INVALID", `${id} requires ${method}().`);
    });
    return { ...plugin, id, zIndex: Number(plugin.zIndex), capabilities: Object.freeze({ ...(plugin.capabilities || {}) }) };
  }

  function createDeclarativePlugin(definition = {}) {
    const id = text(definition.id).toUpperCase();
    return normalizePlugin({
      id,
      owner: text(definition.owner || `STCTV15.${id}`),
      zIndex: Number(definition.zIndex || 0),
      capabilities: {
        geojson: true,
        visibility: true,
        lifecycleManaged: true,
        ...(definition.capabilities || {}),
      },
      mount(scope, context = {}) {
        (context.sources || []).forEach((source) => scope.addSource(source.id, source.definition || { type: "geojson", data: source.data }));
        (context.layers || []).forEach((layer) => scope.addLayer(layer));
        (context.handlers || []).forEach((binding) => scope.bind(binding.event, binding.layer, binding.handler));
        if (typeof definition.onMount === "function") return definition.onMount(scope, context);
        return null;
      },
      update(scope, context = {}) {
        (context.sources || []).forEach((source) => scope.updateSource(source.id, source.data));
        if (typeof definition.onUpdate === "function") return definition.onUpdate(scope, context);
        return null;
      },
      setVisible(scope, visible) {
        scope.setVisible(visible);
        if (typeof definition.onVisible === "function") definition.onVisible(scope, visible);
      },
      legend(context = {}) {
        if (typeof definition.legend === "function") return definition.legend(context);
        return clone(definition.legend || { id, label: id, items: [] });
      },
      unmount(scope, context = {}) {
        if (typeof definition.onUnmount === "function") return definition.onUnmount(scope, context);
        return null;
      },
    });
  }

  function requiredDefinitions() {
    return [
      { id: "REPLAY", owner: "Mission Control Replay", zIndex: 100, capabilities: { animatedGeoJson: true } },
      { id: "ARENA", owner: "Scenario Arena", zIndex: 200, capabilities: { comparison: true } },
      { id: "TIMELINE_SELECTION", owner: "Dispatch Timeline", zIndex: 300, capabilities: { selection: true } },
      { id: "SERVICE_ZONE", owner: "Service Zone", zIndex: 400, capabilities: { polygon: true, diagnosticOnly: true } },
      { id: "EXPLANATION", owner: "Constraint Explanation", zIndex: 500, capabilities: { evidence: true } },
      { id: "BLAST_RADIUS", owner: "Incident Blast Radius", zIndex: 600, capabilities: { impact: true } },
      { id: "INCIDENT", owner: "Incident Recovery Studio", zIndex: 700, capabilities: { pulse: true } },
      { id: "RECOVERY_MORPH", owner: "Recovery Route Morph", zIndex: 800, capabilities: { beforeAfter: true } },
    ];
  }

  function createRegistry(options = {}) {
    const map = options.map;
    if (!map) throw issue("MAP_LAYER_MAP_REQUIRED", "Map Layer Registry requires a map adapter.");
    const plugins = new Map();
    const mounts = new Map();
    const lifecycleErrors = [];

    function register(plugin) {
      const normalized = normalizePlugin(plugin);
      if (plugins.has(normalized.id)) throw issue("MAP_LAYER_PLUGIN_DUPLICATE", `Map layer plugin already registered: ${normalized.id}`);
      plugins.set(normalized.id, normalized);
      return normalized;
    }

    function createScope(plugin, record) {
      function addSource(idValue, definition) {
        const id = text(idValue);
        if (!id) throw issue("MAP_LAYER_SOURCE_ID_REQUIRED", `${plugin.id} source id is required.`);
        if (map.getSource?.(id)) throw issue("MAP_LAYER_SOURCE_COLLISION", `Map source already exists: ${id}`);
        map.addSource(id, clone(definition));
        record.sources.add(id);
        return map.getSource?.(id) || null;
      }
      function addLayer(definition, beforeId) {
        const layer = clone(definition || {});
        const id = text(layer.id);
        if (!id || !text(layer.source)) throw issue("MAP_LAYER_DEFINITION_INVALID", `${plugin.id} layer requires id and source.`);
        if (map.getLayer?.(id)) throw issue("MAP_LAYER_ID_COLLISION", `Map layer already exists: ${id}`);
        layer.metadata = { ...(layer.metadata || {}), stctPlugin: plugin.id, stctOwner: plugin.owner, stctZIndex: plugin.zIndex };
        map.addLayer(layer, beforeId);
        record.layers.push(id);
        return map.getLayer?.(id) || null;
      }
      function updateSource(idValue, data) {
        const id = text(idValue);
        if (!record.sources.has(id)) throw issue("MAP_LAYER_SOURCE_NOT_OWNED", `${plugin.id} does not own source ${id}.`);
        const source = map.getSource?.(id);
        if (!source?.setData) throw issue("MAP_LAYER_SOURCE_UPDATE_UNSUPPORTED", `Map source cannot be updated: ${id}`);
        source.setData(clone(data));
      }
      function bind(event, layer, handler) {
        if (typeof handler !== "function") throw issue("MAP_LAYER_HANDLER_INVALID", `${plugin.id} handler must be a function.`);
        if (layer) map.on?.(event, layer, handler);
        else map.on?.(event, handler);
        record.handlers.push({ event, layer: layer || "", handler });
      }
      function setVisible(visible) {
        record.visible = Boolean(visible);
        record.layers.forEach((id) => {
          if (map.getLayer?.(id)) map.setLayoutProperty?.(id, "visibility", record.visible ? "visible" : "none");
        });
      }
      function addCleanup(cleanup) {
        if (typeof cleanup !== "function") throw issue("MAP_LAYER_CLEANUP_INVALID", `${plugin.id} cleanup must be a function.`);
        record.cleanups.push(cleanup);
      }
      return Object.freeze({ pluginId: plugin.id, map, addSource, addLayer, updateSource, bind, setVisible, addCleanup });
    }

    function runCleanup(record, plugin, context = {}) {
      const errors = []; const layerIds = record.layers.slice(); const sourceIds = [...record.sources];
      const capture = (phase, callback) => {
        try { callback(); }
        catch (caught) { errors.push(errorRecord(caught, phase, plugin.id)); }
      };
      capture("plugin.unmount", () => plugin.unmount(record.scope, context));
      record.cleanups.slice().reverse().forEach((cleanup) => capture("registered-cleanup", cleanup));
      record.handlers.slice().reverse().forEach((binding) => capture("event-handler", () => {
        if (binding.layer) map.off?.(binding.event, binding.layer, binding.handler);
        else map.off?.(binding.event, binding.handler);
      }));
      record.layers.slice().reverse().forEach((id) => capture("layer", () => { if (map.getLayer?.(id)) map.removeLayer(id); }));
      [...record.sources].reverse().forEach((id) => capture("source", () => { if (map.getSource?.(id)) map.removeSource(id); }));
      record.layers = [];
      record.sources.clear();
      record.handlers = [];
      record.cleanups = [];
      lifecycleErrors.push(...errors);
      return { errors, layerIds, sourceIds };
    }

    function mount(idValue, context = {}) {
      const id = text(idValue).toUpperCase();
      const plugin = plugins.get(id);
      if (!plugin) throw issue("MAP_LAYER_PLUGIN_NOT_REGISTERED", `Map layer plugin is not registered: ${id}`);
      if (mounts.has(id)) unmount(id, { reason: "remount" });
      const record = { id, visible: true, sources: new Set(), layers: [], handlers: [], cleanups: [], context: clone(context?.metadata || {}) };
      record.scope = createScope(plugin, record);
      mounts.set(id, record);
      try {
        const cleanup = plugin.mount(record.scope, context);
        if (typeof cleanup === "function") record.cleanups.push(cleanup);
        return snapshot(id);
      } catch (caught) {
        runCleanup(record, plugin, { reason: "mount-failed" });
        mounts.delete(id);
        throw caught;
      }
    }

    function update(idValue, context = {}) {
      const id = text(idValue).toUpperCase();
      const plugin = plugins.get(id); const record = mounts.get(id);
      if (!plugin || !record) throw issue("MAP_LAYER_PLUGIN_NOT_MOUNTED", `Map layer plugin is not mounted: ${id}`);
      plugin.update(record.scope, context);
      return snapshot(id);
    }

    function setVisible(idValue, visible) {
      const id = text(idValue).toUpperCase();
      const plugin = plugins.get(id); const record = mounts.get(id);
      if (!plugin || !record) throw issue("MAP_LAYER_PLUGIN_NOT_MOUNTED", `Map layer plugin is not mounted: ${id}`);
      plugin.setVisible(record.scope, Boolean(visible));
      return snapshot(id);
    }

    function unmount(idValue, context = {}) {
      const id = text(idValue).toUpperCase(); const plugin = plugins.get(id); const record = mounts.get(id);
      if (!plugin || !record) return { status: "NOT_MOUNTED", pluginId: id, errors: [], remainingLayers: 0, remainingSources: 0 };
      const cleanup = runCleanup(record, plugin, context); const errors = cleanup.errors;
      mounts.delete(id);
      const remainingLayers = cleanup.layerIds.filter((layerId) => map.getLayer?.(layerId)).length;
      const remainingSources = cleanup.sourceIds.filter((sourceId) => map.getSource?.(sourceId)).length;
      return { status: errors.length ? "CLEANED_WITH_ERRORS" : "PASS", pluginId: id, errors, remainingLayers, remainingSources };
    }

    function unmountAll(context = {}) {
      const errors = []; const results = [];
      [...mounts.keys()].sort((left, right) => (plugins.get(right)?.zIndex || 0) - (plugins.get(left)?.zIndex || 0)).forEach((id) => {
        const result = unmount(id, context); results.push(result); errors.push(...result.errors);
      });
      return { status: errors.length ? "CLEANED_WITH_ERRORS" : "PASS", results, errors, remainingLayers: [...mounts.values()].reduce((sum, record) => sum + record.layers.length, 0), remainingSources: [...mounts.values()].reduce((sum, record) => sum + record.sources.size, 0) };
    }

    function snapshot(idValue) {
      const id = text(idValue).toUpperCase(); const plugin = plugins.get(id); const record = mounts.get(id);
      if (!plugin) return null;
      return {
        id,
        owner: plugin.owner,
        zIndex: plugin.zIndex,
        capabilities: clone(plugin.capabilities),
        mounted: Boolean(record),
        visible: record?.visible ?? false,
        layers: record ? record.layers.slice() : [],
        sources: record ? [...record.sources] : [],
        legend: clone(plugin.legend(record?.context || {})),
      };
    }

    function registrySnapshot() {
      return {
        version: VERSION,
        plugins: [...plugins.keys()].sort((left, right) => plugins.get(left).zIndex - plugins.get(right).zIndex).map(snapshot),
        mountedCount: mounts.size,
        lifecycleErrors: clone(lifecycleErrors),
      };
    }

    return Object.freeze({ register, mount, update, setVisible, unmount, unmountAll, snapshot, registrySnapshot, list: () => [...plugins.keys()], getLifecycleErrors: () => clone(lifecycleErrors) });
  }

  function registerRequiredPlugins(registry, overrides = {}) {
    requiredDefinitions().forEach((definition) => registry.register(overrides[definition.id] || createDeclarativePlugin(definition)));
    return registry;
  }

  function createDefaultRegistry(options = {}) {
    return registerRequiredPlugins(createRegistry(options), options.overrides || {});
  }

  function createDeckAdapterHook(options = {}) {
    return Object.freeze({
      id: "DECK_GL_ADAPTER_HOOK",
      enabled: false,
      installed: false,
      dependencyChanged: false,
      reason: options.reason || "MapLibre performance gate has not demonstrated a need for deck.gl, and no dependency change was authorized.",
      activate() { throw issue("DECK_GL_NOT_AUTHORIZED", "deck.gl is not installed or enabled in STCT v1.5."); },
    });
  }

  return { VERSION, REQUIRED_PLUGIN_IDS, createDeclarativePlugin, createRegistry, registerRequiredPlugins, createDefaultRegistry, createDeckAdapterHook };
});
