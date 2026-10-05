(function () {
  "use strict";

  const state = { batches: [], active: null, busy: false };
  const esc = (value) => window.STCTUtils?.escapeHTML ? window.STCTUtils.escapeHTML(value) : String(value ?? "");
  const csv = (value) => window.STCTUtils?.csvSafe ? window.STCTUtils.csvSafe(value) : `"${String(value ?? "").replace(/"/g, '""')}"`;

  function notify(message, type = "info") {
    let host = document.getElementById("stctToastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "stctToastHost";
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function batchId() {
    return `BATCH-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
  }

  function summarize(data) {
    if (data?.__rawUpload) {
      const raw = data.raw || {};
      return { orders: raw.orders?.length || 0, vehicles: raw.vehicles?.length || 0, depots: raw.depot ? 1 : 0, type: "原始数据" };
    }
    return { orders: data?.stopGeoJson?.features?.length || 0, vehicles: new Set((data?.routes || []).map((route) => route.vehicleId)).size, depots: data?.depot ? 1 : 0, type: "排程结果" };
  }

  function createBatch(data, fileName) {
    const validation = window.STCTValidator.validateUploadData(data);
    const batch = {
      batch_id: batchId(),
      uploadedAt: new Date().toISOString(),
      uploadedAtLabel: new Date().toLocaleString(),
      fileName: fileName || "上传文件",
      status: validation.canApply ? "Preview" : "Blocked",
      data,
      validation,
      ...summarize(data),
    };
    state.batches.unshift(batch);
    state.active = batch;
    window.STCTPlanning?.markPreview(batch.batch_id);
    return batch;
  }

  function downloadText(name, content, type = "text/csv;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function metricsHtml(batch) {
    const metrics = batch?.validation?.metrics;
    if (!metrics?.totalOrders && batch?.data?.__rawUpload) return "";
    if (!metrics?.totalOrders) return "";
    return `<div class="planning-kpi">
      <div><b>可规划率</b><strong>${esc(metrics.plannableRate)}%</strong><span>${esc(metrics.plannableOrders)} / ${esc(metrics.totalOrders)} Orders</span></div>
      <div><b>阻断订单</b><strong>${esc(metrics.blockedOrderRows)}</strong><span>按唯一 Orders 行计数</span></div>
      <div><b>坐标完整率</b><strong>${esc(metrics.coordinateCompleteness)}%</strong><span>有效经纬度</span></div>
      <div><b>车辆主数据错误</b><strong>${esc(metrics.vehicleMasterErrors)}</strong><span>可用 ${esc(metrics.usableVehicles)} Vehicles</span></div>
      <div><b>重复订单</b><strong>${esc(metrics.duplicateOrders)}</strong><span>重复行</span></div>
    </div>`;
  }

  function priorityHtml(batch) {
    const orders = batch?.data?.__rawUpload ? batch.data.raw?.orders || [] : [];
    if (!orders.length || !window.STCTCanonical) return "";
    const summary = { original: {}, weights: {}, unknown: 0, explicit: 0 };
    orders.forEach((order) => {
      const mapped = window.STCTCanonical.priority(order.priority, order.priorityWeight);
      summary.original[mapped.normalized] = (summary.original[mapped.normalized] || 0) + 1;
      summary.weights[mapped.weight] = (summary.weights[mapped.weight] || 0) + 1;
      if (mapped.warning) summary.unknown += 1;
      if (mapped.source === "explicit") summary.explicit += 1;
    });
    return `<div class="card-heading priority-preview"><div><h3>Priority Mapping</h3><p class="mini-note">原始优先级会进入 Canonical Scenario、inputHash 与 OR-Tools 服务层级。</p></div><div class="optimizer-badge">Unknown ${summary.unknown}</div></div><div class="planning-kpi"><div><b>High</b><strong>${summary.original.high || 0}</strong><span>weight 3</span></div><div><b>Medium</b><strong>${summary.original.medium || 0}</strong><span>weight 2</span></div><div><b>Normal</b><strong>${summary.original.normal || 0}</strong><span>weight 1</span></div><div><b>Numeric override</b><strong>${summary.explicit}</strong><span>priorityWeight 显式值</span></div></div>`;
  }

  function validationPanel(batch) {
    if (!batch) return '<div class="upload-status">尚未上传数据。</div>';
    const health = batch.validation.health || { score: 100, error: 0, warning: 0, passed: 0 };
    const rows = (batch.validation.results || []).slice(0, 160).map((row) => `<tr>
      <td><span class="severity ${esc(row.severity).toLowerCase()}">${esc(row.severity)}</span></td>
      <td>${esc(row.category)}</td><td>${esc(row.sheet)}</td><td>${esc(row.row)}</td><td>${esc(row.field)}</td>
      <td>${esc(row.message)}</td><td>${esc(row.suggestion)}</td>
    </tr>`).join("");
    const blocked = batch.validation.blockedOrders?.length || 0;
    const assumptions = batch.data?.raw?.importAssumptions || [];
    const assumptionPanel = assumptions.length ? `<details open class="import-assumptions"><summary>缺省假设 · ${assumptions.length} 项（不含物量、坐标或容量）</summary><ul>${assumptions.slice(0, 30).map(row => `<li>${esc(row.sheet)} ${esc(row.rowNumber ?? '')} · ${esc(row.field)} = ${esc(row.value)}</li>`).join('')}</ul>${assumptions.length > 30 ? `<p>完整 ${assumptions.length} 项保留在原始输入与研究审计中。</p>` : ''}<label><input type="checkbox" id="confirmImportAssumptions" ${batch.data.raw.importAssumptionsConfirmed ? 'checked' : ''}>我确认上述缺省参数仅作为本次测算假设</label></details>` : '';
    return `${metricsHtml(batch)}${priorityHtml(batch)}${assumptionPanel}
      <div class="validation-summary"><div><b>数据健康度</b><strong>${health.score}%</strong></div><div><b>Error</b><strong>${health.error}</strong></div><div><b>Warning</b><strong>${health.warning}</strong></div><div><b>Passed</b><strong>${health.passed}</strong></div></div>
      <div class="mini-note">Error 可表示单行阻断；只要仓库、可用车辆和至少一条可规划订单完整，仍可应用批次。被阻断的 ${blocked} 条订单不会静默消失，会进入规划守恒与异常清单。</div>
      <div class="upload-actions" style="justify-content:flex-start"><button class="primary-btn" id="applyBatchBtn" ${batch.validation.canApply ? "" : "disabled"}>${batch.data?.__rawUpload ? "应用为规划输入" : "应用排程结果"}</button><button class="ghost-btn" id="downloadValidationCsv">下载校验明细 CSV</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>类型</th><th>分类</th><th>Sheet</th><th>行</th><th>字段</th><th>说明</th><th>建议动作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderUpload() {
    const element = document.getElementById("uploadContent");
    if (!element) return;
    const active = state.active;
    const batchRows = state.batches.map((batch) => `<tr class="batch-row ${active?.batch_id === batch.batch_id ? "active" : ""}" data-batch="${esc(batch.batch_id)}"><td>${esc(batch.batch_id)}</td><td>${esc(batch.uploadedAtLabel)}</td><td>${esc(batch.fileName)}</td><td>${esc(batch.status)}</td><td>${esc(batch.orders)}</td><td>${esc(batch.vehicles)}</td><td>${esc(batch.depots)}</td><td>${esc(batch.validation.metrics?.plannableRate ?? batch.validation.health.score)}%</td></tr>`).join("");
    element.innerHTML = `<div class="dash-grid">
      <div class="card span-12"><h3>数据批次管理</h3><div class="upload-box" id="uploadBox"><p><b>拖拽 Excel、JSON 或 routes-data.js 到这里</b>，或选择文件上传</p><p class="muted">支持 .xlsx/.xls、JSON 和 window.FLOWMAP_DATA 格式。上传只创建 Preview，不会立即替换当前方案。</p><input id="uploadFile" type="file" accept=".xlsx,.xls,.js,.json,application/json"><div class="upload-actions"><button class="primary-btn" id="chooseUpload">选择文件</button><button class="ghost-btn" id="loadBundledDemo">加载内置 Demo</button></div></div></div>
      <div class="card span-12"><h3>批次列表</h3><div class="table-wrap"><table class="table"><thead><tr><th>batch_id</th><th>上传时间</th><th>文件名</th><th>状态</th><th>Orders</th><th>Vehicles</th><th>Depots</th><th>可规划率</th></tr></thead><tbody>${batchRows || '<tr><td colspan="8">暂无上传批次</td></tr>'}</tbody></table></div></div>
      <div class="card span-12"><h3>数据校验报告</h3>${validationPanel(active)}</div>
      <div class="card span-12"><h3>数据下载</h3><div class="download-grid">
        <div class="download-card"><b>Data 空白模板</b><p>Orders、Vehicles、Depots、Constraints。</p><button class="ghost-btn" id="downloadTemplate">下载模板</button></div>
        <div class="download-card"><b>Demo 原始数据</b><p>用于 60/120/240 单规划验收。</p><button class="ghost-btn" id="downloadDemoDispatch">下载 Demo</button></div>
        <div class="download-card"><b>当前应用方案</b><p>含来源、时间、假设与守恒信息。</p><button class="ghost-btn" id="downloadCurrent">下载 routes-data.js</button></div>
        <div class="download-card"><b>方案审计 CSV</b><p>Routes、Unassigned 与 Blocked 合并导出。</p><button class="ghost-btn" id="downloadRoutesCsv">下载审计 CSV</button></div>
        <div class="download-card"><b>v1.3 审计快照</b><p>身份、场景、候选比较、验证、What-if 与人工调整。</p><button class="ghost-btn" id="downloadPlanningAudit">下载审计 JSON</button></div>
      </div></div>
    </div>`;

    const fileInput = document.getElementById("uploadFile");
    document.getElementById("chooseUpload")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      fileInput?.click();
    }, true);
    document.getElementById("loadBundledDemo")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      loadBundledDemo();
    }, true);
    if (fileInput) fileInput.onchange = (event) => {
      const file = event.target.files?.[0];
      if (file) handleFile(file);
    };
    const box = document.getElementById("uploadBox");
    if (box) {
      box.ondragover = (event) => { event.preventDefault(); box.classList.add("drag"); };
      box.ondragleave = () => box.classList.remove("drag");
      box.ondrop = (event) => { event.preventDefault(); box.classList.remove("drag"); const file = event.dataTransfer.files?.[0]; if (file) handleFile(file); };
    }
    document.querySelectorAll(".batch-row").forEach((row) => row.addEventListener("click", () => {
      state.active = state.batches.find((batch) => batch.batch_id === row.dataset.batch) || state.active;
      renderUpload();
    }));
    document.getElementById('confirmImportAssumptions')?.addEventListener('change', event => {
      state.active.data.raw.importAssumptionsConfirmed = event.target.checked;
      state.active.validation = window.STCTValidator.validateUploadData(state.active.data);
      state.active.status = state.active.validation.canApply ? 'Preview' : 'Blocked';
      renderUpload();
    });
    document.getElementById("applyBatchBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyActiveBatch();
    }, true);
    document.getElementById("downloadValidationCsv")?.addEventListener("click", () => {
      if (state.active) downloadText(`validation-${state.active.batch_id}.csv`, window.STCTValidator.resultsToCsv(state.active.validation.results));
    });
    document.getElementById("downloadTemplate")?.addEventListener("click", () => downloadAsset("./templates/raw-dispatch-template.xlsx", "Data-Template.xlsx"));
    document.getElementById("downloadDemoDispatch")?.addEventListener("click", () => downloadAsset("./assets/demo/stct-synthetic-demo.json", "stct-synthetic-demo.json"));
    document.getElementById("downloadCurrent")?.addEventListener("click", exportCurrentJs);
    document.getElementById("downloadRoutesCsv")?.addEventListener("click", exportAuditCsv);
    document.getElementById("downloadPlanningAudit")?.addEventListener("click", exportPlanningAuditJson);
  }

  async function handleFile(file) {
    if (state.busy) return;
    state.busy = true;
    notify(`正在解析 ${file.name}`);
    try {
      window.STCTImportBudget.checkFileSize(file);
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      if (isExcel && !window.XLSX) throw new Error("Excel 解析库未加载。请检查网络后重试，或上传 JSON。");
      const parser = window.STCTCore?.parseExcelFile || window.parseExcelFile;
      const textParser = window.STCTCore?.parseUploadedText || window.parseUploadedText;
      const data = isExcel ? await parser(file) : textParser(await file.text());
      createBatch(data, file.name);
      renderUpload();
      notify("解析完成：已进入 Preview，请查看可规划率与阻断明细。", "success");
      setTimeout(renderUpload, 0);
      setTimeout(renderUpload, 80);
    } catch (error) {
      notify(`上传失败：${error.message}`, "error");
    } finally {
      state.busy = false;
    }
  }

  async function loadBundledDemo() {
    if (state.busy) return;
    try {
      const syntheticResponse = await fetch("./assets/demo/stct-synthetic-demo.json", { cache: "no-store" });
      if (syntheticResponse.ok) {
        const synthetic = await syntheticResponse.json();
        createBatch(synthetic.__rawUpload ? synthetic : { __rawUpload: true, raw: synthetic }, "stct-synthetic-demo.json");
        renderUpload();
        notify("完全合成 Demo 已进入 Preview。", "success");
        return;
      }
      throw new Error(`Synthetic Demo 文件返回 HTTP ${syntheticResponse.status}`);
    } catch (error) {
      notify(`加载 Demo 失败：${error.message}`, "error");
    }
  }

  function applyActiveBatch() {
    const batch = state.active;
    if (!batch?.validation?.canApply) {
      notify("当前批次缺少可用仓库、车辆或可规划订单，不能应用。", "error");
      return;
    }
    if (batch.data.__rawUpload) {
      (window.STCTCore?.loadRawData || window.loadRawData)(batch.data.raw);
      window.STCTPlanning?.setRawData(batch.data.raw, batch.batch_id);
      batch.status = "Raw - Awaiting Plan";
      notify("原始数据已应用。请前往排车页生成候选方案。", "success");
    } else {
      (window.STCTCore?.applyPlan || window.applyUploadedData)(batch.data);
      batch.status = "Applied";
      notify("排程结果已应用到地图和看板。", "success");
    }
    renderUpload();
  }

  function downloadAsset(href, name) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    anchor.click();
  }

  function exportMetadata(data) {
    const assumptions = window.STCTOptimizer?.assumptions?.(window.STCTPlanning?.state?.raw || window.RAW_DATA) || {};
    const selected = window.STCTPlanning?.currentCandidate?.();
    return {
      exportedAt: new Date().toISOString(),
      source: data?.meta?.source || "current applied data",
      batchId: data?.meta?.batchId || window.STCTPlanning?.state?.batchId || "BUILTIN",
      scenarioId: data?.scenarioId || data?.meta?.scenarioId || selected?.scenarioId || "",
      inputHash: data?.inputHash || data?.meta?.inputHash || selected?.inputHash || "",
      inputFingerprint: data?.meta?.inputFingerprint || selected?.meta?.inputFingerprint || "",
      planId: data?.planId || data?.meta?.planId || selected?.planId || "",
      planFingerprint: data?.fingerprint || data?.meta?.planFingerprint || selected?.fingerprint || "",
      labels: data?.meta?.selectedAs || selected?.labels || [],
      engine: data?.engine || data?.meta?.engine || selected?.engine || "built-in",
      goal: data?.meta?.goal || selected?.meta?.goal || "",
      verification: data?.verification || selected?.verification || null,
      assumptions,
      conservation: data?.conservation || selected?.conservation || null,
    };
  }

  function buildCurrentJs(data = window.STCTCore?.getData?.() || window.DATA || {}) {
    const payload = { ...data, exportMeta: exportMetadata(data), planningAudit: window.STCTPlanning?.exportSnapshot?.() || null };
    return `// Local Demo export. Review before reuse.\nwindow.FLOWMAP_DATA = ${JSON.stringify(payload, null, 2)};\n`;
  }

  function exportCurrentJs() {
    downloadText("routes-data-export.js", buildCurrentJs(), "text/javascript;charset=utf-8");
  }

  function buildPlanningAuditJson(snapshot = window.STCTPlanning?.exportSnapshot?.()) {
    if (!snapshot?.scenario) {
      throw new Error("请先生成候选方案后再导出审计快照。");
    }
    return JSON.stringify(snapshot, null, 2);
  }

  function exportPlanningAuditJson() {
    try {
      downloadText("planning-audit-v1.4.json", buildPlanningAuditJson(), "application/json;charset=utf-8");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function buildAuditCsv(data = window.STCTCore?.getData?.() || window.DATA || {}, snapshot = window.STCTPlanning?.exportSnapshot?.() || {}) {
    const meta = exportMetadata(data);
    const headers = ["recordType", "id", "routeId", "vehicleId", "orders", "stops", "packages", "volume", "km", "end", "volumeUtil", "assigned", "unassigned", "usedVehicles", "estimatedRoadKm", "totalCost", "totalCO2", "utilizationScore", "balancedScore", "reasonCode", "reasonCategory", "reason", "suggestion", "labels", "verificationStatus", "scenarioId", "inputHash", "planId", "planFingerprint", "source", "engine", "goal", "batchId", "inputFingerprint", "exportedAt"];
    const rows = [];
    (data.routes || []).forEach((route) => rows.push({ recordType: "Route", id: route.routeId, ...route }));
    (data.unassignedOrders || []).forEach((order) => rows.push({ recordType: "Unassigned", id: order.id || order.code, ...order }));
    (data.blockedOrders || []).forEach((order) => rows.push({ recordType: "Blocked", id: order.id || order.code, ...order }));
    (snapshot.candidateComparison || []).forEach((candidate) => rows.push({
      recordType: "Candidate",
      id: candidate.planId,
      planId: candidate.planId,
      planFingerprint: candidate.fingerprint,
      labels: JSON.stringify(candidate.labels || []),
      verificationStatus: candidate.verification?.status,
      ...(candidate.metrics || {}),
    }));
    (snapshot.manualAdjustmentAudit || []).forEach((action, index) => rows.push({ recordType: "ManualAction", id: index + 1, reason: JSON.stringify(action) }));
    (snapshot.whatIfDelta || []).forEach((result) => rows.push({ recordType: "WhatIf", id: result.id, reason: JSON.stringify(result.delta || {}), ...(result.metrics || {}) }));
    const common = { scenarioId: meta.scenarioId, inputHash: meta.inputHash, planId: meta.planId, planFingerprint: meta.planFingerprint, labels: JSON.stringify(meta.labels || []), verificationStatus: meta.verification?.status || "", source: meta.source, engine: meta.engine, goal: meta.goal, batchId: meta.batchId, inputFingerprint: meta.inputFingerprint, exportedAt: meta.exportedAt };
    const body = rows.map((row) => headers.map((header) => csv(row[header] ?? common[header])).join(",")).join("\n");
    const comments = [`# distanceModel=${meta.assumptions.distanceModel || "unknown"}`, `# roadDistanceFactor=${meta.assumptions.roadDistanceFactor ?? "unknown"}`, `# conservation=${JSON.stringify(meta.conservation || {})}`, `# objectiveDefinitions=${JSON.stringify(snapshot.objectiveDefinitions || [])}`].join("\n");
    return `${comments}\n${headers.join(",")}\n${body}`;
  }

  function exportAuditCsv() {
    downloadText("plan-audit.csv", buildAuditCsv());
  }

  window.STCTUpload = { state, createBatch, renderUpload, handleFile, loadBundledDemo, applyActiveBatch, notify, buildCurrentJs, buildAuditCsv, buildPlanningAuditJson, exportCurrentJs, exportAuditCsv, exportPlanningAuditJson };
  window.renderUpload = renderUpload;
})();
