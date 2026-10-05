(function () {
  "use strict";

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  function number(value) {
    if (!hasValue(value)) return NaN;
    return Number(String(value).replace(/,/g, ""));
  }

  function finite(value) {
    return Number.isFinite(number(value));
  }

  function timeToMinutes(value) {
    if (!hasValue(value)) return null;
    if (typeof value === "number" && value >= 0 && value < 1) return Math.round(value * 1440);
    const raw = String(value).trim().replace("：", ":");
    const match = raw.match(/^(次日\s*)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    if (hour > 23 || minute > 59) return null;
    return (match[1] ? 1440 : 0) + hour * 60 + minute;
  }

  function issue(severity, category, sheet, row, field, message, suggestion, entityId, blocking) {
    return { severity, category, sheet, row, field, message, suggestion, entityId: entityId || "", blocking: Boolean(blocking) };
  }

  function addPassed(results, category, message) {
    results.push(issue("Passed", category, "-", "-", "-", message, "-"));
  }

  function normalizeCoordinate(order) {
    let lon = number(order?.lon);
    let lat = number(order?.lat);
    let swapped = false;
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 60 && Math.abs(lat) > 60) {
      [lon, lat] = [lat, lon];
      swapped = true;
    }
    return { lon, lat, swapped, valid: Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 };
  }

  function maxVehicleVolume(vehicles) {
    return (vehicles || []).reduce((max, vehicle) => Math.max(max, number(vehicle.maxVolume) || 0), 0);
  }

  function validateOrders(orders, vehicles) {
    const results = [];
    const blocked = new Map();
    const warningRows = new Set();
    const seen = new Map();
    const required = ["id", "date", "code", "name", "count", "volume", "twStart", "twEnd"];
    const maxVolume = maxVehicleVolume(vehicles);
    let coordinateComplete = 0;
    let duplicateOrders = 0;

    function addOrderIssue(order, index, severity, category, field, message, suggestion, blocking) {
      const row = order?.source?.rowNumber || index + 2;
      const entityId = String(order?.id || order?.code || `Orders:${row}`);
      results.push(issue(severity, category, order?.source?.sheet || "Orders", row, field, message, suggestion, entityId, blocking));
      if (blocking) {
        const entry = blocked.get(index) || { row, entityId, order, reasons: [] };
        entry.reasons.push(message);
        blocked.set(index, entry);
      }
      if (severity === "Warning") warningRows.add(index);
    }

    (orders || []).forEach((order, index) => {
      required.forEach((field) => {
        if (!hasValue(order?.[field])) addOrderIssue(order, index, "Error", "缺字段", field, `缺少必要字段 ${field}`, "补充字段后重新上传", true);
      });

      ["count", "volume"].forEach((field) => {
        if (hasValue(order?.[field]) && !finite(order[field])) addOrderIssue(order, index, "Error", "字段格式", field, `${field} 必须是数字`, "修正为数字格式", true);
      });
      for (const field of ['weight', 'count', 'serviceMin']) if (hasValue(order?.[field]) && (!finite(order[field]) || number(order[field]) < 0)) addOrderIssue(order, index, "Error", "字段格式", field, `${field} 必须是非负数字，原值不会自动修改`, "核对原始数据后重新上传", true);

      const coord = normalizeCoordinate(order);
      if (coord.valid) coordinateComplete += 1;
      else addOrderIssue(order, index, "Error", "缺失或无效坐标", "lat/lon", "订单坐标缺失或超出有效范围，不能进入路线规划", "补充正确经纬度", true);
      if (coord.swapped) addOrderIssue(order, index, "Warning", "坐标疑似写反", "lat/lon", "系统识别为经纬度写反并将在规划时自动纠正", "核对源数据字段映射", false);

      const id = String(order?.id || "").trim();
      if (id) {
        if (seen.has(id)) {
          duplicateOrders += 1;
          addOrderIssue(order, index, "Error", "订单 ID 重复", "id", `订单 ID ${id} 与第 ${seen.get(id) + 2} 行重复`, "保持订单 ID 唯一", true);
        } else seen.set(id, index);
      }

      const start = timeToMinutes(order?.twStart);
      const end = timeToMinutes(order?.twEnd);
      if (hasValue(order?.twStart) && start === null) addOrderIssue(order, index, "Error", "时间窗错误", "twStart", "时间窗开始格式错误", "使用 HH:mm 或 次日 HH:mm", true);
      if (hasValue(order?.twEnd) && end === null) addOrderIssue(order, index, "Error", "时间窗错误", "twEnd", "时间窗结束格式错误", "使用 HH:mm 或 次日 HH:mm", true);
      if (start !== null && end !== null && end <= start && String(order?.twEnd || "").includes("次日")) {
        addOrderIssue(order, index, "Warning", "跨日时间窗", "twStart/twEnd", "已识别显式次日时间窗", "无需处理", false);
      }

      const volume = number(order?.volume);
      if (Number.isFinite(volume) && volume <= 0) addOrderIssue(order, index, "Error", "容积错误", "volume", "订单容积必须大于 0", "修正订单容积", true);
      if (Number.isFinite(volume) && maxVolume > 0 && volume > maxVolume) addOrderIssue(order, index, "Error", "单票超所有车辆容积", "volume", "订单容积超过所有车辆最大容积", "拆单或增加大容积车辆", true);
      if (!hasValue(order?.priority)) addOrderIssue(order, index, "Warning", "优先级缺失", "priority", "未填写优先级，系统按 normal 处理", "需要优先配送时填写 high", false);
    });

    if ((orders || []).length) addPassed(results, "Orders 行数", `Orders 已读取 ${(orders || []).length} 行`);
    if (seen.size === (orders || []).length) addPassed(results, "订单 ID 唯一", "订单 ID 未发现重复");
    return { results, blocked: [...blocked.values()], warningRows, coordinateComplete, duplicateOrders };
  }

  function validateVehicles(vehicles) {
    const results = [];
    const invalidRows = new Set();
    const seen = new Map();
    const required = ["vehicleId", "vehicleName", "maxVolume", "start", "end"];

    (vehicles || []).forEach((vehicle, index) => {
      const row = index + 2;
      const entityId = String(vehicle?.vehicleId || `Vehicles:${row}`);
      const add = (severity, category, field, message, suggestion, blocking) => {
        results.push(issue(severity, category, "Vehicles", row, field, message, suggestion, entityId, blocking));
        if (blocking) invalidRows.add(index);
      };
      required.forEach((field) => {
        if (!hasValue(vehicle?.[field])) add("Error", "缺字段", field, `缺少必要字段 ${field}`, "补充车辆主数据", true);
      });
      if (hasValue(vehicle?.maxVolume) && (!finite(vehicle.maxVolume) || number(vehicle.maxVolume) <= 0)) add("Error", "车辆容积错误", "maxVolume", "最大容积必须是大于 0 的数字", "修正车辆容积", true);
      if (hasValue(vehicle?.maxWeight) && (!finite(vehicle.maxWeight) || number(vehicle.maxWeight) <= 0)) add("Warning", "可选车辆载重错误", "maxWeight", "maxWeight 无效，本项目将忽略重量约束", "留空或修正为正数", false);
      const id = String(vehicle?.vehicleId || "").trim();
      if (id) {
        if (seen.has(id)) add("Error", "车辆 ID 重复", "vehicleId", `车辆 ID ${id} 与第 ${seen.get(id) + 2} 行重复`, "保持车辆 ID 唯一", true);
        else seen.set(id, index);
      }
      const start = timeToMinutes(vehicle?.start);
      const end = timeToMinutes(vehicle?.end);
      if (hasValue(vehicle?.start) && start === null) add("Error", "车辆时间错误", "start", "车辆开始时间格式错误", "使用 HH:mm 或 次日 HH:mm", true);
      if (hasValue(vehicle?.end) && end === null) add("Error", "车辆时间错误", "end", "车辆结束时间格式错误", "使用 HH:mm 或 次日 HH:mm", true);
      if (!hasValue(vehicle?.availableDate)) add("Warning", "可用日期缺失", "availableDate", "未填写可用日期，将按所有日期可用处理", "如车辆不是每天可用，请填写日期", false);
    });

    if ((vehicles || []).length) addPassed(results, "Vehicles 行数", `Vehicles 已读取 ${(vehicles || []).length} 行`);
    if (seen.size === (vehicles || []).length) addPassed(results, "车辆 ID 唯一", "车辆 ID 未发现重复");
    return { results, invalidRows, usableVehicles: Math.max(0, (vehicles || []).length - invalidRows.size) };
  }

  function validateDepot(depot) {
    const results = [];
    let valid = Boolean(depot);
    if (!depot) return { valid: false, results: [issue("Error", "仓库缺失", "Depots", "-", "-", "缺少仓库数据", "补充 Depots 工作表", "Depots", true)] };
    ["code", "name", "lat", "lon"].forEach((field) => {
      if (!hasValue(depot[field])) {
        valid = false;
        results.push(issue("Error", "缺字段", "Depots", 2, field, `缺少必要字段 ${field}`, "补充仓库主数据", String(depot.code || "Depots"), true));
      }
    });
    if (!normalizeCoordinate(depot).valid) {
      valid = false;
      results.push(issue("Error", "仓库坐标错误", "Depots", 2, "lat/lon", "仓库坐标缺失或超出有效范围", "检查仓库坐标", String(depot.code || "Depots"), true));
    }
    if (!hasValue(depot.addr)) results.push(issue("Warning", "仓库地址缺失", "Depots", 2, "addr", "未填写仓库地址", "补充仓库地址便于汇报", String(depot.code || "Depots"), false));
    if (valid) addPassed(results, "Depots", "仓库数据已读取");
    return { valid, results };
  }

  function validateConstraints(constraints) {
    const results = [];
    const values = constraints || {};
    if (hasValue(values.averageSpeedKmh) && (!finite(values.averageSpeedKmh) || number(values.averageSpeedKmh) <= 0)) results.push(issue("Error", "约束格式", "Constraints", 2, "averageSpeedKmh", "averageSpeedKmh 必须是大于 0 的数字", "填写合理平均车速", "Constraints", true));
    if (!hasValue(values.averageSpeedKmh)) results.push(issue("Warning", "约束缺失", "Constraints", 2, "averageSpeedKmh", "未填写平均车速，将使用配置默认值", "需要时补充约束", "Constraints", false));
    addPassed(results, "Constraints", "约束数据已读取");
    return results;
  }

  function health(results) {
    const error = results.filter((row) => row.severity === "Error").length;
    const warning = results.filter((row) => row.severity === "Warning").length;
    const passed = results.filter((row) => row.severity === "Passed").length;
    const total = error + warning + passed;
    const score = total ? Math.max(0, Math.round(((passed + warning * 0.45) / total) * 100)) : 100;
    return { score, error, warning, passed, total };
  }

  function validateRaw(raw) {
    const structural = [];
    if (!raw) structural.push(issue("Error", "文件结构", "Workbook", "-", "-", "上传文件未包含可识别的数据", "检查工作表与字段映射", "Workbook", true));
    if (!Array.isArray(raw?.orders) || !raw.orders.length) structural.push(issue("Error", "Orders 缺失", "Orders", "-", "-", "Orders 缺失或没有订单", "补充订单数据", "Orders", true));
    if (!Array.isArray(raw?.vehicles) || !raw.vehicles.length) structural.push(issue("Error", "Vehicles 缺失", "Vehicles", "-", "-", "Vehicles 缺失或没有车辆", "补充车辆数据", "Vehicles", true));

    const orderCheck = validateOrders(raw?.orders || [], raw?.vehicles || []);
    const vehicleCheck = validateVehicles(raw?.vehicles || []);
    const depotCheck = validateDepot(raw?.depot);
    const constraintIssues = validateConstraints(raw?.constraints);
    if (raw?.importAssumptions?.length && !raw.importAssumptionsConfirmed) structural.push(issue('Error', '缺省假设待确认', 'Workbook', '-', 'importAssumptions', '本文件有缺省参数，请核对下方假设后明确确认；物量、坐标和车辆容量不会填默认值', '确认列出的时间窗、服务时间及平均速度，或补充原文件', '', true));
    const results = structural.concat(orderCheck.results, vehicleCheck.results, depotCheck.results, constraintIssues);
    const h = health(results);
    const totalOrders = raw?.orders?.length || 0;
    const blockedOrderRows = orderCheck.blocked.length;
    const plannableOrders = Math.max(0, totalOrders - blockedOrderRows);
    const warningOrderRows = orderCheck.warningRows.size;
    const metrics = {
      totalOrders,
      plannableOrders,
      blockedOrderRows,
      warningOrderRows,
      plannableRate: totalOrders ? Number((plannableOrders / totalOrders * 100).toFixed(1)) : 0,
      coordinateCompleteness: totalOrders ? Number((orderCheck.coordinateComplete / totalOrders * 100).toFixed(1)) : 0,
      duplicateOrders: orderCheck.duplicateOrders,
      vehicleMasterErrors: vehicleCheck.invalidRows.size,
      usableVehicles: vehicleCheck.usableVehicles,
    };
    const canApply = structural.length === 0 && !constraintIssues.some(row => row.blocking) && depotCheck.valid && vehicleCheck.usableVehicles > 0 && plannableOrders > 0;
    return {
      valid: h.error === 0,
      canApply,
      results,
      errors: results.filter((row) => row.severity === "Error").map((row) => row.message),
      warnings: results.filter((row) => row.severity === "Warning").map((row) => row.message),
      passed: results.filter((row) => row.severity === "Passed").map((row) => row.message),
      health: h,
      metrics,
      blockedOrders: orderCheck.blocked,
      summary: { Orders: totalOrders, Vehicles: raw?.vehicles?.length || 0, Depots: raw?.depot ? 1 : 0, Constraints: raw?.constraints ? 1 : 0 },
    };
  }

  function validatePlan(data) {
    const results = [];
    if (!Array.isArray(data?.routes)) results.push(issue("Error", "路线结果缺失", "Routes", "-", "routes", "路线结果缺少 routes", "上传排车结果或先执行排车", "Routes", true));
    if (!data?.routeGeoJson?.features) results.push(issue("Error", "地图路线数据缺失", "Routes", "-", "routeGeoJson", "缺少路线 GeoJSON", "重新生成规划结果", "Routes", true));
    if (!data?.stopGeoJson?.features) results.push(issue("Error", "地图停靠点数据缺失", "Stops", "-", "stopGeoJson", "缺少停靠点 GeoJSON", "重新生成规划结果", "Stops", true));
    const conservation = data?.conservation;
    if (conservation && conservation.input !== conservation.assigned + conservation.unassigned + conservation.blocked) results.push(issue("Error", "订单守恒失败", "Plan", "-", "conservation", "输入订单与已分配、未分配、阻断订单不守恒", "禁止应用并重新生成方案", "Plan", true));
    if (Array.isArray(data?.routes)) addPassed(results, "Routes 行数", `Routes 已读取 ${data.routes.length} 条`);
    const h = health(results);
    return { valid: h.error === 0, canApply: h.error === 0, results, errors: results.filter((row) => row.severity === "Error").map((row) => row.message), warnings: results.filter((row) => row.severity === "Warning").map((row) => row.message), passed: results.filter((row) => row.severity === "Passed").map((row) => row.message), health: h, metrics: data?.conservation || {}, summary: { Routes: data?.routes?.length || 0, Stops: data?.stopGeoJson?.features?.length || 0, Days: data?.daySummaries?.length || 0 } };
  }

  function validateUploadData(data) {
    return data?.__rawUpload ? validateRaw(data.raw) : validatePlan(data);
  }

  function csvSafe(value) {
    let text = String(value ?? "");
    if (typeof value === "string" && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r]/.test(text))) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function resultsToCsv(results) {
    const headers = ["severity", "category", "sheet", "row", "field", "entityId", "message", "suggestion"];
    return `${headers.join(",")}\n${(results || []).map((row) => headers.map((header) => csvSafe(row[header])).join(",")).join("\n")}`;
  }

  function cloneUploadData(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  window.STCTUtils = { escapeHTML, csvSafe, clone: cloneUploadData, timeToMinutes, normalizeCoordinate };
  window.STCTValidator = { validateUploadData, validateRaw, validateOrders, validateVehicles, validateDepot, validateConstraints, validatePlan, resultsToCsv, sanitizeUploadData: cloneUploadData };
})();
