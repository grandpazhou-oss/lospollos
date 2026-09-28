(function () {
  "use strict";

  const state = { colorMode: "route", heat: false, coverage: true, exceptions: true, attempts: 0, status: "waiting", previewPlan: null };
  const esc = (value) => window.STCTUtils?.escapeHTML ? window.STCTUtils.escapeHTML(value) : String(value ?? "");
  const empty = () => ({ type: "FeatureCollection", features: [] });
  const data = () => window.STCTCore?.getData?.() || window.DATA || window.FLOWMAP_DATA || {};
  const mapInstance = () => window.STCTCore?.getMap?.() || null;

  function usableMap(map) {
    return Boolean(map && typeof map.getSource === "function" && typeof map.getLayer === "function" && typeof map.loaded === "function");
  }

  function setStatus(message, kind = "info") {
    state.status = kind;
    let status = document.getElementById("mapAvailabilityStatus");
    if (!status) {
      status = document.createElement("div");
      status.id = "mapAvailabilityStatus";
      status.className = "map-availability";
      document.getElementById("mapView")?.appendChild(status);
    }
    status.className = `map-availability ${kind}`;
    status.textContent = message;
  }

  function circle(center, radiusKm, points = 96) {
    const [lon, lat] = center;
    const coordinates = [];
    const radius = 6371;
    const latitude = lat * Math.PI / 180;
    for (let index = 0; index <= points; index += 1) {
      const bearing = 2 * Math.PI * index / points;
      const distance = radiusKm / radius;
      const y = Math.asin(Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing));
      const x = lon * Math.PI / 180 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude), Math.cos(distance) - Math.sin(latitude) * Math.sin(y));
      coordinates.push([x * 180 / Math.PI, y * 180 / Math.PI]);
    }
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [coordinates] }, properties: { type: "coverage", radiusKm } };
  }

  function exceptionFeatures() {
    const rows = [...(data().blockedOrders || []), ...(data().unassignedOrders || [])].filter((row) => Number.isFinite(Number(row.lon)) && Number.isFinite(Number(row.lat)));
    return { type: "FeatureCollection", features: rows.map((row) => ({ type: "Feature", geometry: { type: "Point", coordinates: [Number(row.lon), Number(row.lat)] }, properties: { ...row, type: row.assignmentStatus || "异常/未分配" } })) };
  }

  function coverageFeature() {
    const depot = data().depot || {};
    if (!Number.isFinite(Number(depot.lon)) || !Number.isFinite(Number(depot.lat))) return empty();
    return { type: "FeatureCollection", features: [circle([Number(depot.lon), Number(depot.lat)], Number(window.STCT_CONFIG?.warehouseCoverageKm || 40))] };
  }

  function ensureControls() {
    if (document.getElementById("mapColorModeSelect")) return;
    const anchor = document.getElementById("mapPresetSelect");
    if (!anchor) return;
    anchor.closest(".map-options")?.insertAdjacentHTML("beforeend", '<label for="mapColorModeSelect">路线颜色</label><select id="mapColorModeSelect"><option value="route">按路线</option><option value="vehicle">按车辆</option><option value="area">按区域</option><option value="utilization">按利用率</option></select><label class="label-check"><input id="orderHeatToggle" type="checkbox">订单热力图</label><label class="label-check"><input id="coverageToggle" type="checkbox" checked>仓库覆盖圈</label><label class="label-check"><input id="exceptionLayerToggle" type="checkbox" checked>未分配/阻断订单</label>');
    document.getElementById("mapColorModeSelect")?.addEventListener("change", (event) => { state.colorMode = event.target.value; applyColorMode(); });
    document.getElementById("orderHeatToggle")?.addEventListener("change", (event) => { state.heat = event.target.checked; applyVisibility(); });
    document.getElementById("coverageToggle")?.addEventListener("change", (event) => { state.coverage = event.target.checked; applyVisibility(); });
    document.getElementById("exceptionLayerToggle")?.addEventListener("change", (event) => { state.exceptions = event.target.checked; applyVisibility(); });
  }

  function ensureLayers() {
    const map = mapInstance();
    if (!usableMap(map) || !map.loaded()) return false;
    try {
      if (!map.getSource("warehouse-coverage")) map.addSource("warehouse-coverage", { type: "geojson", data: coverageFeature() });
      if (!map.getLayer("warehouse-coverage-fill")) map.addLayer({ id: "warehouse-coverage-fill", type: "fill", source: "warehouse-coverage", paint: { "fill-color": "#00a3e0", "fill-opacity": 0.08 } });
      if (!map.getLayer("warehouse-coverage-line")) map.addLayer({ id: "warehouse-coverage-line", type: "line", source: "warehouse-coverage", paint: { "line-color": "#003b79", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.55 } });
      if (!map.getSource("exception-orders")) map.addSource("exception-orders", { type: "geojson", data: exceptionFeatures() });
      if (!map.getLayer("exception-orders")) map.addLayer({ id: "exception-orders", type: "circle", source: "exception-orders", paint: { "circle-color": "#ef4444", "circle-radius": 7, "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-opacity": 0.95 } });
      if (!map.getSource("order-heat")) map.addSource("order-heat", { type: "geojson", data: data().stopGeoJson || empty() });
      if (!map.getLayer("order-heat")) map.addLayer({ id: "order-heat", type: "heatmap", source: "order-heat", layout: { visibility: "none" }, paint: { "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 0, 0.15, 10, 0.5, 50, 1.3], "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 7, 12, 13, 38], "heatmap-opacity": 0.82, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,163,224,0)", 0.25, "rgba(0,163,224,.55)", 0.55, "rgba(250,204,21,.75)", 0.8, "rgba(239,68,68,.9)", 1, "rgba(127,29,29,1)"] } });
      if (!map.__stctExceptionClick) {
        map.__stctExceptionClick = true;
        map.on("click", "exception-orders", (event) => {
          const properties = event.features?.[0]?.properties || {};
          new maplibregl.Popup().setLngLat(event.lngLat).setHTML(`<div class="popup-title">${esc(properties.name || properties.code || "异常订单")}</div><div class="popup-line">Order ${esc(properties.code || properties.id || "-")}</div><div class="popup-line">原因 ${esc(properties.reason || properties.message || "未分配/阻断")}</div>`).addTo(map);
        });
      }
      applyVisibility();
      applyColorMode();
      setStatus("地图在线", "ok");
      return true;
    } catch (error) {
      console.warn("STCT map extension unavailable", error);
      setStatus("地图图层加载失败；数据与规划功能仍可使用。", "warn");
      return false;
    }
  }

  function refreshSources() {
    const map = mapInstance();
    if (!usableMap(map) || !map.loaded()) return;
    const updates = [["warehouse-coverage", coverageFeature()], ["exception-orders", exceptionFeatures()], ["order-heat", data().stopGeoJson || empty()]];
    updates.forEach(([id, sourceData]) => {
      const source = map.getSource(id);
      if (source && typeof source.setData === "function") source.setData(sourceData);
    });
  }

  function setVisible(id, visible) {
    const map = mapInstance();
    if (usableMap(map) && map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }

  function applyVisibility() {
    setVisible("order-heat", state.heat);
    setVisible("warehouse-coverage-fill", state.coverage);
    setVisible("warehouse-coverage-line", state.coverage);
    setVisible("exception-orders", state.exceptions);
  }

  function colorExpression() {
    if (state.colorMode === "utilization") return ["case", [">=", ["get", "util"], 90], "#dc2626", [">=", ["get", "util"], 70], "#f97316", [">=", ["get", "util"], 40], "#16a34a", "#64748b"];
    return ["get", "color"];
  }

  function applyColorMode() {
    const map = mapInstance();
    if (!usableMap(map) || !map.loaded()) return;
    ["route-lines", "route-glow", "road-route-lines"].forEach((id) => {
      if (map.getLayer(id)) map.setPaintProperty(id, "line-color", colorExpression());
    });
  }

  function previewPlan(plan, attempt = 0) {
    state.previewPlan = plan || null;
    const map = mapInstance();
    if (!usableMap(map) || !map.loaded()) {
      if (attempt < 20) setTimeout(() => previewPlan(state.previewPlan, attempt + 1), 200);
      return false;
    }
    if (!plan) {
      window.STCTCore?.refreshMap?.();
      refreshSources();
      return true;
    }
    const routes = plan.routeGeoJson || empty();
    const stops = plan.stopGeoJson || empty();
    const routeSource = map.getSource("routes");
    const stopSource = map.getSource("stops");
    const heatSource = map.getSource("heat-stops");
    const extensionHeatSource = map.getSource("order-heat");
    const roadSource = map.getSource("road-routes");
    if (routeSource?.setData) routeSource.setData(routes);
    if (stopSource?.setData) stopSource.setData(stops);
    if (heatSource?.setData) heatSource.setData(stops);
    if (extensionHeatSource?.setData) extensionHeatSource.setData(stops);
    if (roadSource?.setData) roadSource.setData(empty());
    const coordinates = (routes.features || []).flatMap((feature) => feature.geometry?.coordinates || []);
    const experienceOwnsCamera = Boolean(map.getContainer?.().closest?.("#experienceRoot"));
    if (coordinates.length && window.maplibregl?.LngLatBounds && !experienceOwnsCamera) {
      const bounds = coordinates.reduce(
        (result, coordinate) => result.extend(coordinate),
        new window.maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
      );
      map.fitBounds(bounds, {
        padding: window.innerWidth <= 900 ? { top: 90, right: 28, bottom: 320, left: 28 } : { top: 90, right: 80, bottom: 80, left: 80 },
        maxZoom: 12.5,
        duration: 500,
        essential: true,
      });
    }
    applyColorMode();
    setStatus(`候选预览 ${plan.planId || plan.scenarioId || ""}`.trim(), "ok");
    return true;
  }

  function install() {
    ensureControls();
    if (ensureLayers()) {
      refreshSources();
      return;
    }
    state.attempts += 1;
    if (state.attempts < 20) setTimeout(install, 300);
    else if (!document.getElementById("mapFallback")) {
      setStatus("地图不可用；请检查本地地图资源与浏览器 WebGL 支持。其他页面仍可使用。", "warn");
    }
  }

  window.STCTMap = { install, refreshSources, applyColorMode, applyVisibility, previewPlan, state, usableMap };
  if (!window.STCT_V8_PLATFORM_ENTRY) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  }
  window.addEventListener("stct:data-applied", () => setTimeout(() => { refreshSources(); applyColorMode(); }, 120));
})();
