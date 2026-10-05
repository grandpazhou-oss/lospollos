let DATA = window.FLOWMAP_DATA;
if (!DATA || !DATA.routes) {
  document.addEventListener("DOMContentLoaded", () => {
    const msg =
      '<div style="padding:24px;color:#b91c1c;font-weight:700">数据文件未加载，请确认 data/routes-data.js 与 index.html 在同一目录结构下。</div>';
    [
      "metrics",
      "routeList",
      "overviewContent",
      "analysisContent",
      "carbonContent",
      "uploadContent",
      "exceptionsContent",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = msg;
    });
  });
  throw new Error("FLOWMAP_DATA is not loaded");
}
const APP_CONFIG = window.STCT_CONFIG || {};
const escapeHTML = (window.STCTUtils && window.STCTUtils.escapeHTML) ||
  function (v) {
    return String(v ?? "").replace(
      /[&<>"']/g,
      (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch] || ch),
    );
  };
DATA = (window.STCTValidator && window.STCTValidator.sanitizeUploadData)
  ? window.STCTValidator.sanitizeUploadData(DATA)
  : DATA;
window.DATA = DATA;
const DEMO_USERS = [{ user: "demo", pass: "demo123", name: "Mock User" }, {
  user: "admin",
  pass: "admin123",
  name: "管理员",
}];
let AUTH_OK = false;
function readAuth() {
  return AUTH_OK;
}
function writeAuth(userName) {
  AUTH_OK = true;
}
function clearAuth() {
  AUTH_OK = false;
}
function setAuthUI(force) {
  const ok = typeof force === "boolean" ? force : readAuth();
  const login = document.getElementById("loginScreen");
  const app = document.querySelector(".app");
  if (login) login.style.display = ok ? "none" : "grid";
  if (app) app.classList.toggle("locked", !ok);
}
function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const u = document.getElementById("loginUser").value.trim();
  const p = document.getElementById("loginPass").value;
  const found = DEMO_USERS.find((x) => x.user === u && x.pass === p);
  if (found) {
    writeAuth(found.name);
    setAuthUI(true);
    setTimeout(() => {
      if (map && typeof map.resize === "function") map.resize();
    }, 120);
  } else document.getElementById("loginError").textContent = "账户或密码不正确";
  return false;
}
window.__loginNow = handleLoginSubmit;
window.__logoutNow = () => {
  clearAuth();
  setAuthUI(false);
};
document.addEventListener("DOMContentLoaded", () => {
  const lu = document.getElementById("loginUser"),
    lp = document.getElementById("loginPass");
  if (lu && !lu.value) lu.value = "demo";
  if (lp && !lp.value) lp.value = "demo123";
  const form = document.getElementById("loginForm");
  if (form) form.addEventListener("submit", handleLoginSubmit);
  ["loginLang"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const lang = typeof currentLang !== "undefined"
        ? currentLang
        : getSavedLang();
      el.value = lang;
      el.addEventListener("change", (e) => {
        if (typeof applyLanguage === "function") applyLanguage(e.target.value);
        if (!window.STCT_V8_PLATFORM_ENTRY && typeof renderAllDashboards === "function") renderAllDashboards();
        if (typeof applyLanguage === "function") applyLanguage(e.target.value);
      });
    }
  });
  setAuthUI();
  if (typeof applyLanguage === "function") {
    applyLanguage(
      typeof currentLang !== "undefined" ? currentLang : getSavedLang(),
    );
  }
  const logout = document.getElementById("logoutBtn");
  if (logout) {
    logout.addEventListener("click", () => {
      clearAuth();
      setAuthUI(false);
    });
  }
});
const I18N = {
  zh: {
    "客户演示登录": "客户演示登录",
    "账户": "账户",
    "密码": "密码",
    "请输入账户": "请输入账户",
    "请输入密码": "请输入密码",
    "登录系统": "登录系统",
    "演示账号：": "演示账号：",
    "演示密码：": "演示密码：",
    "说明：LOGISTEED 风格前端演示，不用于正式安全认证。":
      "说明：LOGISTEED 风格前端演示，不用于正式安全认证。",
    "路线": "路线",
    "总览": "总览",
    "分析": "分析",
    "碳排": "碳排",
    "数据": "数据",
    "异常": "异常",
    "返回": "返回",
    "退出": "退出",
    "筛选条件": "筛选条件",
    "清除": "清除",
    "配送日": "配送日",
    "车辆": "车辆",
    "路线选择": "路线选择",
    "显示选项": "显示选项",
    "显示缺坐标提示": "显示缺坐标提示",
    "显示拆分装载提示": "显示拆分装载提示",
    "图例": "图例",
    "拆分装载": "拆分装载",
    "仓库": "仓库",
    "缺坐标": "缺坐标",
    "路线详情": "路线详情",
    "请选择路线或配送点查看到达时间、货量与车辆信息。":
      "请选择路线或配送点查看到达时间、货量与车辆信息。",
    "供应链配送总览": "供应链配送总览",
    "运营效率分析": "运营效率分析",
    "Sustainability Dashboard": "ESG 仪表板",
    "数据中心": "数据中心",
    "异常与数据质量": "异常与数据质量",
    "总览日期": "总览日期",
    "分析日期": "分析日期",
    "排序口径": "排序口径",
    "统计日期": "统计日期",
    "车型/车辆": "车型/车辆",
    "利用率": "利用率",
    "距离": "距离",
    "排放因子": "排放因子",
    "全部": "全部",
    "全部日期": "全部日期",
    "全部路线": "全部路线",
    "全部车辆": "全部车辆",
    "全部车型/车辆": "全部车型/车辆",
    "选择文件": "选择文件",
    "下载模板": "下载模板",
    "下载路线CSV": "下载路线CSV",
    "下载异常CSV": "下载异常CSV",
    "下载碳排CSV": "下载碳排CSV",
  },
  ja: {
    "客户演示登录": "顧客デモログイン",
    "账户": "アカウント",
    "密码": "パスワード",
    "请输入账户": "アカウントを入力",
    "请输入密码": "パスワードを入力",
    "登录系统": "ログイン",
    "演示账号：": "デモアカウント：",
    "演示密码：": "デモパスワード：",
    "说明：LOGISTEED 风格前端演示，不用于正式安全认证。":
      "注：LOGISTEED風のフロントエンドデモです。正式な認証には使用しません。",
    "路线": "ルート",
    "总览": "概要",
    "分析": "分析",
    "碳排": "CO₂",
    "数据": "データ",
    "异常": "例外",
    "返回": "戻る",
    "退出": "ログアウト",
    "筛选条件": "フィルター",
    "清除": "クリア",
    "配送日": "配送日",
    "车辆": "車両",
    "路线选择": "ルート選択",
    "显示选项": "表示オプション",
    "显示缺坐标提示": "座標未設定を表示",
    "显示拆分装载提示": "分割積載を表示",
    "图例": "凡例",
    "拆分装载": "分割積載",
    "仓库": "倉庫",
    "缺坐标": "座標なし",
    "路线详情": "ルート詳細",
    "请选择路线或配送点查看到达时间、货量与车辆信息。":
      "ルートまたは配送先を選択すると、到着時刻・貨物量・車両情報を確認できます。",
    "供应链配送总览": "サプライチェーン配送概要",
    "以 LOGISTEED Smart Logistics 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
      "LOGISTEED Smart Logisticsの視点で、サービス範囲・輸送効率・例外リスク・低炭素指標を表示します。",
    "运营效率分析": "運用効率分析",
    "围绕 3PL 运营、车辆利用、配送密度和完成时间，为调度与客户汇报提供可执行洞察。":
      "3PL運用、車両利用、配送密度、完了時刻をもとに、配車と顧客報告に使える示唆を提示します。",
    "Sustainability Dashboard": "Sustainability Dashboard",
    "ESG 仪表板": "ESGダッシュボード",
    "基于估算行驶距离生成 CO₂ 报表，支持低碳物流汇报与持续改善。":
      "推定走行距離からCO₂レポートを生成し、低炭素物流の報告と改善を支援します。",
    "数据中心": "データセンター",
    "连接订单、车辆、仓库与约束数据：上传新批次、下载模板、导出当前数据与分析明细。":
      "注文・車両・拠点・制約データ連携：新規バッチのアップロード、テンプレート取得、分析データの出力。",
    "异常与数据质量": "例外・データ品質",
    "沉淀排车前置问题：缺坐标、拆分装载、超容量、时间窗冲突等，回流主数据治理。":
      "座標欠落、分割積載、容量超過、時間枠衝突などを蓄積し、マスターデータ改善に戻します。",
    "总览日期": "概要日付",
    "分析日期": "分析日付",
    "排序口径": "並び替え",
    "统计日期": "集計日付",
    "车型/车辆": "車型/車両",
    "利用率": "利用率",
    "距离": "距離",
    "排放因子": "排出係数",
    "全部": "すべて",
    "全部日期": "全日付",
    "全部路线": "全ルート",
    "全部车辆": "全車両",
    "全部车型/车辆": "全車型/車両",
    "选择文件": "ファイル選択",
    "下载模板": "テンプレート取得",
    "下载路线CSV": "ルートCSV取得",
    "下载异常CSV": "例外CSV取得",
    "下载碳排CSV": "CO₂ CSV取得",
    "配送批次": "配送バッチ",
    "货物件数": "貨物数",
    "行驶距离": "走行距離",
    "最晚回库": "最終帰庫",
    "车辆利用率": "車両利用率",
    "已选路线": "選択ルート",
    "配送日": "配送日",
    "统计范围": "集計範囲",
    "路线 / 车辆": "ルート / 車両",
    "路线数 / 使用车辆": "ルート数 / 使用車両",
    "地图停靠批次": "地図上の停車バッチ",
    "计划核对件数": "計画貨物数",
    "估算行驶距离": "推定走行距離",
    "平均容积利用率": "平均容積利用率",
    "平均载重利用率": "平均重量利用率",
    "估算碳排": "推定CO₂",
    "全维度概览": "全体概要",
    "数据健康度": "データ健全性",
    "智能洞察与建议": "スマート示唆・提案",
    "改善方向": "改善方向",
  },
  en: {
    "客户演示登录": "Customer demo login",
    "账户": "Account",
    "密码": "Password",
    "请输入账户": "Enter account",
    "请输入密码": "Enter password",
    "登录系统": "Log in",
    "演示账号：": "Demo account: ",
    "演示密码：": "Demo password: ",
    "说明：LOGISTEED 风格前端演示，不用于正式安全认证。":
      "Note: LOGISTEED-style front-end demo. Not for production authentication.",
    "路线": "Routes",
    "总览": "Overview",
    "分析": "Analysis",
    "碳排": "CO₂",
    "数据": "Data",
    "异常": "Issues",
    "返回": "Back",
    "退出": "Logout",
    "筛选条件": "Filters",
    "清除": "Clear",
    "配送日": "Delivery date",
    "车辆": "Vehicle",
    "路线选择": "Route selection",
    "显示选项": "Display options",
    "显示缺坐标提示": "Show missing coordinates",
    "显示拆分装载提示": "Show split-load hints",
    "图例": "Legend",
    "拆分装载": "Split load",
    "仓库": "Depot",
    "缺坐标": "Missing coords",
    "路线详情": "Route details",
    "请选择路线或配送点查看到达时间、货量与车辆信息。":
      "Select a route or stop to view arrival time, cargo volume and vehicle details.",
    "供应链配送总览": "Supply Chain Delivery Overview",
    "以 LOGISTEED Smart Logistics 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
      "View service coverage, transport efficiency, exception risk and low-carbon indicators through a LOGISTEED Smart Logistics lens.",
    "运营效率分析": "Operational Efficiency Analysis",
    "围绕 3PL 运营、车辆利用、配送密度和完成时间，为调度与客户汇报提供可执行洞察。":
      "Actionable insights for dispatching and customer reporting across 3PL operations, vehicle utilization, delivery density and completion time.",
    "Sustainability Dashboard": "Sustainability Dashboard",
    "基于估算行驶距离生成 CO₂ 报表，支持低碳物流汇报与持续改善。":
      "Generate CO₂ reports from estimated travel distance to support low-carbon logistics reporting and continuous improvement.",
    "数据中心": "Data Center",
    "连接订单、车辆、仓库与约束数据：上传新批次、下载模板、导出当前数据与分析明细。":
      "Connect order, vehicle, depot and constraint data: upload batches, download templates, and export current data and analysis details.",
    "异常与数据质量": "Exceptions & Data Quality",
    "沉淀排车前置问题：缺坐标、拆分装载、超容量、时间窗冲突等，回流主数据治理。":
      "Capture planning issues such as missing coordinates, split loads, capacity excess and time-window conflicts for master-data improvement.",
    "总览日期": "Overview date",
    "分析日期": "Analysis date",
    "排序口径": "Sort by",
    "统计日期": "Reporting date",
    "车型/车辆": "Vehicle type / vehicle",
    "利用率": "Utilization",
    "距离": "Distance",
    "排放因子": "Emission factor",
    "全部": "All",
    "全部日期": "All dates",
    "全部路线": "All routes",
    "全部车辆": "All vehicles",
    "全部车型/车辆": "All vehicles",
    "选择文件": "Choose file",
    "下载模板": "Download template",
    "下载路线CSV": "Download route CSV",
    "下载异常CSV": "Download issue CSV",
    "下载碳排CSV": "Download CO₂ CSV",
    "配送批次": "Delivery batches",
    "货物件数": "Packages",
    "行驶距离": "Travel distance",
    "最晚回库": "Latest return",
    "车辆利用率": "Vehicle utilization",
    "已选路线": "Selected routes",
    "统计范围": "Scope",
    "路线 / 车辆": "Routes / Vehicles",
    "路线数 / 使用车辆": "Routes / vehicles used",
    "地图停靠批次": "Mapped stop batches",
    "计划核对件数": "Planned package count",
    "估算行驶距离": "Estimated travel distance",
    "平均容积利用率": "Avg. volume utilization",
    "平均载重利用率": "Avg. weight utilization",
    "估算碳排": "Estimated CO₂",
    "全维度概览": "Full overview",
    "数据健康度": "Data health",
    "智能洞察与建议": "Smart insights & recommendations",
    "改善方向": "Improvement actions",
  },
};
Object.assign(I18N.zh, {
  "Sustainability Dashboard": "可持续发展仪表盘",
  "上传计划数据": "上传计划数据",
  "拖拽文件到这里": "拖拽文件到这里",
  "，或选择文件上传": "，或选择文件上传",
  "支持 ": "支持 ",
  " 或纯 JSON。支持 Data（Orders / Vehicles / Depots / Constraints）或已排程结果（Route Plan / Vehicle Summary）。":
    " 或纯 JSON。支持 Data（Orders / Vehicles / Depots / Constraints）或已排程结果（Route Plan / Vehicle Summary）。",
  "当前数据：": "当前数据：",
  " 条路线，": " 条路线，",
  " 个可绘制停靠点，": " 个可绘制停靠点，",
  " 个配送日。": " 个配送日。",
  "数据文件要求": "数据文件要求",
  "Excel：包含 ": "Excel：包含 ",
  " 工作表；新配送点请填写纬度/经度": " 工作表；新配送点请填写纬度/经度",
  "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "经纬度缺失的点会进入异常页，无法在地图上显示。",
  "重要：": "重要：",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖 ":
    "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖 ",
  "数据下载": "数据下载",
  "空白 Excel 模板": "空白 Excel 模板",
  "用于准备可上传的路线计划、车辆汇总、每日汇总和异常数据。":
    "用于准备可上传的路线计划、车辆汇总、每日汇总和异常数据。",
  "当前系统数据": "当前系统数据",
  "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。":
    "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。",
  "下载 routes-data.js": "下载 routes-data.js",
  "路线汇总 CSV": "路线汇总 CSV",
  "导出路线、车辆、距离、货量、利用率等分析基础数据。":
    "导出路线、车辆、距离、货量、利用率等分析基础数据。",
  "异常明细 CSV": "异常明细 CSV",
  "导出缺坐标、拆分装载等数据质量问题。":
    "导出缺坐标、拆分装载等数据质量问题。",
  "碳排明细 CSV": "碳排明细 CSV",
  "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。":
    "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。",
  "上传成功：": "上传成功：",
  "已加载 ": "已加载 ",
  " 个停靠点、": " 个停靠点、",
  "上传失败：": "上传失败：",
});
Object.assign(I18N.ja, {
  "Sustainability Dashboard": "サステナビリティダッシュボード",
  "上传计划数据": "計画データのアップロード",
  "拖拽文件到这里": "ファイルをここにドラッグ",
  "，或选择文件上传": "、またはファイルを選択してアップロード",
  "支持 ": "対応形式：",
  " 或纯 JSON。支持 Data（Orders / Vehicles / Depots / Constraints）或已排程结果（Route Plan / Vehicle Summary）。":
    " またはJSON。Excelは配車済み結果表で、Route Plan / Vehicle Summary などのシートが必要です。",
  "当前数据：": "現在のデータ：",
  " 条路线，": " ルート、",
  " 个可绘制停靠点，": " 件の地図表示可能な停車地点、",
  " 个配送日。": " 配送日。",
  "数据文件要求": "データファイル要件",
  "Excel：包含 ": "Excel：",
  " 工作表；新配送点请填写纬度/经度":
    " シートを含むこと。新規配送先は緯度/経度を入力してください",
  "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "ルート距離、車両容量、件数、重量が分析とCO₂算出に反映されます。",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "緯度経度が欠落した地点は例外ページに入り、地図には表示されません。",
  "重要：": "重要：",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖 ":
    "ブラウザでのアップロードは即時プレビューのみです。次回も新データを使う場合は保存して ",
  "数据下载": "データダウンロード",
  "空白 Excel 模板": "空白Excelテンプレート",
  "用于准备可上传的路线计划、车辆汇总、每日汇总和异常数据。":
    "アップロード用のルート計画、車両サマリー、日次サマリー、例外データの作成に使用します。",
  "当前系统数据": "現在のシステムデータ",
  "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。":
    "現在ページで使用中のroutes-data.jsを出力し、後でデータファイルとして上書きできます。",
  "下载 routes-data.js": "routes-data.jsを取得",
  "路线汇总 CSV": "ルートサマリーCSV",
  "导出路线、车辆、距离、货量、利用率等分析基础数据。":
    "ルート、車両、距離、貨物量、利用率などの分析基礎データを出力します。",
  "异常明细 CSV": "例外明細CSV",
  "导出缺坐标、拆分装载等数据质量问题。":
    "座標欠落、分割積載などのデータ品質問題を出力します。",
  "碳排明细 CSV": "CO₂明細CSV",
  "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。":
    "現在データからルート別CO₂推計明細を生成します。既定値は0.192 kg/kmです。",
  "上传成功：": "アップロード成功：",
  "已加载 ": "読み込み済み：",
  " 个停靠点、": " 停車地点、",
  "上传失败：": "アップロード失敗：",
});
Object.assign(I18N.en, {
  "Sustainability Dashboard": "Sustainability Dashboard",
  "上传计划数据": "Upload Plan Data",
  "拖拽文件到这里": "Drag files here",
  "，或选择文件上传": ", or choose a file to upload",
  "支持 ": "Supports ",
  " 或纯 JSON。支持 Data（Orders / Vehicles / Depots / Constraints）或已排程结果（Route Plan / Vehicle Summary）。":
    " or plain JSON. Excel must be a scheduled result workbook with Route Plan / Vehicle Summary sheets.",
  "当前数据：": "Current data: ",
  " 条路线，": " routes, ",
  " 个可绘制停靠点，": " mappable stops, ",
  " 个配送日。": " delivery days.",
  "数据文件要求": "Data File Requirements",
  "Excel：包含 ": "Excel: include ",
  " 工作表；新配送点请填写纬度/经度":
    " sheets; enter latitude/longitude for new delivery points",
  "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "Route distance, vehicle capacity, package count, and weight drive analysis and CO₂ reporting.",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "Stops missing latitude/longitude appear on the Issues page and cannot be shown on the map.",
  "重要：": "Important: ",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖 ":
    "Browser uploads are preview-only. To keep new data next time, save and overwrite ",
  "数据下载": "Data Downloads",
  "空白 Excel 模板": "Blank Excel Template",
  "用于准备可上传的路线计划、车辆汇总、每日汇总和异常数据。":
    "Prepare uploadable route plans, vehicle summaries, daily summaries, and issue data.",
  "当前系统数据": "Current System Data",
  "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。":
    "Export the routes-data.js currently used by this page for later replacement.",
  "下载 routes-data.js": "Download routes-data.js",
  "路线汇总 CSV": "Route Summary CSV",
  "导出路线、车辆、距离、货量、利用率等分析基础数据。":
    "Export base analysis data such as routes, vehicles, distance, cargo volume, and utilization.",
  "异常明细 CSV": "Issue Detail CSV",
  "导出缺坐标、拆分装载等数据质量问题。":
    "Export data quality issues such as missing coordinates and split loads.",
  "碳排明细 CSV": "CO₂ Detail CSV",
  "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。":
    "Generate route-level estimated CO₂ details from current data. Default is 0.192 kg/km.",
  "上传成功：": "Upload successful: ",
  "已加载 ": "Loaded ",
  " 个停靠点、": " stops, ",
  "上传失败：": "Upload failed: ",
});

Object.assign(I18N.zh, {
  "Sustainability Dashboard": "可持续发展仪表盘",
  "Drive Smart. Deliver Green.": "Drive Smart. Deliver Green.",
  "账户或密码不正确": "账户或密码不正确",
  "右侧百分比 = 容积利用率（本路线装载容量 ÷ 车辆最大装载容量）":
    "右侧百分比 = 容积利用率（本路线装载容量 ÷ 车辆最大装载容量）",
  "MapLibre GL JS。距离为估算行驶距离：直线距离 × 1.35。":
    "MapLibre GL JS。距离为估算行驶距离：直线距离 × 1.35。",
  "以 LOGISTEED Smart Logistics 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
    "以 LOGISTEED Smart Transportation 的视角展示服务覆盖、运输效率、异常风险与低碳表现。",
  "当前筛选路线数": "当前筛选路线数",
  "所选路线平均容积利用率": "所选路线平均容积利用率",
  "当日状态：": "当日状态：",
  "计划": "计划",
  "批次": "批次",
  "条路线": "条路线",
  "条": "条",
  "棵": "棵",
  "件": "件",
  "件/批次": "件/批次",
  "件/km": "件/km",
  "km/件": "km/件",
  "weight": "weight",
  "容积利用率：本路线装载容量 / 车辆最大装载容量":
    "容积利用率：本路线装载容量 / 车辆最大装载容量",
  "右侧百分比表示该路线的容积利用率：路线装载容量 / 车辆最大装载容量。":
    "右侧百分比表示该路线的容积利用率：路线装载容量 / 车辆最大装载容量。",
  "车辆": "车辆",
  "回库": "回库",
  "停靠": "停靠",
  "件数": "件数",
  "距离": "距离",
  "容积": "容积",
  "顺序": "顺序",
  "到达": "到达",
  "离开": "离开",
  "代码": "代码",
  "行驶": "行驶",
  "名称": "名称",
  "配送点": "配送点",
  "货物": "货物",
  "说明": "说明",
  "优先": "优先",
  "注意": "注意",
  "减排建议": "减排建议",
  "高排放路线 Top 10": "高排放路线 Top 10",
  "估算 CO₂": "估算 CO₂",
  "排放因子": "排放因子",
  "每件货物": "每件货物",
  "每停靠批次": "每停靠批次",
  "树木年吸收约当": "树木年吸收约当",
  "按 21.77 kg/棵/年估算": "按 21.77 kg/棵/年估算",
  "合并低容积利用率且同方向路线，减少空驶。":
    "合并低容积利用率且同方向路线，减少空驶。",
  "对超过 80km 的路线复核地理顺序和缺坐标点。":
    "对超过 80km 的路线复核地理顺序和缺坐标点。",
  "当前 CO₂ 基于估算行驶距离，不是路网导航距离。":
    "当前 CO₂ 基于估算行驶距离，不是路网导航距离。",
  "统计范围": "统计范围",
  "路线 / 车辆": "路线 / 车辆",
  "路线数 / 使用车辆": "路线数 / 使用车辆",
  "地图停靠批次": "地图停靠批次",
  "计划核对件数": "计划核对件数",
  "行驶距离": "行驶距离",
  "km，估算行驶距离": "km，估算行驶距离",
  "平均容积利用率": "平均容积利用率",
  "平均载重利用率": "平均载重利用率",
  "按路线平均": "按路线平均",
  "估算碳排": "估算碳排",
  "全维度概览": "全维度概览",
  "总重量": "总重量",
  "总容量": "总容量",
  "最晚回库": "最晚回库",
  "缺坐标记录": "缺坐标记录",
  "拆分装载": "拆分装载",
  "每件平均距离": "每件平均距离",
  "每批次平均货量": "每批次平均货量",
  "每公里配送件数": "每公里配送件数",
  "数据健康度": "数据健康度",
  "坐标完整率：": "坐标完整率：",
  "拆分装载占比：": "拆分装载占比：",
  "高容积路线（≥90%）：": "高容积路线（≥90%）：",
  "低容积路线（<40%）：": "低容积路线（<40%）：",
  "距离 Top 6": "距离 Top 6",
  "日期": "日期",
  "容积利用率 Top 6": "容积利用率 Top 6",
  "已选路线": "已选路线",
  "当前分析范围": "当前分析范围",
  "平均每路线批次": "平均每路线批次",
  "停靠批次 / 路线": "停靠批次 / 路线",
  "平均每路线距离": "平均每路线距离",
  "km / 路线": "km / 路线",
  "装载效率": "装载效率",
  "路线排行": "路线排行",
  "智能洞察与建议": "智能洞察与建议",
  "重点路线": "重点路线",
  "最长路线：": "最长路线：",
  "停靠最多：": "停靠最多：",
  "容积最高：": "容积最高：",
  "最晚回库：": "最晚回库：",
  "车辆利用率分布": "车辆利用率分布",
  "改善方向": "改善方向",
  "问题类型": "问题类型",
  "判断依据": "判断依据",
  "建议动作": "建议动作",
  "低装载": "低装载",
  "长距离": "长距离",
  "高装载": "高装载",
  "主数据风险": "主数据风险",
  "容积利用率低于 40%": "容积利用率低于 40%",
  "单路线超过 80km": "单路线超过 80km",
  "容积利用率高于 90%": "容积利用率高于 90%",
  "缺坐标或地址不完整": "缺坐标或地址不完整",
  "合并相邻区域或调整发车频次": "合并相邻区域或调整发车频次",
  "复核区域边界、顺序及中途补货可能性": "复核区域边界、顺序及中途补货可能性",
  "预留安全容量，避免临时订单超载": "预留安全容量，避免临时订单超载",
  "回流客户地址与订单主数据治理": "回流客户地址与订单主数据治理",
  "缺坐标停靠": "缺坐标停靠",
  "无法在地图绘制，但已计入装载": "无法在地图绘制，但已计入装载",
  "单件超过容量后拆分批次": "单件超过容量后拆分批次",
  "当前日期": "当前日期",
  "筛选条件联动": "筛选条件联动",
  "缺坐标明细": "缺坐标明细",
  "拆分装载明细": "拆分装载明细",
  "短途<40km": "短途<40km",
  "长途>80km": "长途>80km",
  "低于40%": "低于40%",
  "90%以上": "90%以上",
});
Object.assign(I18N.ja, {
  "Sustainability Dashboard": "サステナビリティダッシュボード",
  "Drive Smart. Deliver Green.": "ルート最適化・可視化・サステナビリティ",
  "账户或密码不正确": "アカウントまたはパスワードが正しくありません",
  "右侧百分比 = 容积利用率（本路线装载容量 ÷ 车辆最大装载容量）":
    "右側の割合 = 容積利用率（本ルート積載容量 ÷ 車両最大積載容量）",
  "MapLibre GL JS。距离为估算行驶距离：直线距离 × 1.35。":
    "MapLibre GL JS。距離は推定走行距離（直線距離 × 1.35）です。",
  "以 LOGISTEED Smart Logistics 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
    "LOGISTEED Smart Transportation の視点で、サービス範囲・輸送効率・例外リスク・低炭素指標を表示します。",
  "以 LOGISTEED Smart Transportation 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
    "LOGISTEED Smart Transportation の視点で、サービス範囲・輸送効率・例外リスク・低炭素指標を表示します。",
  "当前筛选路线数": "現在の絞り込みルート数",
  "所选路线平均容积利用率": "選択ルートの平均容積利用率",
  "当日状态：": "当日ステータス：",
  "计划": "計画",
  "批次": "バッチ",
  "条路线": "ルート",
  "条": "件",
  "棵": "本",
  "件": "件",
  "件/批次": "件/バッチ",
  "件/km": "件/km",
  "km/件": "km/件",
  "缺坐标": "座標なし",
  "weight": "重量",
  "容积利用率：本路线装载容量 / 车辆最大装载容量":
    "容積利用率：本ルート積載容量 / 車両最大積載容量",
  "车辆": "車両",
  "回库": "帰庫",
  "停靠": "停車",
  "件数": "件数",
  "距离": "距離",
  "容积": "容積",
  "顺序": "順序",
  "到达": "到着",
  "离开": "出発",
  "代码": "コード",
  "行驶": "走行",
  "名称": "名称",
  "配送点": "配送先",
  "货物": "貨物",
  "说明": "説明",
  "优先": "優先",
  "注意": "注意",
  "减排建议": "排出削減提案",
  "高排放路线 Top 10": "高排出ルート Top 10",
  "估算 CO₂": "推定 CO₂",
  "排放因子": "排出係数",
  "每件货物": "貨物1件あたり",
  "每停靠批次": "停車バッチあたり",
  "树木年吸收约当": "樹木年間吸収量換算",
  "按 21.77 kg/棵/年估算": "21.77 kg/本/年で推定",
  "合并低容积利用率且同方向路线，减少空驶。":
    "容積利用率が低く同方向のルートを統合し、空走を削減します。",
  "对超过 80km 的路线复核地理顺序和缺坐标点。":
    "80km超のルートは地理的順序と座標欠落地点を再確認します。",
  "当前 CO₂ 基于估算行驶距离，不是路网导航距离。":
    "現在のCO₂は推定走行距離に基づき、道路網ナビ距離ではありません。",
  "统计范围": "集計範囲",
  "路线 / 车辆": "ルート / 車両",
  "路线数 / 使用车辆": "ルート数 / 使用車両",
  "地图停靠批次": "地図上の停車バッチ",
  "计划核对件数": "計画照合件数",
  "行驶距离": "走行距離",
  "km，估算行驶距离": "km、推定走行距離",
  "平均容积利用率": "平均容積利用率",
  "平均载重利用率": "平均重量利用率",
  "按路线平均": "ルート平均",
  "估算碳排": "推定CO₂",
  "全维度概览": "全体概要",
  "总重量": "総重量",
  "总容量": "総容量",
  "最晚回库": "最終帰庫",
  "缺坐标记录": "座標欠落レコード",
  "拆分装载": "分割積載",
  "每件平均距离": "1件あたり平均距離",
  "每批次平均货量": "1バッチあたり平均貨物数",
  "每公里配送件数": "1kmあたり配送件数",
  "数据健康度": "データ健全性",
  "坐标完整率：": "座標完全率：",
  "拆分装载占比：": "分割積載比率：",
  "高容积路线（≥90%）：": "高容積ルート（≥90%）：",
  "低容积路线（<40%）：": "低容積ルート（<40%）：",
  "距离 Top 6": "距離 Top 6",
  "日期": "日付",
  "容积利用率 Top 6": "容積利用率 Top 6",
  "已选路线": "選択ルート",
  "当前分析范围": "現在の分析範囲",
  "平均每路线批次": "ルートあたり平均バッチ",
  "停靠批次 / 路线": "停車バッチ / ルート",
  "平均每路线距离": "ルートあたり平均距離",
  "km / 路线": "km / ルート",
  "装载效率": "積載効率",
  "路线排行": "ルートランキング",
  "智能洞察与建议": "スマート洞察・提案",
  "重点路线": "重点ルート",
  "最长路线：": "最長ルート：",
  "停靠最多：": "最多停車：",
  "容积最高：": "最高容積：",
  "最晚回库：": "最終帰庫：",
  "车辆利用率分布": "車両利用率分布",
  "改善方向": "改善方向",
  "问题类型": "問題タイプ",
  "判断依据": "判断根拠",
  "建议动作": "推奨アクション",
  "低装载": "低積載",
  "长距离": "長距離",
  "高装载": "高積載",
  "主数据风险": "マスターデータリスク",
  "容积利用率低于 40%": "容積利用率が40%未満",
  "单路线超过 80km": "単一ルートが80km超",
  "容积利用率高于 90%": "容積利用率が90%超",
  "缺坐标或地址不完整": "座標欠落または住所不完全",
  "合并相邻区域或调整发车频次": "隣接エリアの統合または発車頻度を調整",
  "复核区域边界、顺序及中途补货可能性":
    "エリア境界、順序、中継補充の可能性を再確認",
  "预留安全容量，避免临时订单超载":
    "臨時注文による過積載を避けるため安全容量を確保",
  "回流客户地址与订单主数据治理": "顧客住所・注文マスタデータ改善へ反映",
  "缺坐标停靠": "座標欠落停車",
  "无法在地图绘制，但已计入装载": "地図には描画できませんが、積載には計上済み",
  "单件超过容量后拆分批次": "単品が容量を超過したためバッチ分割",
  "当前日期": "現在の日付",
  "筛选条件联动": "フィルター連動",
  "缺坐标明细": "座標欠落明細",
  "拆分装载明细": "分割積載明細",
  "短途<40km": "短距離<40km",
  "长途>80km": "長距離>80km",
  "低于40%": "40%未満",
  "90%以上": "90%以上",
});
Object.assign(I18N.en, {
  "Sustainability Dashboard": "Sustainability Dashboard",
  "Drive Smart. Deliver Green.": "Drive Smart. Deliver Green.",
  "账户或密码不正确": "Incorrect account or password",
  "右侧百分比 = 容积利用率（本路线装载容量 ÷ 车辆最大装载容量）":
    "Right percentage = volume utilization (route loaded volume / max vehicle volume).",
  "MapLibre GL JS。距离为估算行驶距离：直线距离 × 1.35。":
    "MapLibre GL JS. Distance is estimated travel distance: straight-line distance × 1.35.",
  "以 LOGISTEED Smart Logistics 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
    "Shows service coverage, transport efficiency, exception risk and low-carbon performance from the LOGISTEED Smart Transportation perspective.",
  "以 LOGISTEED Smart Transportation 的视角展示服务覆盖、运输效率、异常风险与低碳表现。":
    "Shows service coverage, transport efficiency, exception risk and low-carbon performance from the LOGISTEED Smart Transportation perspective.",
  "当前筛选路线数": "Current filtered routes",
  "所选路线平均容积利用率": "Average volume utilization of selected routes",
  "当日状态：": "Day status: ",
  "计划": "planned",
  "批次": "batches",
  "条路线": "routes",
  "条": "items",
  "棵": "trees",
  "件": "pcs",
  "件/批次": "pcs/batch",
  "件/km": "pcs/km",
  "km/件": "km/pc",
  "缺坐标": "missing coords",
  "weight": "weight",
  "容积利用率：本路线装载容量 / 车辆最大装载容量":
    "Volume utilization: route loaded volume / max vehicle volume",
  "右侧百分比表示该路线的容积利用率：路线装载容量 / 车辆最大装载容量。":
    "Right hint = volume utilization (route loaded volume / max vehicle volume).",
  "车辆": "Vehicle",
  "回库": "Return",
  "停靠": "Stops",
  "件数": "Packages",
  "距离": "Distance",
  "容积": "Volume",
  "顺序": "Seq.",
  "到达": "Arrive",
  "离开": "Depart",
  "代码": "Code",
  "行驶": "Travel",
  "名称": "Name",
  "配送点": "Stop",
  "货物": "Cargo",
  "说明": "Description",
  "优先": "Priority",
  "注意": "Note",
  "减排建议": "Emission reduction suggestions",
  "高排放路线 Top 10": "Top 10 high-emission routes",
  "估算 CO₂": "Estimated CO₂",
  "排放因子": "Emission factor",
  "每件货物": "Per package",
  "每停靠批次": "Per stop batch",
  "树木年吸收约当": "Tree annual absorption equivalent",
  "按 21.77 kg/棵/年估算": "Estimated at 21.77 kg/tree/year",
  "合并低容积利用率且同方向路线，减少空驶。":
    "Merge same-direction routes with low volume utilization to reduce empty running.",
  "对超过 80km 的路线复核地理顺序和缺坐标点。":
    "Review geographic sequence and missing-coordinate stops on routes over 80km.",
  "当前 CO₂ 基于估算行驶距离，不是路网导航距离。":
    "Current CO₂ is based on estimated travel distance, not road-network navigation distance.",
  "统计范围": "Scope",
  "路线 / 车辆": "Routes / Vehicles",
  "路线数 / 使用车辆": "Routes / vehicles used",
  "地图停靠批次": "Mapped stop batches",
  "计划核对件数": "Planned package count",
  "行驶距离": "Travel distance",
  "km，估算行驶距离": "km, estimated travel distance",
  "平均容积利用率": "Avg. volume utilization",
  "平均载重利用率": "Avg. weight utilization",
  "按路线平均": "Route average",
  "估算碳排": "Estimated CO₂",
  "全维度概览": "Full-dimensional overview",
  "总重量": "Total weight",
  "总容量": "Total volume",
  "最晚回库": "Latest return",
  "缺坐标记录": "Missing-coordinate records",
  "拆分装载": "Split loads",
  "每件平均距离": "Average distance per package",
  "每批次平均货量": "Average packages per batch",
  "每公里配送件数": "Packages per km",
  "数据健康度": "Data health",
  "坐标完整率：": "Coordinate completeness: ",
  "拆分装载占比：": "Split-load ratio: ",
  "高容积路线（≥90%）：": "High-volume routes (≥90%): ",
  "低容积路线（<40%）：": "Low-volume routes (<40%): ",
  "距离 Top 6": "Distance Top 6",
  "日期": "Date",
  "容积利用率 Top 6": "Volume utilization Top 6",
  "已选路线": "Selected routes",
  "当前分析范围": "Current analysis scope",
  "平均每路线批次": "Avg. batches per route",
  "停靠批次 / 路线": "Stop batches / route",
  "平均每路线距离": "Avg. distance per route",
  "km / 路线": "km / route",
  "装载效率": "Loading efficiency",
  "路线排行": "Route ranking",
  "智能洞察与建议": "Smart insights & recommendations",
  "重点路线": "Key routes",
  "最长路线：": "Longest route: ",
  "停靠最多：": "Most stops: ",
  "容积最高：": "Highest volume: ",
  "最晚回库：": "Latest return: ",
  "车辆利用率分布": "Vehicle utilization distribution",
  "改善方向": "Improvement actions",
  "问题类型": "Issue type",
  "判断依据": "Basis",
  "建议动作": "Recommended action",
  "低装载": "Low load",
  "长距离": "Long distance",
  "高装载": "High load",
  "主数据风险": "Master-data risk",
  "容积利用率低于 40%": "Volume utilization below 40%",
  "单路线超过 80km": "Single route exceeds 80km",
  "容积利用率高于 90%": "Volume utilization above 90%",
  "缺坐标或地址不完整": "Missing coordinates or incomplete address",
  "合并相邻区域或调整发车频次":
    "Merge adjacent areas or adjust departure frequency",
  "复核区域边界、顺序及中途补货可能性":
    "Review area boundaries, sequence and mid-route replenishment options",
  "预留安全容量，避免临时订单超载":
    "Reserve safety capacity to avoid overload from ad hoc orders",
  "回流客户地址与订单主数据治理":
    "Feed back to customer address and order master-data governance",
  "缺坐标停靠": "Stops missing coordinates",
  "无法在地图绘制，但已计入装载":
    "Cannot be drawn on the map, but included in loading",
  "单件超过容量后拆分批次":
    "Batch split because a single item exceeds capacity",
  "当前日期": "Current date",
  "筛选条件联动": "Linked to filters",
  "缺坐标明细": "Missing-coordinate details",
  "拆分装载明细": "Split-load details",
  "短途<40km": "Short <40km",
  "长途>80km": "Long >80km",
  "低于40%": "Below 40%",
  "90%以上": "90% and above",
});

Object.assign(I18N.zh, {
  "搜索配送点、代码、路线、车辆": "搜索配送点、代码、路线、车辆",
  "车型/车辆": "车型/车辆",
  "全部车型/车辆": "全部车型/车辆",
  "Excel：包含": "Excel：包含",
  "工作表；新配送点请填写纬度/经度": "工作表；新配送点请填写纬度/经度",
  "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "经纬度缺失的点会进入异常页，无法在地图上显示。",
  "重要：": "重要：",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖":
    "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖",
  "有 ": "有 ",
  " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。":
    " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。",
  " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。":
    " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。",
  " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。":
    " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。",
  "存在 ": "存在 ",
  " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。":
    " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。",
  "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。":
    "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。",
});
Object.assign(I18N.ja, {
  "搜索配送点、代码、路线、车辆": "配送先・コード・ルート・車両を検索",
  "车型/车辆": "車型/車両",
  "全部车型/车辆": "全車型/車両",
  "Excel：包含": "Excel：",
  "工作表；新配送点请填写纬度/经度":
    "シートを含むこと。新規配送先は緯度/経度を入力してください",
  "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "ルート距離、車両容量、件数、重量が分析とCO₂算出に反映されます。",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "緯度経度が欠落した地点は例外ページに入り、地図には表示されません。",
  "重要：": "重要：",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖":
    "ブラウザでのアップロードは即時プレビューのみです。次回も新データを使う場合は保存して上書きしてください：",
  "有 ": "",
  " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。":
    " ルートの容積利用率が40%未満です。同一エリア・同一時間帯のルートと統合できるか確認してください。",
  " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。":
    " ルートの容積利用率が90%以上です。臨時追加注文による過積載リスクに注意してください。",
  " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。":
    " ルートが80kmを超えています。配送順序、エリア分割、作業時間を再確認してください。",
  "存在 ": "",
  " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。":
    " 件の座標欠落レコードがあります。ルート最適化とETA精度のため、顧客住所マスターを優先的に整備してください。",
  "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。":
    "現在の絞り込み範囲では明確な積載または距離の異常は見られず、ルート構成は比較的安定しています。",
});
Object.assign(I18N.en, {
  "搜索配送点、代码、路线、车辆": "Search stops, code, route, vehicle",
  "车型/车辆": "Vehicle type / vehicle",
  "全部车型/车辆": "All vehicle types / vehicles",
  "Excel：包含": "Excel: includes",
  "工作表；新配送点请填写纬度/经度":
    "worksheets; enter latitude/longitude for new delivery stops",
  "上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "Route distance, vehicle capacity, package count and weight drive analytics and CO₂ calculations.",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "Stops missing latitude/longitude go to the Issues page and cannot be shown on the map.",
  "重要：": "Important:",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖":
    "Browser upload is only an instant preview. To keep the new data next time, save and overwrite",
  "有 ": "",
  " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。":
    " routes have volume utilization below 40%. Check whether they can be merged with routes in the same area and time window.",
  " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。":
    " routes have volume utilization above 90%. Watch for overload risk from ad hoc orders.",
  " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。":
    " routes exceed 80km. Review delivery sequence, area split and driver working time.",
  "存在 ": "",
  " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。":
    " missing-coordinate records exist. Prioritize customer address master-data cleanup to protect route optimization and ETA accuracy.",
  "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。":
    "No obvious loading or distance exceptions were found in the current filter scope; the route structure is relatively stable.",
});

const I18N_EXTRA_ZH = {
  "地图底图": "地图底图",
  "标准地图": "标准地图",
  "浅色地图": "浅色地图",
  "深色地图": "深色地图",
  "高对比地图": "高对比地图",
  "显示预设": "显示预设",
  "调度分析": "调度分析",
  "客户汇报": "客户汇报",
  "路线聚焦": "路线聚焦",
  "ESG 展示": "ESG 展示",
  "线路粗细": "线路粗细",
  "标签开关": "标签开关",
  "送货线路": "送货线路",
  "配送点": "配送点",
  "到达时间": "到达时间",
  "段间距离": "段间距离",
  "右侧百分比": "右侧百分比",
  "容积利用率": "容积利用率",
  "本路线装载容量": "本路线装载容量",
  "车辆最大装载容量": "车辆最大装载容量",
  "配送批次": "配送批次",
  "货物件数": "货物件数",
  "行驶距离": "行驶距离",
  "最晚回库": "最晚回库",
  "车辆利用率": "车辆利用率",
  "已选路线": "已选路线",
  "计划": "计划",
  "所选路线平均容积利用率": "所选路线平均容积利用率",
  "当前筛选路线数": "当前筛选路线数",
  "批次": "批次",
  "路线详情": "路线详情",
  "车辆": "车辆",
  "回库": "回库",
  "停靠": "停靠",
  "件数": "件数",
  "容积": "容积",
  "缺坐标": "缺坐标",
  "搜索配送点、代码、路线、车辆": "搜索配送点、代码、路线、车辆",
  "数据中心": "数据中心",
  "上传数据": "上传数据",
  "拖拽文件到这里": "拖拽文件到这里",
  "或选择文件上传": "或选择文件上传",
  "支持": "支持",
  "或纯 JSON。": "或纯 JSON。",
  "支持 Data": "支持 Data",
  "已排程结果": "已排程结果",
  "当前数据：": "当前数据：",
  "个可绘制停靠点": "个可绘制停靠点",
  "个配送日": "个配送日",
  "数据文件要求": "数据文件要求",
  "订单需填写纬度/经度": "订单需填写纬度/经度",
  "上传 Data 后先进入待排车状态": "上传 Data 后先进入待排车状态",
  "点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "点击排车页生成结果后，路线、分析、碳排会自动刷新。",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "经纬度缺失的点会进入异常页，无法在地图上显示。",
  "重要：": "重要：",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖":
    "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖",
  "数据下载": "数据下载",
  "Data 空白模板": "Data 空白模板",
  "用于准备原始订单、车辆、仓库和限制条件，上传后由系统自动排车。":
    "用于准备原始订单、车辆、仓库和限制条件，上传后由系统自动排车。",
  "下载 Data 模板": "下载 Data 模板",
  "STCT 合成 Data 演示数据": "STCT 合成 Data 演示数据",
  "包含原始订单、车辆、仓库和限制条件。上传后进入排车页，由系统生成路线结果。":
    "包含原始订单、车辆、仓库和限制条件。上传后进入排车页，由系统生成路线结果。",
  "下载 Data Demo": "下载 Data Demo",
  "当前系统数据": "当前系统数据",
  "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。":
    "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。",
  "路线汇总 CSV": "路线汇总 CSV",
  "导出路线、车辆、距离、货量、利用率等分析基础数据。":
    "导出路线、车辆、距离、货量、利用率等分析基础数据。",
  "异常明细 CSV": "异常明细 CSV",
  "导出缺坐标、拆分装载等数据质量问题。":
    "导出缺坐标、拆分装载等数据质量问题。",
  "碳排明细 CSV": "碳排明细 CSV",
  "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。":
    "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。",
  "智能排车": "智能排车",
  "从订单数据自动生成推荐车辆路线，并可一键应用到路线、分析与碳排页面。":
    "从订单数据自动生成推荐车辆路线，并可一键应用到路线、分析与碳排页面。",
  "订单日期": "订单日期",
  "优化目标": "优化目标",
  "综合平衡": "综合平衡",
  "最少车辆优先": "最少车辆优先",
  "最短距离优先": "最短距离优先",
  "装载率优先": "装载率优先",
  "最早完成优先": "最早完成优先",
  "订单规模": "订单规模",
  "单演示": "单演示",
  "全部可用订单": "全部可用订单",
  "可排订单": "可排订单",
  "可用车辆": "可用车辆",
  "推荐路线": "推荐路线",
  "平均容积": "平均容积",
  "自动排车结果": "自动排车结果",
  "推荐路线平均": "推荐路线平均",
  "生成设置": "生成设置",
  "当前已加载 Data": "当前已加载 Data",
  "订单、车辆、仓库和时间窗约束。": "订单、车辆、仓库和时间窗约束。",
  "点击生成后系统会从原始订单自动排车。":
    "点击生成后系统会从原始订单自动排车。",
  "目标逻辑：": "目标逻辑：",
  "生成推荐路线": "生成推荐路线",
  "应用到路线/分析/碳排": "应用到路线/分析/碳排",
  "恢复原始数据": "恢复原始数据",
  "总距离": "总距离",
  "未分配": "未分配",
  "策略": "策略",
  "推荐路线明细": "推荐路线明细",
  "异常与人工确认": "异常与人工确认",
  "当前演示订单均已成功排入车辆。可进入路线页查看地图动线。":
    "当前演示订单均已成功排入车辆。可进入路线页查看地图动线。",
  "正式版本建议接入 OR-Tools / VROOM，并用 OSRM 或商用地图 API 计算真实道路时间。":
    "正式版本建议接入 OR-Tools / VROOM，并用 OSRM 或商用地图 API 计算真实道路时间。",
  "来自上传 Data 的原始订单": "来自上传 Data 的原始订单",
  "来自当前路线数据的演示订单": "来自当前路线数据的演示订单",
  "来自上传 Data 的车辆主数据": "来自上传 Data 的车辆主数据",
  "按当前计划车辆能力生成": "按当前计划车辆能力生成",
  "演示算法会考虑经纬度、车辆载重/容积、预计行驶时间、9:00-17:30 作业时间和 12:00-13:00 午休。当前为前端启发式排车，用于客户演示，不等同正式最优算法。":
    "演示算法会考虑经纬度、车辆载重/容积、预计行驶时间、9:00-17:30 作业时间和 12:00-13:00 午休。当前为前端启发式排车，用于客户演示，不等同正式最优算法。",
};
const I18N_EXTRA_JA = {
  "地图底图": "地図スタイル",
  "标准地图": "標準地図",
  "浅色地图": "ライト地図",
  "深色地图": "ダーク地図",
  "高对比地图": "高コントラスト地図",
  "显示预设": "表示プリセット",
  "调度分析": "配車分析",
  "客户汇报": "顧客報告",
  "路线聚焦": "ルートフォーカス",
  "ESG 展示": "ESG表示",
  "线路粗细": "ルート線幅",
  "标签开关": "ラベル表示",
  "送货线路": "配送ルート",
  "配送点": "配送先",
  "到达时间": "到着時刻",
  "段间距离": "区間距離",
  "右侧百分比": "右側の割合",
  "容积利用率": "容積利用率",
  "本路线装载容量": "このルートの積載容量",
  "车辆最大装载容量": "車両最大積載容量",
  "配送批次": "配送バッチ",
  "货物件数": "貨物数",
  "行驶距离": "走行距離",
  "最晚回库": "最終帰庫",
  "车辆利用率": "車両利用率",
  "已选路线": "選択ルート",
  "计划": "計画",
  "所选路线平均容积利用率": "選択ルートの平均容積利用率",
  "当前筛选路线数": "現在の絞り込みルート数",
  "批次": "バッチ",
  "路线详情": "ルート詳細",
  "车辆": "車両",
  "回库": "帰庫",
  "停靠": "停車",
  "件数": "件数",
  "容积": "容積",
  "缺坐标": "座標なし",
  "搜索配送点、代码、路线、车辆": "配送先・コード・ルート・車両を検索",
  "数据中心": "データセンター",
  "上传数据": "データアップロード",
  "拖拽文件到这里": "ファイルをここにドラッグ",
  "或选择文件上传": "またはファイルを選択",
  "支持": "対応形式",
  "或纯 JSON。": "またはJSON。",
  "支持 Data": "Dataに対応",
  "已排程结果": "配車済み結果",
  "当前数据：": "現在のデータ：",
  "个可绘制停靠点": "地図表示可能な停車地点",
  "个配送日": "配送日",
  "数据文件要求": "データファイル要件",
  "订单需填写纬度/经度": "注文には緯度/経度が必要です",
  "上传 Data 后先进入待排车状态": "Dataアップロード後は配車待ち状態になります",
  "点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "配車ページで結果を生成すると、ルート・分析・CO₂が自動更新されます。",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "緯度経度がない地点は例外ページに入り、地図には表示されません。",
  "重要：": "重要：",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖":
    "ブラウザのアップロードは即時プレビューのみです。次回も使う場合は保存して上書きしてください",
  "数据下载": "データダウンロード",
  "Data 空白模板": "Data空白テンプレート",
  "用于准备原始订单、车辆、仓库和限制条件，上传后由系统自动排车。":
    "原始注文、車両、倉庫、制約条件の準備に使います。アップロード後、システムが自動配車します。",
  "下载 Data 模板": "Dataテンプレートを取得",
  "STCT 合成 Data 演示数据": "STCT 合成 Data デモデータ",
  "包含原始订单、车辆、仓库和限制条件。上传后进入排车页，由系统生成路线结果。":
    "原始注文、車両、倉庫、制約条件を含みます。アップロード後、配車ページでルート結果を生成します。",
  "下载 Data Demo": "Dataデモを取得",
  "当前系统数据": "現在のシステムデータ",
  "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。":
    "現在ページで使用中のroutes-data.jsを出力し、後でデータファイルとして上書きできます。",
  "路线汇总 CSV": "ルートサマリーCSV",
  "导出路线、车辆、距离、货量、利用率等分析基础数据。":
    "ルート、車両、距離、貨物量、利用率などの分析基礎データを出力します。",
  "异常明细 CSV": "例外明細CSV",
  "导出缺坐标、拆分装载等数据质量问题。":
    "座標欠落、分割積載などのデータ品質問題を出力します。",
  "碳排明细 CSV": "CO₂明細CSV",
  "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。":
    "現在データからルート別CO₂推計明細を生成します。既定値は0.192 kg/kmです。",
  "智能排车": "スマート配車",
  "从订单数据自动生成推荐车辆路线，并可一键应用到路线、分析与碳排页面。":
    "注文データから推奨車両ルートを自動生成し、ルート・分析・CO₂ページへ反映できます。",
  "订单日期": "注文日",
  "优化目标": "最適化目標",
  "综合平衡": "バランス重視",
  "最少车辆优先": "車両数最小",
  "最短距离优先": "距離最短",
  "装载率优先": "積載率重視",
  "最早完成优先": "早期完了",
  "订单规模": "注文規模",
  "单演示": "件デモ",
  "全部可用订单": "全注文",
  "可排订单": "配車可能注文",
  "可用车辆": "利用可能車両",
  "推荐路线": "推奨ルート",
  "平均容积": "平均容積",
  "自动排车结果": "自動配車結果",
  "推荐路线平均": "推奨ルート平均",
  "生成设置": "生成設定",
  "当前已加载 Data": "現在Dataを読み込み済み",
  "订单、车辆、仓库和时间窗约束。": "注文、車両、倉庫、時間枠制約。",
  "点击生成后系统会从原始订单自动排车。":
    "生成を押すと原始注文から自動配車します。",
  "目标逻辑：": "目標ロジック：",
  "生成推荐路线": "推奨ルート生成",
  "应用到路线/分析/碳排": "ルート/分析/CO₂へ適用",
  "恢复原始数据": "元データに戻す",
  "总距离": "総距離",
  "未分配": "未割当",
  "策略": "戦略",
  "推荐路线明细": "推奨ルート明細",
  "异常与人工确认": "例外と手動確認",
  "当前演示订单均已成功排入车辆。可进入路线页查看地图动线。":
    "現在のデモ注文はすべて車両に割り当て済みです。ルートページで地図動線を確認できます。",
  "正式版本建议接入 OR-Tools / VROOM，并用 OSRM 或商用地图 API 计算真实道路时间。":
    "正式版ではOR-Tools/VROOMとOSRMまたは商用地図APIで実道路時間を計算することを推奨します。",
  "来自上传 Data 的原始订单": "アップロードDataの原始注文",
  "来自当前路线数据的演示订单": "現在ルートデータのデモ注文",
  "来自上传 Data 的车辆主数据": "アップロードDataの車両マスタ",
  "按当前计划车辆能力生成": "現在計画の車両能力から生成",
  "演示算法会考虑经纬度、车辆载重/容积、预计行驶时间、9:00-17:30 作业时间和 12:00-13:00 午休。当前为前端启发式排车，用于客户演示，不等同正式最优算法。":
    "デモ算法は緯度経度、車両重量/容積、推定走行時間、9:00-17:30の稼働時間、12:00-13:00の昼休みを考慮します。現在は顧客デモ用のフロントエンドヒューリスティックで、正式な最適化算法ではありません。",
};
const I18N_EXTRA_EN = {
  "地图底图": "Map style",
  "标准地图": "Standard map",
  "浅色地图": "Light map",
  "深色地图": "Dark map",
  "高对比地图": "High contrast map",
  "显示预设": "Display preset",
  "调度分析": "Dispatch analysis",
  "客户汇报": "Customer report",
  "路线聚焦": "Route focus",
  "ESG 展示": "ESG view",
  "线路粗细": "Line thickness",
  "标签开关": "Labels",
  "送货线路": "Delivery route",
  "配送点": "Delivery stop",
  "到达时间": "Arrival time",
  "段间距离": "Segment distance",
  "右侧百分比": "Right-side percentage",
  "容积利用率": "volume utilization",
  "本路线装载容量": "loaded volume on this route",
  "车辆最大装载容量": "vehicle max volume",
  "配送批次": "Delivery batches",
  "货物件数": "Packages",
  "行驶距离": "Travel distance",
  "最晚回库": "Latest return",
  "车辆利用率": "Vehicle utilization",
  "已选路线": "Selected routes",
  "计划": "planned",
  "所选路线平均容积利用率": "Average volume utilization of selected routes",
  "当前筛选路线数": "Current filtered route count",
  "批次": "batches",
  "路线详情": "Route details",
  "车辆": "Vehicle",
  "回库": "Return",
  "停靠": "Stops",
  "件数": "Packages",
  "容积": "Volume",
  "缺坐标": "Missing coordinates",
  "搜索配送点、代码、路线、车辆": "Search stops, code, route, vehicle",
  "数据中心": "Data Center",
  "上传数据": "Upload data",
  "拖拽文件到这里": "Drag files here",
  "或选择文件上传": "or choose a file",
  "支持": "Supports",
  "或纯 JSON。": "or plain JSON.",
  "支持 Data": "Supports Data",
  "已排程结果": "scheduled results",
  "当前数据：": "Current data:",
  "个可绘制停靠点": "mappable stops",
  "个配送日": "delivery days",
  "数据文件要求": "Data file requirements",
  "订单需填写纬度/经度": "orders must include latitude/longitude",
  "上传 Data 后先进入待排车状态":
    "After Data upload, it enters pending dispatch status",
  "点击排车页生成结果后，路线、分析、碳排会自动刷新。":
    "After generating results on the dispatch page, routes, analysis, and CO₂ update automatically.",
  "经纬度缺失的点会进入异常页，无法在地图上显示。":
    "Stops missing latitude/longitude appear on the Issues page and cannot be shown on the map.",
  "重要：": "Important:",
  "浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖":
    "Browser uploads are preview-only. To keep new data next time, save and overwrite",
  "数据下载": "Data downloads",
  "Data 空白模板": "Blank Data template",
  "用于准备原始订单、车辆、仓库和限制条件，上传后由系统自动排车。":
    "Prepare raw orders, vehicles, depots, and constraints. The system dispatches automatically after upload.",
  "下载 Data 模板": "Download Data template",
  "STCT 合成 Data 演示数据": "STCT synthetic Data demo",
  "包含原始订单、车辆、仓库和限制条件。上传后进入排车页，由系统生成路线结果。":
    "Includes raw orders, vehicles, depots, and constraints. After upload, generate route results on the dispatch page.",
  "下载 Data Demo": "Download Data demo",
  "当前系统数据": "Current system data",
  "导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。":
    "Export the routes-data.js currently used by this page for later replacement.",
  "路线汇总 CSV": "Route summary CSV",
  "导出路线、车辆、距离、货量、利用率等分析基础数据。":
    "Export base analysis data such as routes, vehicles, distance, cargo volume, and utilization.",
  "异常明细 CSV": "Issue detail CSV",
  "导出缺坐标、拆分装载等数据质量问题。":
    "Export data quality issues such as missing coordinates and split loads.",
  "碳排明细 CSV": "CO₂ detail CSV",
  "按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。":
    "Generate route-level estimated CO₂ details from current data. Default is 0.192 kg/km.",
  "智能排车": "Smart dispatch",
  "从订单数据自动生成推荐车辆路线，并可一键应用到路线、分析与碳排页面。":
    "Automatically generate recommended vehicle routes from order data and apply them to routes, analysis, and CO₂ pages.",
  "订单日期": "Order date",
  "优化目标": "Optimization goal",
  "综合平衡": "Balanced",
  "最少车辆优先": "Fewest vehicles",
  "最短距离优先": "Shortest distance",
  "装载率优先": "Utilization first",
  "最早完成优先": "Earliest finish",
  "订单规模": "Order scale",
  "单演示": " orders demo",
  "全部可用订单": "All available orders",
  "可排订单": "Dispatchable orders",
  "可用车辆": "Available vehicles",
  "推荐路线": "Recommended routes",
  "平均容积": "Average volume",
  "自动排车结果": "Auto-dispatch result",
  "推荐路线平均": "Recommended route average",
  "生成设置": "Generation settings",
  "当前已加载 Data": "Data loaded",
  "订单、车辆、仓库和时间窗约束。":
    "orders, vehicles, depots, and time-window constraints.",
  "点击生成后系统会从原始订单自动排车。":
    "Click generate to dispatch automatically from raw orders.",
  "目标逻辑：": "Goal logic:",
  "生成推荐路线": "Generate recommended routes",
  "应用到路线/分析/碳排": "Apply to routes/analysis/CO₂",
  "恢复原始数据": "Restore original data",
  "总距离": "Total distance",
  "未分配": "Unassigned",
  "策略": "Strategy",
  "推荐路线明细": "Recommended route details",
  "异常与人工确认": "Issues and manual review",
  "当前演示订单均已成功排入车辆。可进入路线页查看地图动线。":
    "All current demo orders have been assigned to vehicles. Open the route page to view map paths.",
  "正式版本建议接入 OR-Tools / VROOM，并用 OSRM 或商用地图 API 计算真实道路时间。":
    "For production, connect OR-Tools/VROOM and use OSRM or a commercial map API for real road time.",
  "来自上传 Data 的原始订单": "Raw orders from uploaded Data",
  "来自当前路线数据的演示订单": "Demo orders from current route data",
  "来自上传 Data 的车辆主数据": "Vehicle master data from uploaded Data",
  "按当前计划车辆能力生成": "Generated from current planned vehicle capacity",
  "演示算法会考虑经纬度、车辆载重/容积、预计行驶时间、9:00-17:30 作业时间和 12:00-13:00 午休。当前为前端启发式排车，用于客户演示，不等同正式最优算法。":
    "The demo algorithm considers coordinates, vehicle weight/volume capacity, estimated travel time, 9:00-17:30 working hours, and 12:00-13:00 lunch break. It is a front-end heuristic for customer demos, not a production optimizer.",
};
Object.assign(I18N.zh, I18N_EXTRA_ZH);
Object.assign(I18N.ja, I18N_EXTRA_JA);
Object.assign(I18N.en, I18N_EXTRA_EN);
const I18N_EXTRA_FIX2_ZH = {
  "筛选": "筛选",
  "排车": "排车",
  "成本": "成本",
  "汇报": "汇报",
  "成本分析": "成本分析",
  "方案汇报": "方案汇报",
  "Mock Login（非安全认证）": "Mock Login（非安全认证）",
  "账号：": "账号：",
  "Mock 密码：": "Mock 密码：",
  "当前为测试环境，登录仅用于演示。": "当前为测试环境，登录仅用于演示。",
  "按行驶距离": "按行驶距离",
  "按停靠批次": "按停靠批次",
  "按货物件数": "按货物件数",
  "按容积利用率": "按容积利用率",
  "智能洞察与建议": "智能洞察与建议",
  "ESG 仪表板": "ESG 仪表板",
  "小型汽油车 0.192 kg/km": "小型汽油车 0.192 kg/km",
  "轻型混动 0.147 kg/km": "轻型混动 0.147 kg/km",
  "节能场景 0.120 kg/km": "节能场景 0.120 kg/km",
  "有 ": "有 ",
  "存在 ": "存在 ",
  " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。":
    " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。",
  " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。":
    " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。",
  " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。":
    " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。",
  " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。":
    " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。",
  "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。":
    "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。",
  "当前分析范围": "当前分析范围",
  "平均每路线批次": "平均每路线批次",
  "停靠批次 / 路线": "停靠批次 / 路线",
  "平均每路线距离": "平均每路线距离",
  "km / 路线": "km / 路线",
  "装载效率": "装载效率",
  "路线排行": "路线排行",
  "重点路线": "重点路线",
  "最长路线：": "最长路线：",
  "停靠最多：": "停靠最多：",
  "容积最高：": "容积最高：",
  "最晚回库：": "最晚回库：",
  "车辆利用率分布": "车辆利用率分布",
  "改善方向": "改善方向",
  "问题类型": "问题类型",
  "判断依据": "判断依据",
  "建议动作": "建议动作",
  "低装载": "低装载",
  "容积利用率低于 40%": "容积利用率低于 40%",
  "合并相邻区域或调整发车频次": "合并相邻区域或调整发车频次",
  "长距离": "长距离",
  "单路线超过 80km": "单路线超过 80km",
  "复核区域边界、顺序及中途补货可能性": "复核区域边界、顺序及中途补货可能性",
  "高装载": "高装载",
  "容积利用率高于 90%": "容积利用率高于 90%",
  "预留安全容量，避免临时订单超载": "预留安全容量，避免临时订单超载",
  "主数据风险": "主数据风险",
  "缺坐标或地址不完整": "缺坐标或地址不完整",
  "回流客户地址与订单主数据治理": "回流客户地址与订单主数据治理",
  "估算 CO₂": "估算 CO₂",
  "排放因子 ": "排放因子 ",
  "每件货物": "每件货物",
  "每停靠批次": "每停靠批次",
  "树木年吸收约当": "树木年吸收约当",
  "按 21.77 kg/棵/年估算": "按 21.77 kg/棵/年估算",
  "高排放路线 Top 10": "高排放路线 Top 10",
  "CO₂": "CO₂",
  "减排建议": "减排建议",
  "优先": "优先",
  "合并低容积利用率且同方向路线，减少空驶。":
    "合并低容积利用率且同方向路线，减少空驶。",
  "对超过 80km 的路线复核地理顺序和缺坐标点。":
    "对超过 80km 的路线复核地理顺序和缺坐标点。",
  "注意": "注意",
  "当前 CO₂ 基于估算行驶距离，不是路网导航距离。":
    "当前 CO₂ 基于估算行驶距离，不是路网导航距离。",
};
const I18N_EXTRA_FIX2_JA = {
  "筛选": "絞り込み",
  "排车": "配車",
  "成本": "コスト",
  "汇报": "レポート",
  "成本分析": "コスト分析",
  "方案汇报": "計画レポート",
  "Mock Login（非安全认证）": "Mockログイン（安全な認証ではありません）",
  "账号：": "アカウント：",
  "Mock 密码：": "Mockパスワード：",
  "当前为测试环境，登录仅用于演示。": "現在はローカルテスト環境です。ログインはデモ専用です。",
  "按行驶距离": "走行距離順",
  "按停靠批次": "停車バッチ順",
  "按货物件数": "貨物数順",
  "按容积利用率": "容積利用率順",
  "智能洞察与建议": "スマート示唆と提案",
  "ESG 仪表板": "ESGダッシュボード",
  "小型汽油车 0.192 kg/km": "小型ガソリン車 0.192 kg/km",
  "轻型混动 0.147 kg/km": "ライトハイブリッド 0.147 kg/km",
  "节能场景 0.120 kg/km": "省エネシナリオ 0.120 kg/km",
  "有 ": "",
  "存在 ": "",
  " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。":
    "本のルートで容積利用率が40%未満です。同一エリア・同一時間枠のルートと統合可能か確認してください。",
  " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。":
    "本のルートで容積利用率が90%以上です。臨時追加注文による過積載リスクに注意してください。",
  " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。":
    "本のルートが80kmを超えています。配送順、エリア分割、作業時間を見直してください。",
  " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。":
    "件の座標欠落があります。ルート最適化とETA精度に影響するため、顧客住所マスタを優先的に整備してください。",
  "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。":
    "現在の絞り込み範囲では、積載や距離に明確な異常は見られず、ルート構成は比較的安定しています。",
  "当前分析范围": "現在の分析範囲",
  "平均每路线批次": "ルート別平均バッチ",
  "停靠批次 / 路线": "停車バッチ / ルート",
  "平均每路线距离": "ルート別平均距離",
  "km / 路线": "km / ルート",
  "装载效率": "積載効率",
  "路线排行": "ルートランキング",
  "重点路线": "注目ルート",
  "最长路线：": "最長ルート：",
  "停靠最多：": "停車最多：",
  "容积最高：": "容積最高：",
  "最晚回库：": "最終帰庫：",
  "车辆利用率分布": "車両利用率分布",
  "改善方向": "改善方向",
  "问题类型": "課題タイプ",
  "判断依据": "判断基準",
  "建议动作": "推奨アクション",
  "低装载": "低積載",
  "容积利用率低于 40%": "容積利用率40%未満",
  "合并相邻区域或调整发车频次": "隣接エリア統合または出発頻度調整",
  "长距离": "長距離",
  "单路线超过 80km": "単一ルート80km超",
  "复核区域边界、顺序及中途补货可能性":
    "エリア境界、順序、途中補充の可能性を確認",
  "高装载": "高積載",
  "容积利用率高于 90%": "容積利用率90%超",
  "预留安全容量，避免临时订单超载":
    "安全余裕を確保し、臨時注文による過積載を回避",
  "主数据风险": "マスタデータリスク",
  "缺坐标或地址不完整": "座標欠落または住所不完全",
  "回流客户地址与订单主数据治理": "顧客住所・注文マスタ整備へ戻す",
  "估算 CO₂": "推定CO₂",
  "排放因子 ": "排出係数 ",
  "每件货物": "貨物1件あたり",
  "每停靠批次": "停車バッチあたり",
  "树木年吸收约当": "樹木年間吸収量換算",
  "按 21.77 kg/棵/年估算": "21.77 kg/本/年で推定",
  "高排放路线 Top 10": "高排出ルート Top 10",
  "CO₂": "CO₂",
  "减排建议": "削減提案",
  "优先": "優先",
  "合并低容积利用率且同方向路线，减少空驶。":
    "低容積利用率で同方向のルートを統合し、空走を削減。",
  "对超过 80km 的路线复核地理顺序和缺坐标点。":
    "80km超のルートは地理順序と座標欠落地点を確認。",
  "注意": "注意",
  "当前 CO₂ 基于估算行驶距离，不是路网导航距离。":
    "現在のCO₂は推定走行距離に基づき、道路ネットワーク距離ではありません。",
};
const I18N_EXTRA_FIX2_EN = {
  "筛选": "Filter",
  "排车": "Dispatch",
  "成本": "Cost",
  "汇报": "Report",
  "成本分析": "Cost Analysis",
  "方案汇报": "Plan Report",
  "Mock Login（非安全认证）": "Mock Login (not secure authentication)",
  "账号：": "Account: ",
  "Mock 密码：": "Mock password: ",
  "当前为测试环境，登录仅用于演示。": "This is a local test environment. Login is for demonstration only.",
  "按行驶距离": "By travel distance",
  "按停靠批次": "By stop batches",
  "按货物件数": "By packages",
  "按容积利用率": "By volume utilization",
  "智能洞察与建议": "Smart Insights and Recommendations",
  "ESG 仪表板": "ESG Dashboard",
  "小型汽油车 0.192 kg/km": "Small gasoline vehicle 0.192 kg/km",
  "轻型混动 0.147 kg/km": "Light hybrid 0.147 kg/km",
  "节能场景 0.120 kg/km": "Energy-saving scenario 0.120 kg/km",
  "有 ": "",
  "存在 ": "",
  " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。":
    " route(s) have volume utilization below 40%. Check whether they can be merged with routes in the same area and time window.",
  " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。":
    " route(s) have volume utilization at or above 90%. Watch for overload risk from last-minute orders.",
  " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。":
    " route(s) exceed 80 km. Review delivery sequence, area split, and operating time.",
  " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。":
    " record(s) are missing coordinates. Prioritize customer address master data cleanup, otherwise route optimization and ETA will be affected.",
  "当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。":
    "No obvious load or distance exceptions were found in the current filter range. The route structure is relatively stable.",
  "当前分析范围": "Current analysis range",
  "平均每路线批次": "Avg. batches per route",
  "停靠批次 / 路线": "Stop batches / route",
  "平均每路线距离": "Avg. distance per route",
  "km / 路线": "km / route",
  "装载效率": "Loading efficiency",
  "路线排行": "Route ranking",
  "重点路线": "Key routes",
  "最长路线：": "Longest route:",
  "停靠最多：": "Most stops:",
  "容积最高：": "Highest volume:",
  "最晚回库：": "Latest return:",
  "车辆利用率分布": "Vehicle utilization distribution",
  "改善方向": "Improvement direction",
  "问题类型": "Issue type",
  "判断依据": "Basis",
  "建议动作": "Recommended action",
  "低装载": "Low load",
  "容积利用率低于 40%": "Volume utilization below 40%",
  "合并相邻区域或调整发车频次":
    "Merge adjacent areas or adjust dispatch frequency",
  "长距离": "Long distance",
  "单路线超过 80km": "Single route over 80 km",
  "复核区域边界、顺序及中途补货可能性":
    "Review area boundaries, sequence, and mid-route replenishment",
  "高装载": "High load",
  "容积利用率高于 90%": "Volume utilization above 90%",
  "预留安全容量，避免临时订单超载":
    "Reserve safety capacity to avoid overload from ad hoc orders",
  "主数据风险": "Master data risk",
  "缺坐标或地址不完整": "Missing coordinates or incomplete address",
  "回流客户地址与订单主数据治理":
    "Feed back to customer address and order master data cleanup",
  "估算 CO₂": "Estimated CO₂",
  "排放因子 ": "Emission factor ",
  "每件货物": "Per package",
  "每停靠批次": "Per stop batch",
  "树木年吸收约当": "Annual tree absorption equivalent",
  "按 21.77 kg/棵/年估算": "Estimated at 21.77 kg/tree/year",
  "高排放路线 Top 10": "Top 10 high-emission routes",
  "CO₂": "CO₂",
  "减排建议": "Emission reduction suggestions",
  "优先": "Priority",
  "合并低容积利用率且同方向路线，减少空驶。":
    "Merge low-utilization routes in the same direction to reduce empty mileage.",
  "对超过 80km 的路线复核地理顺序和缺坐标点。":
    "Review geographic sequence and missing-coordinate stops for routes over 80 km.",
  "注意": "Note",
  "当前 CO₂ 基于估算行驶距离，不是路网导航距离。":
    "Current CO₂ is based on estimated travel distance, not road-network navigation distance.",
};
Object.assign(I18N.zh, I18N_EXTRA_FIX2_ZH);
Object.assign(I18N.ja, I18N_EXTRA_FIX2_JA);
Object.assign(I18N.en, I18N_EXTRA_FIX2_EN);
const I18N_V12_ZH = {
  "成本": "成本", "汇报": "汇报", "成本分析": "成本分析", "方案汇报": "方案汇报",
  "当前候选中最少车辆": "当前候选中最少车辆", "当前候选中最短": "当前候选中最短", "装载利用率优先": "装载利用率优先",
  "当前候选中最低成本": "当前候选中最低成本", "当前候选中最低碳排": "当前候选中最低碳排", "当前候选中综合平衡": "当前候选中综合平衡",
  "可规划率": "可规划率", "阻断": "阻断", "虚拟车辆": "虚拟车辆", "规划状态": "规划状态",
  "求解时限": "求解时限", "平均速度": "平均速度", "每停靠服务": "每停靠服务", "道路系数": "道路系数", "班次延长": "班次延长", "虚拟同型车": "虚拟同型车",
  "生成并审计候选池": "生成并审计候选池", "保存 Baseline": "保存 Baseline", "恢复 Baseline": "恢复 Baseline", "评估增加车辆后的改善": "评估增加车辆后的改善",
  "应用所选方案": "应用所选方案", "恢复应用前方案": "恢复应用前方案", "求解前 Fleet Adequacy": "求解前 Fleet Adequacy", "目标审计": "目标审计",
  "去重候选池": "去重候选池", "所选方案路线": "所选方案路线", "未分配诊断": "未分配诊断", "What-if 对比": "What-if 对比", "有限人工调度": "有限人工调度", "模型假设与边界": "模型假设与边界",
  "需求": "需求", "可用运力": "可用运力", "车辆下界": "车辆下界", "100% 服务预判": "100% 服务预判", "可能": "可能", "当前不可能": "当前不可能", "主要限制": "主要限制",
  "选择": "选择", "实际标签": "实际标签", "服务水平": "服务水平", "验证": "验证", "车辆": "车辆", "距离": "距离", "完工": "完工", "利用率分": "利用率分", "综合分": "综合分", "引擎 / 指纹": "引擎 / 指纹",
  "未获得目标标签": "未获得目标标签", "请求": "请求", "不可直接比较": "不可直接比较", "最低": "最低", "尚无通过验证的候选": "尚无通过验证的候选",
  "状态": "状态", "订单": "订单", "置信度": "置信度", "证据": "证据", "建议动作": "建议动作", "进入人工调度": "进入人工调度", "退出编辑": "退出编辑",
  "路线内订单": "路线内订单", "目标路线": "目标路线", "移至路线": "移至路线", "移回未分配池": "移回未分配池", "未分配订单": "未分配订单", "加入选定路线": "加入选定路线", "重置求解器方案": "重置求解器方案",
  "数据下载": "数据下载", "方案审计 CSV": "方案审计 CSV", "v1.3 审计快照": "v1.3 审计快照", "下载审计 JSON": "下载审计 JSON"
};
const I18N_V12_JA = {
  "成本": "コスト", "汇报": "レポート", "成本分析": "コスト分析", "方案汇报": "計画レポート",
  "当前候选中最少车辆": "候補内の最少車両", "当前候选中最短": "候補内の最短距離", "装载利用率优先": "積載利用率優先",
  "当前候选中最低成本": "候補内の最低コスト", "当前候选中最低碳排": "候補内の最低CO₂", "当前候选中综合平衡": "候補内の総合バランス",
  "可规划率": "計画可能率", "阻断": "ブロック", "虚拟车辆": "仮想車両", "规划状态": "計画状態",
  "求解时限": "求解時間", "平均速度": "平均速度", "每停靠服务": "停車サービス時間", "道路系数": "道路係数", "班次延长": "シフト延長", "虚拟同型车": "仮想同型車",
  "生成并审计候选池": "候補を生成・監査", "保存 Baseline": "Baselineを保存", "恢复 Baseline": "Baselineを復元", "评估增加车辆后的改善": "増車効果を評価",
  "应用所选方案": "選択計画を適用", "恢复应用前方案": "適用前に復元", "求解前 Fleet Adequacy": "求解前の運力診断", "目标审计": "目的監査",
  "去重候选池": "重複排除候補", "所选方案路线": "選択計画のルート", "未分配诊断": "未割当診断", "What-if 对比": "What-if比較", "有限人工调度": "限定手動配車", "模型假设与边界": "モデル前提と限界",
  "需求": "需要", "可用运力": "利用可能運力", "车辆下界": "車両数下限", "100% 服务预判": "100%サービス予測", "可能": "可能", "当前不可能": "現状では不可", "主要限制": "主な制約",
  "选择": "選択", "实际标签": "実績ラベル", "服务水平": "サービス水準", "验证": "検証", "车辆": "車両", "距离": "距離", "完工": "完了", "利用率分": "利用率スコア", "综合分": "総合スコア", "引擎 / 指纹": "エンジン / 指紋",
  "未获得目标标签": "目的ラベルなし", "请求": "要求", "不可直接比较": "直接比較不可", "最低": "最低", "尚无通过验证的候选": "検証済み候補なし",
  "状态": "状態", "订单": "注文", "置信度": "信頼度", "证据": "根拠", "建议动作": "推奨対応", "进入人工调度": "手動配車を開始", "退出编辑": "編集を終了",
  "路线内订单": "ルート内注文", "目标路线": "移動先ルート", "移至路线": "ルートへ移動", "移回未分配池": "未割当へ戻す", "未分配订单": "未割当注文", "加入选定路线": "選択ルートへ追加", "重置求解器方案": "求解結果へリセット",
  "数据下载": "データダウンロード", "方案审计 CSV": "計画監査CSV", "v1.3 审计快照": "v1.3監査スナップショット", "下载审计 JSON": "監査JSONをダウンロード"
};
const I18N_V12_EN = {
  "成本": "Cost", "汇报": "Report", "成本分析": "Cost Analysis", "方案汇报": "Plan Report",
  "当前候选中最少车辆": "Fewest Vehicles in Current Pool", "当前候选中最短": "Shortest in Current Pool", "装载利用率优先": "Load Utilization Priority",
  "当前候选中最低成本": "Lowest Cost in Current Pool", "当前候选中最低碳排": "Lowest CO2 in Current Pool", "当前候选中综合平衡": "Best Balanced in Current Pool",
  "可规划率": "Plannable Rate", "阻断": "Blocked", "虚拟车辆": "Virtual Vehicles", "规划状态": "Planning Status",
  "求解时限": "Solve Limit", "平均速度": "Average Speed", "每停靠服务": "Service per Stop", "道路系数": "Road Factor", "班次延长": "Shift Extension", "虚拟同型车": "Virtual Peer Vehicles",
  "生成并审计候选池": "Generate and Audit Candidates", "保存 Baseline": "Save Baseline", "恢复 Baseline": "Restore Baseline", "评估增加车辆后的改善": "Evaluate Added Capacity",
  "应用所选方案": "Apply Selected Plan", "恢复应用前方案": "Restore Pre-apply Plan", "求解前 Fleet Adequacy": "Pre-solve Fleet Adequacy", "目标审计": "Objective Audit",
  "去重候选池": "Deduplicated Candidate Pool", "所选方案路线": "Selected Plan Routes", "未分配诊断": "Unassigned Diagnostics", "What-if 对比": "What-if Comparison", "有限人工调度": "Limited Manual Dispatch", "模型假设与边界": "Model Assumptions and Limits",
  "需求": "Demand", "可用运力": "Available Capacity", "车辆下界": "Vehicle Lower Bound", "100% 服务预判": "100% Service Precheck", "可能": "Possible", "当前不可能": "Not Currently Possible", "主要限制": "Primary Constraint",
  "选择": "Select", "实际标签": "Actual Labels", "服务水平": "Service Level", "验证": "Verification", "车辆": "Vehicles", "距离": "Distance", "完工": "Completion", "利用率分": "Utilization Score", "综合分": "Balanced Score", "引擎 / 指纹": "Engine / Fingerprint",
  "未获得目标标签": "No Objective Label", "请求": "Requested", "不可直接比较": "Not Directly Comparable", "最低": "Minimum", "尚无通过验证的候选": "No Verified Candidate",
  "状态": "Status", "订单": "Order", "置信度": "Confidence", "证据": "Evidence", "建议动作": "Suggested Action", "进入人工调度": "Enter Manual Dispatch", "退出编辑": "Exit Editing",
  "路线内订单": "Route Order", "目标路线": "Target Route", "移至路线": "Move to Route", "移回未分配池": "Move to Unassigned", "未分配订单": "Unassigned Order", "加入选定路线": "Add to Selected Route", "重置求解器方案": "Reset to Solver Plan",
  "数据下载": "Data Downloads", "方案审计 CSV": "Plan Audit CSV", "v1.3 审计快照": "v1.3 Audit Snapshot", "下载审计 JSON": "Download Audit JSON"
};
Object.assign(I18N.zh, I18N_V12_ZH);
Object.assign(I18N.ja, I18N_V12_JA);
Object.assign(I18N.en, I18N_V12_EN);
const I18N_V13_EN = {
  "日期模式": "Date Mode", "单日规划": "Single-day Planning", "跨日汇总（按配送日独立规划）": "Multi-day Summary (independent by delivery date)",
  "每个配送日独立使用当日可用车队，不把多日需求压缩为一次车队容量。": "Each delivery date independently uses that day's fleet; multi-day demand is never compressed into one fleet cycle.",
  "单一配送日可生成六目标候选、What-if 和人工调整。": "A single delivery date supports six-objective candidates, What-if, and manual adjustments.",
  "跨日汇总": "Multi-day Summary", "汇总范围": "Summary Range", "前 60 单": "First 60 Orders", "前 120 单": "First 120 Orders", "前 240 单": "First 240 Orders", "全部订单": "All Orders",
  "构建并运行跨日汇总": "Build and Run Multi-day Summary", "取消剩余日期": "Cancel Remaining Dates", "日期数量": "Date Count", "总订单": "Total Orders", "加权服务率": "Weighted Service Rate", "峰值车辆": "Peak Vehicles", "每日子场景": "Daily Child Scenarios", "配送日": "Delivery Date", "进入": "Open", "进入单日": "Open Day",
  "每个配送日独立构建 Canonical Scenario、重新筛选车辆并求解。父级不生成跨日路线，也不能直接进入人工调度。": "Each date builds an independent Canonical Scenario, refilters vehicles, and solves separately. The parent creates no cross-day route and cannot enter manual dispatch.",
  "新增车辆模板": "Added Vehicle Template", "插入方式": "Insertion Method", "路线末尾": "Route End", "指定停靠点之后": "After Selected Stop", "自动最小增量位置": "Automatic Minimum-increment Position", "指定停靠点": "Selected Stop",
  "场景级原因": "Scenario-level Reasons", "当前没有可证明的场景级原因。": "No provable scenario-level reason is currently available.", "确定": "Deterministic", "可能": "Probable", "未知": "Unknown",
  "原始优先级会进入 Canonical Scenario、inputHash 与 OR-Tools 服务层级。": "Raw priority enters the Canonical Scenario, inputHash, and OR-Tools service hierarchy.",
  "内置 Demo 已进入 Preview。": "The bundled Demo is now in Preview.", "Plan Hash": "Plan Hash", "Editor State": "Editor State", "Last Action": "Last Action", "无": "None",
  "当前没有未分配或阻断订单。": "There are no unassigned or blocked orders.", "订单守恒通过，当前没有未分配或阻断订单。": "Order conservation passed; there are no unassigned or blocked orders."
};
const I18N_V13_JA = {
  "日期模式": "日付モード", "单日规划": "単日計画", "跨日汇总（按配送日独立规划）": "複数日サマリー（配送日ごとに独立計画）",
  "每个配送日独立使用当日可用车队，不把多日需求压缩为一次车队容量。": "各配送日は当日の車両を独立して使用し、複数日の需要を1回分の車両能力に圧縮しません。",
  "单一配送日可生成六目标候选、What-if 和人工调整。": "単一配送日では6目的候補、What-if、手動調整を利用できます。",
  "跨日汇总": "複数日サマリー", "汇总范围": "集計範囲", "前 60 单": "先頭60件", "前 120 单": "先頭120件", "前 240 单": "先頭240件", "全部订单": "全注文",
  "构建并运行跨日汇总": "複数日サマリーを構築・実行", "取消剩余日期": "残りの日付を中止", "日期数量": "日付数", "总订单": "総注文数", "加权服务率": "加重サービス率", "峰值车辆": "ピーク車両数", "每日子场景": "日別子シナリオ", "配送日": "配送日", "进入": "開く", "进入单日": "単日を開く",
  "每个配送日独立构建 Canonical Scenario、重新筛选车辆并求解。父级不生成跨日路线，也不能直接进入人工调度。": "各配送日は独立したCanonical Scenarioを構築し、車両を再選択して求解します。親集計は日跨ぎルートを生成せず、直接手動配車できません。",
  "新增车辆模板": "追加車両テンプレート", "插入方式": "挿入方法", "路线末尾": "ルート末尾", "指定停靠点之后": "指定停車地点の後", "自动最小增量位置": "自動最小増分位置", "指定停靠点": "指定停車地点",
  "场景级原因": "シナリオレベル理由", "当前没有可证明的场景级原因。": "現在、証明可能なシナリオレベル理由はありません。", "确定": "確定", "可能": "可能性", "未知": "不明",
  "原始优先级会进入 Canonical Scenario、inputHash 与 OR-Tools 服务层级。": "元の優先度はCanonical Scenario、inputHash、OR-Toolsのサービス階層に入ります。",
  "内置 Demo 已进入 Preview。": "内蔵デモをプレビューに読み込みました。", "Plan Hash": "Plan Hash", "Editor State": "Editor State", "Last Action": "最終操作", "无": "なし",
  "订单守恒通过，当前没有未分配或阻断订单。": "注文保存則に合格し、未割当・ブロック注文はありません。"
};
Object.assign(I18N.en, I18N_V13_EN);
Object.assign(I18N.ja, I18N_V13_JA);
function getSavedLang() {
  try {
    return localStorage.getItem("flowmap_lang") || "zh";
  } catch (err) {
    return "zh";
  }
}
function saveLang(lang) {
  try {
    localStorage.setItem("flowmap_lang", lang);
  } catch (err) {}
}
let currentLang = getSavedLang();
function L(s) {
  return (I18N[currentLang] && I18N[currentLang][s]) || s;
}
function sourceKeyForText(text) {
  const current = String(text || "").trim();
  if (!current) return current;
  for (const lang of ["zh", "ja", "en"]) {
    for (const [source, target] of Object.entries(I18N[lang] || {})) {
      if (target === current) return source;
    }
  }
  return current;
}
function translateMixedText(text, dict) {
  let out = String(text || "");
  const keys = Object.keys(I18N.zh || {}).filter((k) =>
    k && Object.prototype.hasOwnProperty.call(dict, k) && dict[k] !== k
  ).sort((a, b) => b.length - a.length);
  for (const key of keys) out = out.split(key).join(dict[key]);
  return out;
}
function translateTextNodes(root = document.body) {
  const dict = I18N[currentLang] || {};
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const raw = node.nodeValue.trim();
      if (!raw) return NodeFilter.FILTER_SKIP;
      return /[\u3400-\u9fffぁ-ゟ゠-ヿ]/.test(raw) ||
          node.parentElement?.dataset?.i18nSource
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const raw = n.nodeValue;
    const current = raw.trim();
    let key = n.parentElement?.dataset?.i18nSource || sourceKeyForText(current);
    if (!n.parentElement?.dataset?.i18nSource && n.parentElement) {
      n.parentElement.dataset.i18nSource = key;
    }
    const next = dict[key] || translateMixedText(key, dict);
    if (next && next !== current) n.nodeValue = raw.replace(current, next);
  });
}
function translateAttributes(lang) {
  const dict = I18N[lang] || {};
  document.querySelectorAll("[placeholder]").forEach((el) => {
    const source = el.dataset.i18nPlaceholder ||
      sourceKeyForText(el.getAttribute("placeholder"));
    if (!el.dataset.i18nPlaceholder) el.dataset.i18nPlaceholder = source;
    el.setAttribute(
      "placeholder",
      dict[source] || translateMixedText(source, dict) || source,
    );
  });
  document.querySelectorAll("[title]").forEach((el) => {
    const source = el.dataset.i18nTitle ||
      sourceKeyForText(el.getAttribute("title"));
    if (!el.dataset.i18nTitle) el.dataset.i18nTitle = source;
    el.setAttribute(
      "title",
      dict[source] || translateMixedText(source, dict) || source,
    );
  });
  document.querySelectorAll("option").forEach((el) => {
    const source = el.dataset.i18nSource || sourceKeyForText(el.textContent);
    if (!el.dataset.i18nSource) el.dataset.i18nSource = source;
    const next = dict[source] || translateMixedText(source, dict);
    if (next && next !== el.textContent) el.textContent = next;
  });
}
function applyLanguage(lang = currentLang) {
  currentLang = lang;
  saveLang(lang);
  document.documentElement.lang = lang === "ja"
    ? "ja"
    : lang === "en"
    ? "en"
    : "zh-CN";
  ["loginLang"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = lang;
  });
  translateAttributes(lang);
  translateTextNodes();
}
const ORIGINAL_DATA = JSON.parse(JSON.stringify(DATA));
let transportDataApplied = false;
let RAW_DATA = null;
let optimizerPlan = null;
let uploadPreview = null;
let dataStatus = "原始数据";
let dataSource = "内置 routes-data.js";
const byDate = [...new Set(DATA.routes.map((r) => r.date))].sort();
const dateFilter = document.getElementById("dateFilter"),
  routeFilter = document.getElementById("routeFilter"),
  vehicleFilter = document.getElementById("vehicleFilter"),
  routeList = document.getElementById("routeList"),
  metrics = document.getElementById("metrics"),
  detailPanel = document.getElementById("detailPanel"),
  routeCount = document.getElementById("routeCount");
const state = {
  date: byDate[0],
  route: "ALL",
  vehicle: "ALL",
  checkedRoutes: new Set(),
  search: "",
  showMissing: true,
  showSplit: true,
  mapTheme: "liberty",
  mapPreset: "dispatch",
  labels: {
    depot: true,
    route: true,
    deliveryLine: true,
    stop: false,
    time: false,
    segmentDistance: false,
  },
  routeWidth: 4,
};
const dashState = {
  analysisDate: "ALL",
  carbonDate: "ALL",
  overviewDate: "ALL",
  carbonVehicle: "ALL",
  carbonUtil: "ALL",
  carbonDistance: "ALL",
};
function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}
function fillSelect(el, opts, allLabel) {
  el.innerHTML = "";
  if (allLabel) el.append(new Option(allLabel, "ALL"));
  opts.forEach((o) => el.append(new Option(o.label ?? o, o.value ?? o)));
}
fillSelect(dateFilter, byDate.map((d) => ({ label: d, value: d })));
dateFilter.value = state.date;
function routesForDate() {
  return DATA.routes.filter((r) => r.date === state.date);
}
function routeIdsVisible() {
  const routes = routesForDate().filter((r) =>
    state.vehicle === "ALL" || r.vehicleId === state.vehicle
  ).filter((r) => state.route === "ALL" || r.routeId === state.route);
  return new Set(
    routes.filter((r) =>
      state.checkedRoutes.size === 0 || state.checkedRoutes.has(r.routeId)
    ).map((r) => r.routeId),
  );
}
function updateRouteCount() {
  if (!routeCount) return;
  const source = routeIdsVisible().size + " 条路线";
  routeCount.dataset.i18nSource = source;
  const dict = I18N[currentLang] || {};
  routeCount.textContent = dict[source] || translateMixedText(source, dict);
}
function updateControls() {
  const routes = routesForDate();
  fillSelect(
    routeFilter,
    routes.map((r) => ({
      label: r.routeId + " / " + r.vehicleId,
      value: r.routeId,
    })),
    "全部路线",
  );
  const vehicles = [
    ...new Map(
      routes.map(
        (r) => [r.vehicleId, {
          label: r.vehicleId + " / " + r.vehicleName,
          value: r.vehicleId,
        }],
      ),
    ).values(),
  ];
  fillSelect(vehicleFilter, vehicles, "全部车辆");
  routeFilter.value = state.route;
  vehicleFilter.value = state.vehicle;
  routeList.innerHTML = "";
  routes.forEach((r) => {
    const row = document.createElement("label");
    row.className = "route-row";
    row.dataset.routeId = r.routeId;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.route = String(r.routeId || "");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = /^#[0-9a-f]{3,8}$/i.test(String(r.color || "")) ? r.color : "#2563eb";
    const copy = document.createElement("span");
    copy.append(document.createTextNode(String(r.routeId || "-")), document.createElement("br"));
    const meta = document.createElement("small");
    meta.textContent = `${r.vehicleId || "-"} · ${Number(r.stops || 0)} Stops · ${r.end || "-"}`;
    copy.append(meta);
    const utilization = document.createElement("small");
    utilization.className = "route-util";
    utilization.title = "容积利用率：本路线装载容量 / 车辆最大装载容量";
    utilization.textContent = String(r.volumeUtil || "0%");
    row.append(checkbox, dot, copy, utilization);
    routeList.append(row);
  });
  state.checkedRoutes = new Set(routes.map((r) => r.routeId));
  updateRouteCount();
}
function selectedRoutes() {
  const ids = routeIdsVisible();
  return DATA.routes.filter((r) => ids.has(r.routeId));
}
function matchesSearch(p) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  return [p.routeId, p.vehicleId, p.code, p.name, p.addr, p.cargoCodes].join(
    " ",
  ).toLowerCase().includes(q);
}
function selectedRouteFeatures() {
  const ids = routeIdsVisible();
  return {
    type: "FeatureCollection",
    features: DATA.routeGeoJson.features.filter((f) =>
      ids.has(f.properties.routeId) && matchesSearch(f.properties)
    ).map(enrichRouteFeature),
  };
}
function selectedStopFeatures() {
  const ids = routeIdsVisible();
  return {
    type: "FeatureCollection",
    features: DATA.stopGeoJson.features.filter((f) =>
      ids.has(f.properties.routeId) && matchesSearch(f.properties)
    ).map(enrichStopFeature),
  };
}
function haversineKm(a, b) {
  const R = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function selectedSegmentFeatures() {
  const ids = routeIdsVisible();
  const features = [];
  DATA.routeGeoJson.features.filter((f) =>
    ids.has(f.properties.routeId) && matchesSearch(f.properties)
  ).forEach((f) => {
    const coords = (f.geometry && f.geometry.coordinates) || [];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      if (
        !Array.isArray(a) || !Array.isArray(b) ||
        (a[0] === b[0] && a[1] === b[1])
      ) continue;
      const km = haversineKm(a, b) * Number(APP_CONFIG.roadDistanceFactor || 1.35);
      if (km < 0.15) continue;
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        },
        properties: {
          routeId: f.properties.routeId,
          segmentKm: km,
          segmentLabel: km.toFixed(km >= 10 ? 0 : 1) + " km",
          focus: state.route === "ALL" || f.properties.routeId === state.route
            ? 1
            : 0,
        },
      });
    }
  });
  return { type: "FeatureCollection", features };
}
const EMPTY_FC = { type: "FeatureCollection", features: [] };
const ROAD_ROUTE_CACHE = new Map();
let roadRouteRequestToken = 0;
function setStraightRouteVisibility(active) {
  if (!window.map || !map || !map.loaded || !map.loaded()) return;
  if (map.getLayer("route-lines")) {
    map.setPaintProperty("route-lines", "line-opacity", active ? 0 : 0.86);
  }
  if (map.getLayer("route-glow")) {
    map.setPaintProperty("route-glow", "line-opacity", active ? 0 : 0.14);
  }
  if (map.getLayer("route-arrows")) {
    map.setPaintProperty("route-arrows", "text-opacity", active ? 0 : 1);
  }
}
function emptyRoadRoute() {
  if (
    window.map && map && map.loaded && map.loaded() &&
    map.getSource("road-routes")
  ) map.getSource("road-routes").setData(EMPTY_FC);
  setStraightRouteVisibility(false);
}
function routeLineFeature(routeId) {
  return DATA.routeGeoJson.features.find((f) =>
    f.properties.routeId === routeId
  );
}
function routeColor(routeId) {
  const r = DATA.routes.find((x) => x.routeId === routeId);
  return r && r.color ? r.color : "#0ea5e9";
}
function routeVisualColor() {
  return ["case", ["==", ["get", "focus"], 1], ["get", "color"], [
    "get",
    "dimColor",
  ]];
}
function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}
function routeCarbonScore(r) {
  return (Number(r.km) || 0) * (Number(r.packages) || 0) * 0.192;
}
function routeCarbonIntensity(r) {
  return routeCarbonScore(r) / Math.max(1, Number(r.packages) || 1);
}
function carbonColor(score, max) {
  const t = clamp01(score / Math.max(1, max || 1));
  return t > .72
    ? "#dc2626"
    : t > .46
    ? "#f59e0b"
    : t > .24
    ? "#84cc16"
    : "#16a34a";
}
function stopHeatWeight(p) {
  return clamp01(
    ((Number(p.count) || 0) / 70) + ((Number(p.travelKm) || 0) / 95) +
      ((Number(p.weight) || 0) / 900000) + ((Number(p.volume) || 0) / 9000000),
  );
}
function routeCarbonMax() {
  const routes = routesForDate();
  return Math.max(1, ...routes.map(routeCarbonScore));
}
function layerVisibility(on) {
  return on ? "visible" : "none";
}
function setLayerVisible(id, on) {
  if (map.getLayer(id)) {
    map.setLayoutProperty(id, "visibility", layerVisibility(on));
  }
}
function routeWidthBase() {
  return Math.max(1, Number(state.routeWidth) || 4);
}
function enrichRouteFeature(f) {
  const p = f.properties || {};
  const r = DATA.routes.find((x) => x.routeId === p.routeId) || {};
  const util = parseFloat(r.volumeUtil) || 0;
  const km = Number(r.km) || 0;
  let color = p.color || r.color || "#2563eb";
  if (state.mapPreset === "esg") {
    color = carbonColor(routeCarbonScore(r), routeCarbonMax());
  }
  if (state.mapPreset === "focus") {
    color = state.route === "ALL"
      ? "#64748b"
      : (p.color || r.color || "#2563eb");
  }
  if (state.mapPreset === "client") color = "#003b79";
  return Object.assign({}, f, {
    properties: Object.assign({}, p, {
      color,
      dimColor: state.mapPreset === "focus" ? "#94a3b8" : color,
      focus: state.route === "ALL" || p.routeId === state.route ? 1 : 0,
      routeLabel: p.routeId || "",
      carbonScore: routeCarbonScore(r),
      carbonIntensity: routeCarbonIntensity(r),
      util,
      km,
    }),
  });
}
function enrichStopFeature(f) {
  const p = f.properties || {};
  return Object.assign({}, f, {
    properties: Object.assign({}, p, {
      stopNameLabel: p.name || p.code || "",
      timeLabel: p.arrive || "",
      labelText: state.labels.time
        ? (p.arrive || "")
        : (p.name || p.code || ""),
      heatWeight: stopHeatWeight(p),
      focus: state.route === "ALL" || p.routeId === state.route ? 1 : 0,
    }),
  });
}
function applyMapVisuals() {
  if (!window.map || !map || !map.loaded || !map.loaded()) return;
  const focus = state.mapPreset === "focus" && state.route !== "ALL";
  const width = routeWidthBase();
  const routeOpacity = state.mapPreset === "client"
    ? 0.96
    : state.mapPreset === "esg"
    ? 0.96
    : state.mapPreset === "focus"
    ? 0.76
    : 0.88;
  const stopOpacity = state.mapPreset === "client"
    ? 0.18
    : state.mapPreset === "esg"
    ? 0.36
    : state.mapPreset === "focus"
    ? 0.62
    : 0.94;
  const routeLineWidth = state.route === "ALL" ? width : width + 2.2;
  const glowWidth = routeLineWidth +
    (state.mapPreset === "client" ? 5 : state.mapPreset === "focus" ? 8 : 4);
  const esg = state.mapPreset === "esg";
  setLayerVisible("esg-backdrop", false);
  setLayerVisible("esg-stop-heat", esg);
  setLayerVisible("esg-route-heat", esg);
  if (map.getLayer("route-lines")) {
    map.setPaintProperty("route-lines", "line-color", routeVisualColor());
    map.setPaintProperty(
      "route-lines",
      "line-opacity",
      focus ? ["case", ["==", ["get", "focus"], 1], 0.98, 0.08] : routeOpacity,
    );
    map.setPaintProperty("route-lines", "line-width", routeLineWidth);
  }
  if (map.getLayer("route-glow")) {
    map.setPaintProperty("route-glow", "line-color", routeVisualColor());
    map.setPaintProperty(
      "route-glow",
      "line-opacity",
      focus
        ? ["case", ["==", ["get", "focus"], 1], 0.32, 0.02]
        : (state.mapPreset === "client"
          ? 0.08
          : state.mapPreset === "esg"
          ? 0.18
          : 0.14),
    );
    map.setPaintProperty("route-glow", "line-width", glowWidth);
  }
  if (map.getLayer("road-route-lines")) {
    map.setPaintProperty("road-route-lines", "line-width", width + 3.2);
  }
  if (map.getLayer("road-route-casing")) {
    map.setPaintProperty("road-route-casing", "line-width", width + 8);
  }
  if (map.getLayer("route-arrows")) {
    map.setPaintProperty(
      "route-arrows",
      "text-opacity",
      state.mapPreset === "client" ? 0 : state.mapPreset === "esg" ? 0.35 : 0.9,
    );
    setLayerVisible("route-arrows", state.mapPreset !== "client");
  }
  if (map.getLayer("stop-points")) {
    map.setPaintProperty(
      "stop-points",
      "circle-opacity",
      focus
        ? ["case", ["==", ["get", "focus"], 1], stopOpacity, 0.1]
        : stopOpacity,
    );
    map.setPaintProperty(
      "stop-points",
      "circle-radius",
      state.mapPreset === "client" ? 4.2 : state.mapPreset === "esg" ? 5.2 : [
        "interpolate",
        ["linear"],
        ["get", "count"],
        0,
        5.5,
        20,
        7.5,
        100,
        10,
      ],
    );
  }
  if (map.getLayer("clusters")) {
    map.setPaintProperty(
      "clusters",
      "circle-opacity",
      state.mapPreset === "client"
        ? 0.22
        : state.mapPreset === "esg"
        ? 0.46
        : 0.94,
    );
  }
  setLayerVisible("depot-label", state.labels.depot);
  setLayerVisible("depot-point", state.labels.depot);
  setLayerVisible("depot-halo", state.labels.depot);
  setLayerVisible("route-labels", state.labels.route);
  setLayerVisible(
    "segment-distance-labels",
    state.labels.segmentDistance && state.labels.deliveryLine,
  );
  setLayerVisible("route-lines", state.labels.deliveryLine);
  setLayerVisible("route-glow", state.labels.deliveryLine);
  setLayerVisible("esg-route-heat", esg && state.labels.deliveryLine);
  setLayerVisible(
    "route-arrows",
    state.labels.deliveryLine && state.mapPreset !== "client",
  );
  setLayerVisible("stop-labels", state.labels.stop || state.labels.time);
  setLayerVisible(
    "stop-points",
    (state.mapPreset !== "client" && state.mapPreset !== "esg") ||
      state.labels.stop || state.labels.time,
  );
  setLayerVisible(
    "clusters",
    state.mapPreset !== "client" && state.mapPreset !== "esg",
  );
  setLayerVisible(
    "cluster-count",
    state.mapPreset !== "client" && state.mapPreset !== "esg",
  );
  if (map.getLayer("route-labels")) {
    map.setLayoutProperty(
      "route-labels",
      "text-size",
      state.mapPreset === "esg" ? 16 : 15,
    );
    map.setPaintProperty(
      "route-labels",
      "text-color",
      state.mapPreset === "esg" ? "#166534" : "#003b79",
    );
    map.setPaintProperty(
      "route-labels",
      "text-opacity",
      state.labels.route ? 1 : 0,
    );
  }
  if (map.getLayer("stop-labels")) {
    map.setLayoutProperty(
      "stop-labels",
      "text-field",
      state.labels.time && !state.labels.stop
        ? ["get", "timeLabel"]
        : state.labels.time && state.labels.stop
        ? ["concat", ["get", "stopNameLabel"], "  ", ["get", "timeLabel"]]
        : ["get", "stopNameLabel"],
    );
    map.setPaintProperty(
      "stop-labels",
      "text-opacity",
      (state.labels.stop || state.labels.time) ? 0.96 : 0,
    );
  }
  if (map.getLayer("depot-label")) {
    map.setPaintProperty(
      "depot-label",
      "text-opacity",
      state.labels.depot ? 1 : 0,
    );
  }
  if (depotMarker && depotMarker.getElement) {
    depotMarker.getElement().style.display = state.labels.depot ? "" : "none";
  }
}
function applyMapPreset(name) {
  state.mapPreset = name;
  if (name === "client") {
    state.mapTheme = "positron";
    state.routeWidth = 6;
    state.labels.depot = true;
    state.labels.route = true;
    state.labels.deliveryLine = true;
    state.labels.stop = false;
    state.labels.time = false;
    state.labels.segmentDistance = false;
  } else if (name === "focus") {
    state.mapTheme = "dark";
    state.routeWidth = 7;
    state.labels.depot = true;
    state.labels.route = true;
    state.labels.deliveryLine = true;
    state.labels.stop = false;
    state.labels.time = true;
    state.labels.segmentDistance = false;
  } else if (name === "esg") {
    state.mapTheme = "positron";
    state.routeWidth = 8;
    state.labels.depot = true;
    state.labels.route = false;
    state.labels.deliveryLine = true;
    state.labels.stop = false;
    state.labels.time = false;
    state.labels.segmentDistance = false;
  } else {
    state.mapTheme = "liberty";
    state.routeWidth = 4;
    state.labels.depot = true;
    state.labels.route = true;
    state.labels.deliveryLine = true;
    state.labels.stop = false;
    state.labels.time = false;
    state.labels.segmentDistance = false;
  }
  syncMapOptionControls();
  if (window.map && map && map.setStyle) {
    map.once("style.load", () => {
      addFlowMapLayers();
      refreshMap();
      setTimeout(() => {
        applyMapVisuals();
        map.resize();
      }, 80);
    });
    map.setStyle(MAP_STYLES[state.mapTheme] || MAP_STYLES.liberty);
    setTimeout(() => {
      if (map && map.loaded && map.loaded()) {
        addFlowMapLayers();
        refreshMap();
        applyMapVisuals();
      }
    }, 900);
  } else refreshMap();
}
function syncMapOptionControls() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };
  const theme = document.getElementById("mapThemeSelect"),
    preset = document.getElementById("mapPresetSelect");
  if (theme) theme.value = state.mapTheme;
  if (preset) preset.value = state.mapPreset;
  set("depotLabelToggle", state.labels.depot);
  set("routeLabelToggle", state.labels.route);
  set("deliveryLineToggle", state.labels.deliveryLine);
  set("stopLabelToggle", state.labels.stop);
  set("timeLabelToggle", state.labels.time);
  set("segmentDistanceToggle", state.labels.segmentDistance);
  const width = document.getElementById("routeWidthRange"),
    out = document.getElementById("routeWidthValue");
  if (width) width.value = state.routeWidth;
  if (out) out.textContent = state.routeWidth;
}
const MAP_STYLES = APP_CONFIG.mapStyles || {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
  bright: "https://tiles.openfreemap.org/styles/bright",
};
let legacyMapThemeOverride=false;
window.addEventListener("stct-theme-change",()=>{if(!legacyMapThemeOverride&&window.map&&map)changeMapTheme(window.STCTPlatformV19?.theme?.basemap(APP_CONFIG)===MAP_STYLES.dark?"dark":"liberty");});
function changeMapTheme(theme) {
  state.mapTheme = theme;
  syncMapOptionControls();
  if (!window.map || !map) return;
  map.once("style.load", () => {
    addFlowMapLayers();
    refreshMap();
    setTimeout(() => {
      applyMapVisuals();
      map.resize();
    }, 80);
  });
  map.setStyle(MAP_STYLES[theme] || MAP_STYLES.liberty);
  setTimeout(() => {
    if (map && map.loaded && map.loaded()) {
      addFlowMapLayers();
      refreshMap();
      applyMapVisuals();
    }
  }, 900);
}
function roadFeature(routeId, coords) {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: { routeId, color: routeColor(routeId), source: "OSRM preview" },
  };
}
/* F15：路网 Provider 统一入口。默认仅本地路网（127.0.0.1:5001）；
   公共 OSRM 默认禁用——只有用户显式授权（localStorage stct.allowPublicOsrm='1'）才允许携带坐标外发；
   每次请求写审计日志（端点/坐标范围/策略/结果）。网络失败保留地理筛选身份，不冒充道路。 */
const PUBLIC_OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving/";
const LOCAL_OSRM_ENDPOINT = "http://127.0.0.1:5001/route/v1/driving/";
function publicOsrmAuthorized() {
  try { return globalThis.localStorage && globalThis.localStorage.getItem("stct.allowPublicOsrm") === "1"; } catch (_) { return false; }
}
function osrmAudit(entry) {
  const rec = Object.assign({ at: new Date().toISOString() }, entry);
  (globalThis.__stctOsrmAudit = globalThis.__stctOsrmAudit || []).push(rec);
  console.info("[STCT-OSRM-AUDIT]", JSON.stringify(rec));
}
function osrmUrl(coords, base) {
  return base + coords.map((c) => c[0].toFixed(6) + "," + c[1].toFixed(6)).join(";") +
    "?overview=full&geometries=geojson&steps=false&continue_straight=false";
}
function coordRange(coords) {
  const lons = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
  return { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats), points: coords.length };
}
async function fetchOsrmCoords(coords) {
  const config=window.STCT_CONFIG||{};
  const result=await window.STCTPlatformV19.localRoadClient.route(coords,{...config,coordinateUse:config.roadCoordinateUse||'UNCONFIRMED',geometry:true});
  osrmAudit({provider:'LOCAL',endpoint:result.evidence.endpoint,policy:'local-only',outcome:'ENGINE_ESTIMATE',roadPoints:result.geometry.length});
  return result.geometry;
}
async function fetchOsrmPreviewGeometry(coords) {
  // Failed paths are never filled with straight segments and labelled roads.
  return fetchOsrmCoords(coords);
}
function setRoadRouteStatus(text, type = "info") {
  const box = document.getElementById("roadRouteStatus");
  if (box) {
    box.textContent = text;
    box.style.color = type === "warn"
      ? "#b45309"
      : type === "ok"
      ? "#047857"
      : "#475569";
  }
}
async function updateRoadRoutePreview(routeId) {
  if (
    !window.map || !map || !map.loaded || !map.loaded() ||
    !map.getSource("road-routes")
  ) return;
  const token = ++roadRouteRequestToken;
  if (!routeId || routeId === "ALL") {
    emptyRoadRoute();
    setRoadRouteStatus("选择单条路线后，可预览按道路生成的车辆行驶线路。");
    return;
  }

  const cached = ROAD_ROUTE_CACHE.get(routeId);
  if (cached) {
    map.getSource("road-routes").setData({
      type: "FeatureCollection",
      features: [cached],
    });
    setStraightRouteVisibility(true);
    setRoadRouteStatus("已显示本地道路估算线路（缓存，货车限制未核验）。", "ok");
    return;
  }
  const base = routeLineFeature(routeId);
  if (
    !base || !base.geometry || !base.geometry.coordinates ||
    base.geometry.coordinates.length < 2
  ) {
    emptyRoadRoute();
    return;
  }
  let coords = base.geometry.coordinates.filter((c) =>
    Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
  );
  if (coords.length > 24) {
    const step = Math.ceil(coords.length / 22);
    coords = coords.filter((_, i) =>
      i === 0 || i === coords.length - 1 || i % step === 0
    );
  }
  setRoadRouteStatus("正在生成道路行驶线路...");
  try {
    const road = await fetchOsrmPreviewGeometry(coords);
    if (token !== roadRouteRequestToken) return;
    const feat = roadFeature(routeId, road);
    ROAD_ROUTE_CACHE.set(routeId, feat);
    map.getSource("road-routes").setData({
      type: "FeatureCollection",
      features: [feat],
    });
    setStraightRouteVisibility(true);
    setRoadRouteStatus(
      "已显示导航道路线路（" + road.length + " 个道路形状点）。",
      "ok",
    );
  } catch (err) {
    if (token === roadRouteRequestToken) {
      console.warn("Road route preview failed", err);
      emptyRoadRoute();
      setRoadRouteStatus(
        "道路线路生成失败，已保留直线地理筛选线路（非实际道路）。请检查本地路网服务；如需公共 OSRM 需先显式授权。",
        "warn",
      );
    }
  }
}
function updateMetrics() {
  const routes = selectedRoutes();
  const day = DATA.daySummaries.find((d) => d.date === state.date);
  const packages = routes.reduce((a, r) => a + r.packages, 0),
    stops = routes.reduce((a, r) => a + r.stops, 0),
    km = routes.reduce((a, r) => a + r.km, 0),
    maxEnd = routes.map((r) => r.end).sort().at(-1) || "-",
    avgVol = routes.length
      ? Math.round(
        routes.reduce((a, r) => a + parseFloat(r.volumeUtil), 0) /
          routes.length,
      )
      : 0;
  const cells = [
    ["配送批次", fmt(stops), day ? fmt(day.stopBatches) + " 计划" : ""],
    ["货物件数", fmt(packages), day ? fmt(day.packages) + " 计划" : ""],
    ["行驶距离", km.toFixed(1) + " km", day ? day.km + " km 计划" : ""],
    ["最晚回库", maxEnd, day ? "当日状态：" + day.status : ""],
    ["车辆利用率", avgVol + "%", "所选路线平均容积利用率"],
    ["已选路线", routes.length, "当前筛选路线数"],
  ];
  metrics.innerHTML = cells.map((c) =>
    '<div class="metric"><div class="label">' + escapeHTML(c[0]) +
    '</div><div class="value">' + escapeHTML(c[1]) + '</div><div class="sub">' + escapeHTML(c[2]) +
    "</div></div>"
  ).join("");
}
function boundsForRouteIds(ids) {
  const coords = DATA.routeGeoJson.features.filter((f) =>
    ids.has(f.properties.routeId)
  ).flatMap((f) => f.geometry.coordinates);
  if (!coords.length) return null;
  return coords.reduce(
    (bb, c) => bb.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
}
function routeFitPadding(focused = false) {
  const mapEl = document.getElementById("map");
  const detail = document.getElementById("detailPanel");
  const isMobile = window.matchMedia &&
    window.matchMedia("(max-width: 900px)").matches;
  if (!focused) return { top: 90, bottom: 60, left: 420, right: 340 };
  if (isMobile) {
    const cardVisible = detail &&
      detail.classList.contains("route-detail-card");
    const cardHeight = cardVisible
      ? Math.ceil(detail.getBoundingClientRect().height || 320)
      : 0;
    const h = mapEl?.clientHeight || window.innerHeight || 600;
    return {
      top: 92,
      bottom: cardHeight
        ? Math.min(Math.round(h * 0.72), cardHeight + 120)
        : Math.round(h * 0.46),
      left: 42,
      right: 42,
    };
  }
  const cardVisible = detail && detail.classList.contains("route-detail-card");
  const cardWidth = cardVisible
    ? Math.ceil(detail.getBoundingClientRect().width || 360)
    : 0;
  return {
    top: 86,
    bottom: 86,
    left: 64,
    right: cardWidth ? cardWidth + 56 : 84,
  };
}
function fitRouteBounds(ids, focused = false) {
  if (!window.map || !map || !map.loaded || !map.loaded()) return;
  const b = boundsForRouteIds(ids);
  if (!b) return;
  map.fitBounds(b, {
    padding: routeFitPadding(focused),
    maxZoom: focused ? 14.2 : 12,
    duration: focused ? 850 : 650,
    essential: true,
  });
}
function focusRoute(routeId) {
  if (!routeId || routeId === "ALL") return;
  const ids = new Set([routeId]);
  fitRouteBounds(ids, true);
  setTimeout(() => fitRouteBounds(ids, true), 120);
  setTimeout(() => fitRouteBounds(ids, true), 360);
  setTimeout(() => fitRouteBounds(ids, true), 620);
}
function syncRouteChecks() {
  routeList.querySelectorAll("input[data-route]").forEach((input) => {
    input.checked = state.route === "ALL"
      ? state.checkedRoutes.has(input.dataset.route)
      : input.dataset.route === state.route;
  });
  updateRouteCount();
}
function lockRoute(routeId) {
  if (!routeId || routeId === "ALL") return;
  state.route = routeId;
  routeFilter.value = routeId;
  state.checkedRoutes = new Set([routeId]);
  syncRouteChecks();
  showRouteDetail(routeId);
  refreshMap();
  focusRoute(routeId);
  setTimeout(() => {
    showRouteDetail(routeId);
    focusRoute(routeId);
  }, 100);
}
function unlockRoutes() {
  state.route = "ALL";
  routeFilter.value = "ALL";
  state.checkedRoutes = new Set(routesForDate().map((r) => r.routeId));
  syncRouteChecks();
  refreshMap();
}
function refreshMap() {
  if (!window.map || !map || !map.loaded || !map.loaded()) {
    updateRouteCount();
    updateMetrics();
    return;
  }
  if (map.getSource("routes")) {
    map.getSource("routes").setData(selectedRouteFeatures());
  }
  if (map.getSource("stops")) {
    map.getSource("stops").setData(selectedStopFeatures());
  }
  if (map.getSource("heat-stops")) {
    map.getSource("heat-stops").setData(selectedStopFeatures());
  }
  if (map.getSource("segment-labels")) {
    map.getSource("segment-labels").setData(selectedSegmentFeatures());
  }
  applyMapVisuals();
  updateRoadRoutePreview(state.route);
  const ids = routeIdsVisible();
  fitRouteBounds(ids, state.route !== "ALL");
  updateRouteCount();
  if (state.route && state.route !== "ALL") showRouteDetail(state.route);
  updateMetrics();
}
function stopFeatureByRouteSeq(routeId, seq) {
  return DATA.stopGeoJson.features.find((f) =>
    String(f.properties.routeId) === String(routeId) &&
    String(f.properties.seq) === String(seq)
  );
}
function focusStopFromDetail(routeId, seq) {
  const f = stopFeatureByRouteSeq(routeId, seq);
  if (!f || !f.geometry || !f.geometry.coordinates) return;
  const p = f.properties || {};
  document.querySelectorAll(".route-stop-item.active").forEach((el) =>
    el.classList.remove("active")
  );
  document.querySelector(
    '.route-stop-item[data-route-id="' + CSS.escape(String(routeId)) +
      '"][data-seq="' + CSS.escape(String(seq)) + '"]',
  )?.classList.add("active");
  if (window.map && map.loaded && map.loaded()) {
    map.flyTo({
      center: f.geometry.coordinates,
      zoom: Math.max(map.getZoom(), 15),
      duration: 650,
      essential: true,
    });
    new maplibregl.Popup({ closeButton: true, offset: 14 }).setLngLat(
      f.geometry.coordinates,
    ).setHTML(
      '<div class="popup-title">' + escapeHTML(p.name || p.code || "配送点") +
        '</div><div class="popup-line">路线 ' + escapeHTML(p.routeId) + " · 到达 " +
        escapeHTML(p.arrive || "-") + '</div><div class="popup-line">件数 ' +
        fmt(p.count || 0) + " · 容积 " + fmt(p.volume || 0) + "</div>",
    ).addTo(map);
  }
}
function routeDetailReason(r, missing, stops) {
  const util = utilNum(r.volumeUtil);
  const far = Number(r.km || 0) > 120;
  const late = String(r.end || "").includes("次日") ||
    optimizerTimeValue(r.end) > 23 * 60;
  const parts = [];
  if (far) {
    parts.push("远距离线路，通常受地理方向和回库时间限制，难以与市区线路合并");
  }
  if (util < 45) {
    parts.push(
      "装载率偏低，建议复核是否为远郊点、时间窗或剩余订单形成的独立线路",
    );
  } else if (util >= 90) {
    parts.push("容积利用率较高，建议预留临时订单和误差安全余量");
  }
  if (late) parts.push("回库时间接近或跨日，需重点关注作业时间与门店收货窗口");
  if (missing > 0) parts.push("存在缺坐标记录，地图展示和距离估算可能不完整");
  if (!parts.length) {
    parts.push("该路线容量、距离和时间相对均衡，可作为当前策略下的可执行线路");
  }
  return parts.join("；") + "。";
}
function showRouteDetail(routeId) {
  const r = DATA.routes.find((x) => x.routeId === routeId);
  if (!r) return;
  const missing = DATA.missingStops.filter((x) => x.routeId === routeId).length;
  const stops = DATA.stopGeoJson.features.filter((f) =>
    f.properties.routeId === routeId
  ).map((f) => f.properties).sort((a, b) =>
    Number(a.seq || 0) - Number(b.seq || 0)
  );
  const stopHtml = stops.length
    ? stops.slice(0, 80).map((s) =>
      '<div class="route-stop-item" role="button" tabindex="0" data-route-id="' +
      escapeHTML(routeId) + '" data-seq="' + escapeHTML(s.seq || "") +
      '"><span class="route-stop-seq">' + escapeHTML(s.seq || "-") +
      '</span><div><div class="route-stop-name">' +
      escapeHTML(s.name || s.code || "配送点") + '</div><div class="route-stop-meta">' +
      escapeHTML(s.code || "") + " · " + fmt(s.count || 0) + " 件 · " +
      fmt(s.volume || 0) + ' 容积</div></div><div class="route-stop-time">' +
      escapeHTML(s.arrive || "-") + "</div></div>"
    ).join("")
    : '<div class="empty">该路线暂无可绘制停靠点。</div>';
  detailPanel.className = "panel route-detail-card";
  detailPanel.innerHTML =
    '<div class="route-detail-header"><div><div class="route-detail-id">' +
    escapeHTML(r.routeId) + '</div><div class="route-detail-sub">' + escapeHTML(r.vehicleId) + " / " +
    escapeHTML(r.vehicleName) +
    '</div></div><button class="route-detail-close" id="routeDetailClose" title="关闭">×</button></div><div class="route-detail-grid"><div class="route-detail-metric"><span>回库</span><b>' +
    escapeHTML(r.end) + '</b></div><div class="route-detail-metric"><span>距离</span><b>' +
    escapeHTML(r.km) +
    ' km</b></div><div class="route-detail-metric"><span>停靠</span><b>' +
    fmt(r.stops) +
    '</b></div><div class="route-detail-metric"><span>件数</span><b>' +
    fmt(r.packages) +
    '</b></div><div class="route-detail-metric"><span>容积</span><b>' +
    escapeHTML(r.volumeUtil) +
    '</b></div><div class="route-detail-metric"><span>载重</span><b>' +
    escapeHTML(r.weightUtil) + '</b></div></div><div><span class="chip">' + escapeHTML(r.vehicleName) +
    '</span><span class="chip">缺坐标 ' + missing +
    '</span><span class="chip">状态 ' + escapeHTML(r.status || "OK") +
    '</span></div><div id="roadRouteStatus" class="mini-note" style="margin-top:10px">正在生成道路行驶线路...</div><div class="route-detail-section"><h3>路线判断</h3><div class="route-detail-insight">' +
    escapeHTML(routeDetailReason(r, missing, stops)) +
    '</div></div><div class="route-detail-section"><h3>停靠点明细</h3><div class="route-stop-list">' +
    stopHtml + "</div></div>";
  document.getElementById("routeDetailClose")?.addEventListener("click", () => {
    detailPanel.className = "panel";
    detailPanel.innerHTML =
      '<h2>路线详情</h2><div class="empty">请选择路线或配送点查看到达时间、货量与车辆信息。</div>';
  });
  detailPanel.querySelectorAll(".route-stop-item").forEach((item) => {
    item.addEventListener(
      "click",
      () => focusStopFromDetail(item.dataset.routeId, item.dataset.seq),
    );
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focusStopFromDetail(item.dataset.routeId, item.dataset.seq);
      }
    });
  });
  if (window.map && map.loaded && map.loaded()) {
    setTimeout(() => fitRouteBounds(new Set([routeId]), true), 60);
    setTimeout(() => fitRouteBounds(new Set([routeId]), true), 260);
  }
}
function showStopDetail(p) {
  detailPanel.className = "panel stop-detail-card";
  detailPanel.innerHTML = '<button class="route-detail-close" id="stopDetailClose" title="关闭">×</button><h2>' + escapeHTML(p.name || p.code || "配送点") + '</h2><div class="empty">' +
    escapeHTML(p.addr || "") +
    '</div><div class="detail-grid" style="margin-top:12px"><span>路线<b>' +
    escapeHTML(p.routeId) + "</b></span><span>顺序<b>" + escapeHTML(p.seq) +
    "</b></span><span>到达<b>" + escapeHTML(p.arrive) + "</b></span><span>离开<b>" +
    escapeHTML(p.depart) + "</b></span><span>件数<b>" + fmt(p.count) +
    "</b></span><span>容积<b>" + fmt(p.volume) +
    '</b></span></div><div style="margin-top:12px"><span class="chip">代码 ' +
    escapeHTML(p.code) + '</span><span class="chip">行驶 ' + escapeHTML(p.travelKm) +
    ' km</span><span class="chip">' + escapeHTML(p.coordStatus) + "</span></div>";
  document.getElementById("stopDetailClose")?.addEventListener("click", () => {
    detailPanel.className = "panel";
    detailPanel.innerHTML = '<h2>路线详情</h2><div class="empty">请选择路线或配送点查看到达时间、货量与车辆信息。</div>';
  });
}
function getFilteredRoutes(scope) {
  let routes = DATA.routes.slice();
  const date = scope === "carbon"
    ? dashState.carbonDate
    : scope === "analysis"
    ? dashState.analysisDate
    : state.date;
  if (date && date !== "ALL") routes = routes.filter((r) => r.date === date);
  if (scope === "carbon") {
    if (dashState.carbonVehicle !== "ALL") {
      routes = routes.filter((r) =>
        r.vehicleId === dashState.carbonVehicle ||
        r.vehicleName === dashState.carbonVehicle
      );
    }
    if (dashState.carbonUtil === "LOW") {
      routes = routes.filter((r) => utilNum(r.volumeUtil) < 40);
    }
    if (dashState.carbonUtil === "MID") {
      routes = routes.filter((r) =>
        utilNum(r.volumeUtil) >= 40 && utilNum(r.volumeUtil) < 90
      );
    }
    if (dashState.carbonUtil === "HIGH") {
      routes = routes.filter((r) => utilNum(r.volumeUtil) >= 90);
    }
    if (dashState.carbonDistance === "SHORT") {
      routes = routes.filter((r) => r.km < 40);
    }
    if (dashState.carbonDistance === "MID") {
      routes = routes.filter((r) => r.km >= 40 && r.km <= 80);
    }
    if (dashState.carbonDistance === "LONG") {
      routes = routes.filter((r) => r.km > 80);
    }
  }
  return routes;
}
function utilNum(v) {
  return parseFloat(String(v || "0").replace("%", "")) || 0;
}
function activeSummary(scope) {
  const routes = getFilteredRoutes(scope);
  const km = routes.reduce((a, r) => a + r.km, 0);
  const packages = routes.reduce((a, r) => a + r.packages, 0);
  const stops = routes.reduce((a, r) => a + r.stops, 0);
  const weight = routes.reduce((a, r) => a + r.weight, 0);
  const volume = routes.reduce((a, r) => a + r.volume, 0);
  const avgVol = routes.length
    ? routes.reduce((a, r) => a + utilNum(r.volumeUtil), 0) / routes.length
    : 0;
  const latest = routes.map((r) => r.end).sort().at(-1) || "-";
  return { routes, km, packages, stops, weight, volume, avgVol, latest };
}
function routeRank(metric, scope) {
  const routes = getFilteredRoutes(scope).slice();
  routes.sort((a, b) => {
    const va = metric === "volume"
      ? utilNum(a.volumeUtil)
      : Number(a[metric] || 0);
    const vb = metric === "volume"
      ? utilNum(b.volumeUtil)
      : Number(b[metric] || 0);
    return vb - va;
  });
  return routes.slice(0, 8);
}
function renderRank(rows, metric) {
  const max = Math.max(
    1,
    ...rows.map((r) =>
      metric === "volume" ? utilNum(r.volumeUtil) : Number(r[metric] || 0)
    ),
  );
  return '<div class="rank">' + rows.map((r) => {
    const val = metric === "volume"
      ? utilNum(r.volumeUtil)
      : Number(r[metric] || 0);
    const label = metric === "km"
      ? val.toFixed(1) + " km"
      : metric === "volume"
      ? val.toFixed(1) + "%"
      : fmt(val);
    return '<div class="rank-row"><b>' + r.routeId +
      '</b><div class="bar"><i style="width:' + Math.max(3, val / max * 100) +
      '%"></i></div><span>' + label + "</span></div>";
  }).join("") + "</div>";
}

function overviewRoutes() {
  let routes = DATA.routes.slice();
  if (dashState.overviewDate && dashState.overviewDate !== "ALL") {
    routes = routes.filter((r) => r.date === dashState.overviewDate);
  }
  return routes;
}
function renderOverview() {
  const el = document.getElementById("overviewContent");
  if (!el) return;
  const routes = overviewRoutes();
  const scope = dashState.overviewDate;
  const days = [...new Set(routes.map((r) => r.date))].length;
  const km = routes.reduce((a, r) => a + r.km, 0);
  const packages = routes.reduce((a, r) => a + r.packages, 0);
  const stops = routes.reduce((a, r) => a + r.stops, 0);
  const weight = routes.reduce((a, r) => a + r.weight, 0);
  const volume = routes.reduce((a, r) => a + r.volume, 0);
  const avgVol = routes.length
    ? routes.reduce((a, r) => a + utilNum(r.volumeUtil), 0) / routes.length
    : 0;
  const avgWeight = routes.length
    ? routes.reduce((a, r) => a + utilNum(r.weightUtil), 0) / routes.length
    : 0;
  const co2 = km * 0.192;
  const missing =
    DATA.missingStops.filter((x) => scope === "ALL" || x.date === scope).length;
  const split =
    DATA.splitRows.filter((x) => scope === "ALL" || x.date === scope).length;
  const vehicles = [...new Set(routes.map((r) => r.vehicleId))].length;
  const latest = routes.map((r) => r.end).sort().at(-1) || "-";
  const topDistance = routes.slice().sort((a, b) => b.km - a.km).slice(0, 6);
  const topUtil = routes.slice().sort((a, b) =>
    utilNum(b.volumeUtil) - utilNum(a.volumeUtil)
  ).slice(0, 6);
  el.innerHTML =
    '<div class="dash-grid"><div class="card span-3"><h3>配送日</h3><div class="big-num">' +
    days +
    '</div><div class="muted">统计范围</div></div><div class="card span-3"><h3>路线 / 车辆</h3><div class="big-num">' +
    routes.length + " / " + vehicles +
    '</div><div class="muted">路线数 / 使用车辆</div></div><div class="card span-3"><h3>配送批次</h3><div class="big-num">' +
    fmt(stops) +
    '</div><div class="muted">地图停靠批次</div></div><div class="card span-3"><h3>货物件数</h3><div class="big-num">' +
    fmt(packages) +
    '</div><div class="muted">计划核对件数</div></div><div class="card span-3"><h3>行驶距离</h3><div class="big-num">' +
    km.toFixed(1) +
    '</div><div class="muted">km，估算行驶距离</div></div><div class="card span-3"><h3>平均容积利用率</h3><div class="big-num">' +
    avgVol.toFixed(0) +
    '%</div><div class="muted">按路线平均</div></div><div class="card span-3"><h3>平均载重利用率</h3><div class="big-num">' +
    avgWeight.toFixed(0) +
    '%</div><div class="muted">按路线平均</div></div><div class="card span-3"><h3>估算碳排</h3><div class="big-num">' +
    co2.toFixed(1) +
    '</div><div class="muted">kg CO₂</div></div><div class="card span-8"><h3>全维度概览</h3><table class="table"><tbody><tr><td>总重量</td><td>' +
    fmt(weight) + "</td><td>总容量</td><td>" + fmt(volume) +
    "</td></tr><tr><td>最晚回库</td><td>" + escapeHTML(latest) +
    "</td><td>缺坐标记录</td><td>" + missing +
    "</td></tr><tr><td>拆分装载</td><td>" + split +
    "</td><td>每件平均距离</td><td>" +
    (packages ? (km / packages).toFixed(3) : "0") +
    " km/件</td></tr><tr><td>每批次平均货量</td><td>" +
    (stops ? (packages / stops).toFixed(1) : "0") +
    " 件/批次</td><td>每公里配送件数</td><td>" +
    (km ? (packages / km).toFixed(1) : "0") +
    ' 件/km</td></tr></tbody></table></div><div class="card span-4"><h3>数据健康度</h3><div class="mini-note">坐标完整率：<b>' +
    ((stops ? Math.max(0, (stops - missing) / stops * 100) : 100).toFixed(1)) +
    '%</b></div><div class="mini-note">拆分装载占比：<b>' +
    ((packages ? split / packages * 100 : 0).toFixed(2)) +
    '%</b></div><div class="mini-note">高容积路线（≥90%）：<b>' +
    routes.filter((r) => utilNum(r.volumeUtil) >= 90).length +
    '</b> 条</div><div class="mini-note">低容积路线（<40%）：<b>' +
    routes.filter((r) => utilNum(r.volumeUtil) < 40).length +
    '</b> 条</div></div><div class="card span-6"><h3>距离 Top 6</h3><table class="table"><thead><tr><th>路线</th><th>日期</th><th>车辆</th><th>距离</th><th>回库</th></tr></thead><tbody>' +
    topDistance.map((r) =>
      "<tr><td>" + escapeHTML(r.routeId) + "</td><td>" + escapeHTML(r.date) + "</td><td>" +
      escapeHTML(r.vehicleId) + "</td><td>" + escapeHTML(r.km) + " km</td><td>" + escapeHTML(r.end) + "</td></tr>"
    ).join("") +
    '</tbody></table></div><div class="card span-6"><h3>容积利用率 Top 6</h3><table class="table"><thead><tr><th>路线</th><th>日期</th><th>车辆</th><th>容积</th><th>件数</th></tr></thead><tbody>' +
    topUtil.map((r) =>
      "<tr><td>" + escapeHTML(r.routeId) + "</td><td>" + escapeHTML(r.date) + "</td><td>" +
      escapeHTML(r.vehicleId) + "</td><td>" + escapeHTML(r.volumeUtil) + "</td><td>" + fmt(r.packages) +
      "</td></tr>"
    ).join("") + "</tbody></table></div></div>";
}
function renderAnalysis() {
  const el = document.getElementById("analysisContent");
  if (!el) return;
  const s = activeSummary("analysis");
  const metric = document.getElementById("analysisMetric")?.value || "km";
  const longest = routeRank("km", "analysis")[0];
  const dense = routeRank("stops", "analysis")[0];
  const heavy = routeRank("volume", "analysis")[0];
  const routes = s.routes;
  const low = routes.filter((r) => utilNum(r.volumeUtil) < 40);
  const high = routes.filter((r) => utilNum(r.volumeUtil) >= 90);
  const longRoutes = routes.filter((r) => r.km > 80);
  const missing =
    DATA.missingStops.filter((x) =>
      dashState.analysisDate === "ALL" || x.date === dashState.analysisDate
    ).length;
  let insights = [];
  if (low.length) {
    insights.push(
      "有 " + low.length +
        " 条路线容积利用率低于 40%，建议检查是否可与同区域、同时间窗路线合并。",
    );
  }
  if (high.length) {
    insights.push(
      "有 " + high.length +
        " 条路线容积利用率达到 90% 以上，建议关注临时加单导致的超载风险。",
    );
  }
  if (longRoutes.length) {
    insights.push(
      "有 " + longRoutes.length +
        " 条路线超过 80km，建议复核配送顺序、区域切分及作业时间。",
    );
  }
  if (missing) {
    insights.push(
      "存在 " + missing +
        " 条缺坐标记录，建议优先治理客户地址主数据，否则路线优化和 ETA 会受影响。",
    );
  }
  if (!insights.length) {
    insights.push("当前筛选范围内未发现明显装载或距离异常，路线结构相对稳定。");
  }
  el.innerHTML =
    '<div class="dash-grid"><div class="card span-3"><h3>已选路线</h3><div class="big-num">' +
    s.routes.length +
    '</div><div class="muted">当前分析范围</div></div><div class="card span-3"><h3>平均每路线批次</h3><div class="big-num">' +
    (s.routes.length ? (s.stops / s.routes.length).toFixed(1) : 0) +
    '</div><div class="muted">停靠批次 / 路线</div></div><div class="card span-3"><h3>平均每路线距离</h3><div class="big-num">' +
    (s.routes.length ? (s.km / s.routes.length).toFixed(1) : 0) +
    '</div><div class="muted">km / 路线</div></div><div class="card span-3"><h3>平均容积利用率</h3><div class="big-num">' +
    s.avgVol.toFixed(0) +
    '%</div><div class="muted">装载效率</div></div><div class="card span-7"><h3>路线排行</h3>' +
    renderRank(routeRank(metric, "analysis"), metric) +
    '</div><div class="card span-5"><h3>智能洞察与建议</h3>' +
    insights.map((x) => '<div class="insight">' + escapeHTML(x) + "</div>").join("") +
    '</div><div class="card span-4"><h3>重点路线</h3><div class="mini-note">最长路线：<b>' +
    escapeHTML(longest?.routeId || "-") + "</b> " + escapeHTML(longest ? longest.km + " km" : "") +
    '</div><div class="mini-note">停靠最多：<b>' + escapeHTML(dense?.routeId || "-") +
    "</b> " + escapeHTML(dense ? dense.stops + " 批次" : "") +
    '</div><div class="mini-note">容积最高：<b>' + escapeHTML(heavy?.routeId || "-") +
    "</b> " + escapeHTML(heavy ? heavy.volumeUtil : "") +
    '</div><div class="mini-note">最晚回库：<b>' + escapeHTML(s.latest) +
    '</b></div></div><div class="card span-8"><h3>车辆利用率分布</h3>' +
    renderUtilBuckets(s.routes) +
    '</div><div class="card span-12"><h3>改善方向</h3><table class="table"><thead><tr><th>问题类型</th><th>判断依据</th><th>建议动作</th></tr></thead><tbody><tr><td>低装载</td><td>容积利用率低于 40%</td><td>合并相邻区域或调整发车频次</td></tr><tr><td>长距离</td><td>单路线超过 80km</td><td>复核区域边界、顺序及中途补货可能性</td></tr><tr><td>高装载</td><td>容积利用率高于 90%</td><td>预留安全容量，避免临时订单超载</td></tr><tr><td>主数据风险</td><td>缺坐标或地址不完整</td><td>回流客户地址与订单主数据治理</td></tr></tbody></table></div></div>';
}
function renderUtilBuckets(routes) {
  const buckets = [["0-40%", 0], ["40-70%", 0], ["70-90%", 0], ["90%+", 0]];
  routes.forEach((r) => {
    const v = utilNum(r.volumeUtil);
    if (v < 40) buckets[0][1]++;
    else if (v < 70) buckets[1][1]++;
    else if (v < 90) buckets[2][1]++;
    else buckets[3][1]++;
  });
  const max = Math.max(1, ...buckets.map((b) => b[1]));
  return '<div class="rank">' +
    buckets.map((b) =>
      '<div class="rank-row"><b>' + b[0] +
      '</b><div class="bar"><i style="width:' + Math.max(4, b[1] / max * 100) +
      '%;background:#0f766e"></i></div><span>' + b[1] + " 条</span></div>"
    ).join("") + "</div>";
}
function renderCarbon() {
  const el = document.getElementById("carbonContent");
  if (!el) return;
  const s = activeSummary("carbon");
  const factor = Number(
    document.getElementById("emissionFactor")?.value || 0.192,
  );
  const co2 = s.km * factor;
  const perPkg = s.packages ? co2 / s.packages : 0;
  const perStop = s.stops ? co2 / s.stops : 0;
  const trees = co2 / 21.77;
  const rows = getFilteredRoutes("carbon").slice().sort((a, b) => b.km - a.km)
    .slice(0, 10);
  el.innerHTML =
    '<div class="dash-grid"><div class="card co2-card span-3"><h3>估算 CO₂</h3><div class="big-num">' +
    co2.toFixed(1) + ' kg</div><div class="muted">排放因子 ' + factor +
    ' kg/km</div></div><div class="card span-3"><h3>每件货物</h3><div class="big-num">' +
    (perPkg * 1000).toFixed(1) +
    ' g</div><div class="muted">CO₂ / 件</div></div><div class="card span-3"><h3>每停靠批次</h3><div class="big-num">' +
    perStop.toFixed(2) +
    ' kg</div><div class="muted">CO₂ / 批次</div></div><div class="card span-3"><h3>树木年吸收约当</h3><div class="big-num">' +
    trees.toFixed(1) +
    ' 棵</div><div class="muted">按 21.77 kg/棵/年估算</div></div><div class="card span-7"><h3>高排放路线 Top 10</h3><table class="table"><thead><tr><th>路线</th><th>车辆</th><th>距离</th><th>CO₂</th><th>容积</th></tr></thead><tbody>' +
    rows.map((r) =>
      "<tr><td>" + escapeHTML(r.routeId) + "</td><td>" + escapeHTML(r.vehicleId) + "</td><td>" + escapeHTML(r.km) +
      " km</td><td>" + (r.km * factor).toFixed(1) + " kg</td><td>" +
      escapeHTML(r.volumeUtil) + "</td></tr>"
    ).join("") +
    '</tbody></table></div><div class="card span-5"><h3>减排建议</h3><div class="mini-note"><span class="pill-good">优先</span> 合并低容积利用率且同方向路线，减少空驶。</div><div class="mini-note"><span class="pill-good">优先</span> 对超过 80km 的路线复核地理顺序和缺坐标点。</div><div class="mini-note"><span class="pill-warn">注意</span> 当前 CO₂ 基于估算行驶距离，不是路网导航距离。</div></div></div>';
}
function renderExceptions() {
  const el = document.getElementById("exceptionsContent");
  if (!el) return;
  const date = state.date;
  const missing = (DATA.missingStops || []).filter((x) =>
    x.date === date && (state.route === "ALL" || x.routeId === state.route) &&
    (state.vehicle === "ALL" || x.vehicleId === state.vehicle)
  );
  const split = (DATA.splitRows || []).filter((x) => x.date === date);
  const allIssues = [...missing, ...split];
  const issueText = (x) =>
    String(
      [x.type, x.reason, x.message, x.category, x.code, x.name, x.dest].filter(
        Boolean,
      ).join(" "),
    );
  const countBy = (fn) => allIssues.filter(fn).length;
  const categories = [["缺坐标", missing.length, "缺少经纬度，地图无法绘制"], [
    "超容量",
    countBy((x) => /超容量|超过|容量|载重|容积/.test(issueText(x))),
    "单票或合单超过车辆能力",
  ], [
    "时间窗冲突",
    countBy((x) => /时间窗|超时|回库|迟到|time/i.test(issueText(x))),
    "无法在约束时间内完成",
  ], [
    "车辆缺失",
    countBy((x) => /车辆缺失|无车辆|vehicle/i.test(issueText(x))),
    "订单缺少可用车辆资源",
  ], [
    "仓库缺失",
    countBy((x) => /仓库缺失|仓库|depot/i.test(issueText(x))),
    "缺少始发仓或仓库坐标",
  ], [
    "未分配订单",
    countBy((x) => /未分配|unassigned/i.test(issueText(x))),
    "排车后仍未进入线路",
  ]];
  const categoryHtml = categories.map((c) =>
    '<div class="exception-category"><b>' + escapeHTML(c[0]) + "</b><strong>" +
    fmt(c[1]) + "</strong><span>" + escapeHTML(c[2]) + "</span></div>"
  ).join("");
  el.innerHTML =
    '<div class="dash-grid"><div class="card span-12"><h3>异常分类</h3><div class="exception-category-grid">' +
    categoryHtml +
    '</div></div><div class="card span-4"><h3>缺坐标停靠</h3><div class="big-num">' +
    missing.length +
    '</div><div class="muted">无法在地图绘制，但已计入装载</div></div><div class="card span-4"><h3>拆分装载</h3><div class="big-num">' +
    split.length +
    '</div><div class="muted">单件超过容量后拆分批次</div></div><div class="card span-4"><h3>当前日期</h3><div class="big-num">' +
    escapeHTML(date) +
    '</div><div class="muted">筛选条件联动</div></div><div class="card span-6"><h3>缺坐标明细</h3><table class="table"><thead><tr><th>路线</th><th>代码</th><th>名称</th><th>到达</th></tr></thead><tbody>' +
    missing.slice(0, 20).map((x) =>
      "<tr><td>" + escapeHTML(x.routeId) + "</td><td>" + escapeHTML(x.code) +
      "</td><td>" + escapeHTML(x.name) + "</td><td>" + escapeHTML(x.arrive) +
      "</td></tr>"
    ).join("") +
    '</tbody></table></div><div class="card span-6"><h3>拆分装载明细</h3><table class="table"><thead><tr><th>配送点</th><th>货物</th><th>说明</th></tr></thead><tbody>' +
    split.slice(0, 20).map((x) =>
      "<tr><td>" + escapeHTML(x.dest) + "</td><td>" + escapeHTML(x.cargoCode) +
      "</td><td>" + escapeHTML(x.message) + "</td></tr>"
    ).join("") + "</tbody></table></div></div>";
}

function buildCoordinateLookup() {
  const lookup = new Map();
  DATA.stopGeoJson.features.forEach((f) => {
    const p = f.properties || {};
    if (p.code) {
      lookup.set(String(p.code), {
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        name: p.name || "",
        addr: p.addr || "",
      });
    }
  });
  return lookup;
}
function sheetRowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).filter((r) =>
    r && r.some((v) => v !== undefined && v !== null && v !== "")
  ).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
function routeColorByIndex(i) {
  const colors = [
    "#003b79",
    "#e60012",
    "#00a3e0",
    "#4c6fff",
    "#16a34a",
    "#f97316",
    "#7c3aed",
    "#64748b",
    "#0f766e",
    "#b54708",
    "#1d4ed8",
    "#be123c",
    "#0891b2",
    "#65a30d",
    "#9333ea",
    "#dc2626",
    "#0284c7",
    "#ca8a04",
    "#4338ca",
    "#047857",
    "#0d9488",
    "#3b82f6",
    "#a855f7",
  ];
  return colors[i % colors.length];
}
function excelSerialToDate(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" && window.XLSX && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      return String(d.y).padStart(4, "0") + "-" + String(d.m).padStart(2, "0") +
        "-" + String(d.d).padStart(2, "0");
    }
  }
  return String(v || "");
}
function excelToFlowData(workbook) {
  const routeSheet = workbook.Sheets["Route Plan"] ||
    workbook.Sheets["路线明细"] || workbook.Sheets["配送路线"];
  const vehicleSheet = workbook.Sheets["Vehicle Summary"] ||
    workbook.Sheets["车辆汇总"];
  const summarySheet = workbook.Sheets["Summary"] || workbook.Sheets["汇总"];
  const exceptionSheet = workbook.Sheets["Exceptions"] ||
    workbook.Sheets["异常"];
  if (!routeSheet || !vehicleSheet) {
    throw new Error("Excel 需要包含 Route Plan 和 Vehicle Summary 工作表");
  }
  const routeRows = sheetRowsToObjects(
    XLSX.utils.sheet_to_json(routeSheet, { header: 1, defval: "" }),
  );
  const vehicleRows = sheetRowsToObjects(
    XLSX.utils.sheet_to_json(vehicleSheet, { header: 1, defval: "" }),
  );
  const summaryRows = XLSX.utils.sheet_to_json(summarySheet || {}, {
    header: 1,
    defval: "",
  });
  const exceptionRows = exceptionSheet
    ? sheetRowsToObjects(
      XLSX.utils.sheet_to_json(exceptionSheet, { header: 1, defval: "" }),
    )
    : [];
  const coord = buildCoordinateLookup();
  const depot = DATA.depot;
  const routes = vehicleRows.map((r, i) => ({
    date: excelSerialToDate(r["配送日"]),
    routeId: String(r["路线ID"] || ""),
    vehicleId: String(r["车辆ID"] || ""),
    vehicleName: String(r["车辆名称"] || ""),
    stops: Number(r["停靠批次数"] || 0),
    packages: Number(r["核对件数"] || r["件数"] || 0),
    weight: Number(r["重量"] || 0),
    maxWeight: Number(r["载重上限"] || 0),
    volume: Number(r["容量"] || 0),
    maxVolume: Number(r["容积上限"] || 0),
    km: Number(r["行驶km"] || 0),
    start: String(r["出库"] || ""),
    end: String(r["回库"] || ""),
    status: String(r["时间状态"] || ""),
    weightUtil: String(r["载重利用率"] || ""),
    volumeUtil: String(r["容积利用率"] || ""),
    color: routeColorByIndex(i),
  })).filter((r) => r.routeId);
  const routeMap = new Map(routes.map((r) => [r.routeId, r]));
  const groups = new Map();
  const missingStops = [];
  const stopFeatures = [];
  routeRows.forEach((r) => {
    const routeId = String(r["路线ID"] || "");
    if (!routeId) return;
    const code = String(r["配送点代码"] || "");
    let loc = coord.get(code);
    const latFromExcel = Number(
      r["配送点纬度"] || r["緯度"] || r["纬度"] || "",
    );
    const lonFromExcel = Number(
      r["配送点经度"] || r["経度"] || r["经度"] || "",
    );
    if (
      Number.isFinite(latFromExcel) && Number.isFinite(lonFromExcel) &&
      latFromExcel !== 0 && lonFromExcel !== 0
    ) {
      loc = {
        lat: latFromExcel,
        lon: lonFromExcel,
        name: String(r["配送点名称"] || ""),
        addr: String(r["地址"] || ""),
      };
    }
    const rec = {
      date: excelSerialToDate(r["配送日"]),
      routeId,
      vehicleId: String(r["车辆ID"] || ""),
      vehicleName: String(r["车辆名称"] || ""),
      seq: Number(r["顺序"] || 0),
      code,
      name: String(r["配送点名称"] || ""),
      addr: String(r["地址"] || ""),
      batch: Number(r["批次"] || 0),
      count: Number(r["核对件数"] || r["件数"] || 0),
      weight: Number(r["重量"] || 0),
      volume: Number(r["容量"] || 0),
      serviceMin: Number(r["停留分钟"] || 0),
      arrive: String(r["到达"] || ""),
      depart: String(r["离开"] || ""),
      travelKm: Number(r["上段行驶km"] || 0),
      travelMin: Number(r["上段行驶分钟"] || 0),
      coordStatus: loc ? "OK" : "坐标未设",
      cargoCodes: String(r["代表货物代码"] || ""),
    };
    if (loc) {
      rec.lat = loc.lat;
      rec.lon = loc.lon;
      stopFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [loc.lon, loc.lat] },
        properties: {
          ...rec,
          color: routeMap.get(routeId)?.color || "#2563eb",
        },
      });
    } else {missingStops.push({
        date: rec.date,
        routeId: rec.routeId,
        vehicleId: rec.vehicleId,
        seq: rec.seq,
        code: rec.code,
        name: rec.name,
        count: rec.count,
        weight: rec.weight,
        volume: rec.volume,
        arrive: rec.arrive,
        depart: rec.depart,
      });}
    if (!groups.has(routeId)) groups.set(routeId, []);
    groups.get(routeId).push(rec);
  });
  const routeFeatures = [];
  groups.forEach((stops, routeId) => {
    const meta = routeMap.get(routeId);
    const line = [[depot.lon, depot.lat]];
    stops.sort((a, b) => a.seq - b.seq).forEach((s) => {
      if (Number.isFinite(s.lon) && Number.isFinite(s.lat)) {
        line.push([s.lon, s.lat]);
      }
    });
    line.push([depot.lon, depot.lat]);
    if (line.length > 2) {
      routeFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: line },
        properties: { ...meta, routeId, color: meta?.color || "#2563eb" },
      });
    }
  });
  let daySummaries = [];
  const dailyHeaderIndex = summaryRows.findIndex((r) =>
    String(r[0] || "").includes("每日汇总")
  );
  if (dailyHeaderIndex >= 0) {
    const headers = summaryRows[dailyHeaderIndex];
    daySummaries = summaryRows.slice(dailyHeaderIndex + 1).filter((r) =>
      r && r[0]
    ).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]))).map(
      (r) => ({
        date: excelSerialToDate(r["每日汇总"] || r["配送日"]),
        vehicles: Number(r["使用车辆"] || 0),
        destinations: Number(r["配送点数"] || 0),
        stopBatches: Number(r["停靠批次数"] || 0),
        packages: Number(r["货物件数"] || 0),
        weight: Number(r["重量"] || 0),
        volume: Number(r["容量"] || 0),
        km: Number(r["行驶km"] || 0),
        latestEnd: String(r["最晚回库"] || ""),
        status: String(r["状态"] || ""),
      }),
    );
  }
  if (!daySummaries.length) {
    const byDate = new Map();
    routes.forEach((r) => {
      const d = byDate.get(r.date) ||
        {
          date: r.date,
          vehicles: 0,
          destinations: 0,
          stopBatches: 0,
          packages: 0,
          weight: 0,
          volume: 0,
          km: 0,
          latestEnd: "",
          status: "OK",
        };
      d.vehicles++;
      d.stopBatches += r.stops;
      d.packages += r.packages;
      d.weight += r.weight;
      d.volume += r.volume;
      d.km += r.km;
      d.latestEnd = [d.latestEnd, r.end].sort().at(-1) || r.end;
      byDate.set(r.date, d);
    });
    daySummaries = [...byDate.values()];
  }
  const splitRows = exceptionRows.filter((r) =>
    String(r["类型"] || "") === "拆分装载"
  ).map((r) => ({
    date: excelSerialToDate(r["配送日"]),
    dest: String(r["配送点代码"] || ""),
    cargoCode: String(r["货物代码"] || ""),
    message: String(r["说明"] || ""),
  }));
  return {
    depot,
    routes,
    daySummaries,
    routeGeoJson: { type: "FeatureCollection", features: routeFeatures },
    stopGeoJson: { type: "FeatureCollection", features: stopFeatures },
    missingStops,
    splitRows,
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}
function excelToNumber(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function normalizeLonLat(lon, lat) {
  if (
    Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 60 &&
    Math.abs(lat) > 60
  ) return { lon: lat, lat: lon };
  return { lon, lat };
}
function hasRawWorkbook(workbook) {
  return !!(workbook.Sheets["Orders"] || workbook.Sheets["订单信息"] ||
    workbook.Sheets["订单"]) &&
    !!(workbook.Sheets["Vehicles"] || workbook.Sheets["车辆信息"] ||
      workbook.Sheets["车辆"]);
}
function excelToRawData(workbook) {
  const orderSheet = workbook.Sheets["Orders"] || workbook.Sheets["订单信息"] ||
    workbook.Sheets["订单"];
  const vehicleSheet = workbook.Sheets["Vehicles"] ||
    workbook.Sheets["车辆信息"] || workbook.Sheets["车辆"];
  const depotSheet = workbook.Sheets["Depots"] || workbook.Sheets["仓库信息"] ||
    workbook.Sheets["仓库"];
  const constraintSheet = workbook.Sheets["Constraints"] ||
    workbook.Sheets["限制条件"] || workbook.Sheets["约束条件"];
  if (!orderSheet || !vehicleSheet) {
    throw new Error("Raw Data Excel 需要包含 Orders 和 Vehicles 工作表");
  }
  const importAssumptions = [];
  // Missingness and the source cell must survive preview; never normalize bad input into a fact.
  const rawNumber = value => value == null || (typeof value === 'string' && value.trim() === '') ? null : typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : value;
  const rawRows = sheet => {
    const name = workbook.SheetNames.find(name => workbook.Sheets[name] === sheet);
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }) : [];
    const headers = (rows[0] || []).map(value => String(value ?? '').trim());
    return rows.slice(1).map((values, i) => ({ ...Object.fromEntries(headers.map((key, j) => [key, values[j] ?? ''])), _source: { sheet: name || '', rowNumber: i + 2, values } })).filter(row => row._source.values.some(value => value !== '' && value != null));
  };
  const assumed = (value, fallback, row, field) => {
    if (value !== '' && value != null) return value;
    importAssumptions.push({ ...row._source, field, value: fallback, reason: 'MISSING_INPUT_DEFAULT' });
    return fallback;
  };
  const orders = rawRows(orderSheet).map((r, i) => {
    const rawLat = rawNumber(
      firstValue(r, ["纬度", "配送点纬度", "lat", "Latitude"]),
    );
    const rawLon = rawNumber(
      firstValue(r, ["经度", "配送点经度", "lon", "lng", "Longitude"]),
    );
    const fixedCoord = normalizeLonLat(rawLon, rawLat);
    const lat = fixedCoord.lat, lon = fixedCoord.lon;
    return {
      source: r._source,
      id: String(
        firstValue(r, ["订单号", "订单ID", "Order ID", "orderId"]) ||
          ("RAW-" + String(i + 1).padStart(4, "0")),
      ),
      date: excelSerialToDate(
        firstValue(r, ["配送日", "订单日期", "Date", "date"]),
      ),
      code: String(
        firstValue(r, ["客户代码", "配送点代码", "Customer Code", "code"]) ||
          ("C" + String(i + 1).padStart(4, "0")),
      ),
      name: String(
        firstValue(r, ["配送点名称", "客户名称", "Customer Name", "name"]) ||
          ("配送点 " + (i + 1)),
      ),
      addr: String(
        firstValue(r, ["地址", "配送地址", "Address", "addr"]) || "",
      ),
      lat,
      lon,
      count: rawNumber(assumed(firstValue(r, ["件数", "核对件数", "Packages", "count"]), 1, r, 'count')),
      weight: rawNumber(firstValue(r, ["重量", "Weight", "weight"])),
      volume: rawNumber(firstValue(r, ["体积", "容积", "Volume", "volume"])),
      serviceMin: rawNumber(assumed(firstValue(r, ["服务时间", "停留分钟", "Service Min", "serviceMin"]), 1, r, 'serviceMin')),
      twStart: String(assumed(
        firstValue(r, [
          "时间窗开始",
          "可配送开始",
          "TW Start",
          "timeWindowStart",
        ]), "09:00", r, 'twStart')),
      twEnd: String(assumed(
        firstValue(r, [
          "时间窗结束",
          "可配送结束",
          "TW End",
          "timeWindowEnd",
        ]), "17:30", r, 'twEnd')),
      priority: String(
        firstValue(r, ["优先级", "Priority", "priority"]) || "normal",
      ),
    };
  });
  const vehicles = rawRows(vehicleSheet).map((r, i) => ({
    source: r._source,
    vehicleId: String(
      firstValue(r, ["车辆ID", "Vehicle ID", "vehicleId"]) ||
        ("V" + String(i + 1).padStart(2, "0")),
    ),
    vehicleName: String(
      firstValue(r, ["车辆名称", "车型", "Vehicle Name", "vehicleName"]) ||
        "配送车辆",
    ),
    type: String(firstValue(r, ["车型", "Type", "type"]) || ""),
    maxWeight: rawNumber(firstValue(r, ["最大载重", "载重上限", "Max Weight", "maxWeight"])),
    maxVolume: rawNumber(firstValue(r, ["最大容积", "容积上限", "Max Volume", "maxVolume"])),
    start: String(assumed(firstValue(r, ["可用开始", "Available Start", "start"]), "09:00", r, 'start')),
    end: String(assumed(firstValue(r, ["可用结束", "Available End", "end"]), "17:30", r, 'end')),
    availableDate: excelSerialToDate(
      firstValue(r, ["可用日期", "配送日", "Date", "date"]) || "",
    ),
  })).filter((v) => v.vehicleId);
  const depotRows = rawRows(depotSheet);
  const d = depotRows[0] || {};
  const depot = {
    source: d._source || { sheet: 'Depots', rowNumber: 2, values: [] },
    code: String(firstValue(d, ["仓库ID", "Depot ID", "code"])) ,
    name: String(firstValue(d, ["仓库名称", "Depot Name", "name"])),
    addr: String(firstValue(d, ["地址", "Address", "addr"])),
    lat: rawNumber(firstValue(d, ["纬度", "lat", "Latitude"])),
    lon: rawNumber(firstValue(d, ["经度", "lon", "lng", "Longitude"])),
    kind: "from",
  };
  const constraintRows = constraintSheet
    ? sheetRowsToObjects(
      XLSX.utils.sheet_to_json(constraintSheet, { header: 1, defval: "" }),
    )
    : [];
  const constraints = { lunchStart: "12:00", lunchEnd: "13:00", averageSpeedKmh: 28, allowSplit: false };
  const supplied = new Set();
  constraintRows.forEach((r) => {
    const key = String(firstValue(r, ["项目", "Key", "key"]) || "");
    const val = firstValue(r, ["值", "Value", "value"]);
    if (val == null || String(val).trim() === "") return;
    if (key.includes("午休开始") || key === "lunchStart") {
      constraints.lunchStart = String(val); supplied.add('lunchStart');
    }
    if (key.includes("午休结束") || key === "lunchEnd") {
      constraints.lunchEnd = String(val); supplied.add('lunchEnd');
    }
    if (key.includes("平均速度") || key === "averageSpeedKmh") {
      constraints.averageSpeedKmh = rawNumber(val); supplied.add('averageSpeedKmh');
    }
    if (key.includes("允许拆单") || key === "allowSplit") {
      constraints.allowSplit = String(val).toLowerCase() === "true" ||
        String(val) === "是";
    }
  });
  for (const field of ['lunchStart', 'lunchEnd', 'averageSpeedKmh']) if (!supplied.has(field)) importAssumptions.push({ sheet: 'Constraints', rowNumber: null, field, value: constraints[field], reason: 'MISSING_INPUT_DEFAULT' });
  if (!orders.length) {
    throw new Error(
      "Raw Data 中没有可用订单，请确认 Orders 表包含配送日、经纬度、件数、重量、体积",
    );
  }
  if (!vehicles.length) {
    throw new Error(
      "Raw Data 中没有可用车辆，请确认 Vehicles 表包含车辆ID、最大载重、最大容积",
    );
  }
  return {
    kind: "raw",
    orders,
    vehicles,
    depot,
    constraints,
    importAssumptions,
    importAssumptionsConfirmed: false,
    uploadedAt: new Date().toLocaleString(),
  };
}
function rawDates() {
  return RAW_DATA
    ? [...new Set(RAW_DATA.orders.map((o) => o.date))].sort()
    : [];
}
function loadRawData(raw) {
  raw = (window.STCTValidator && window.STCTValidator.sanitizeUploadData)
    ? window.STCTValidator.sanitizeUploadData(raw)
    : raw;
  RAW_DATA = raw;
  window.RAW_DATA = RAW_DATA;
  optimizerPlan = null;
  dataStatus = "待排车";
  dataSource = "上传 Raw Data";
  const dates = rawDates();
  if (dates.length) state.date = dates[0];
  syncDashboardControls();
  renderOptimizer();
  return {
    orders: raw.orders.length,
    vehicles: raw.vehicles.length,
    days: dates.length,
  };
}
function optimizerSelectedDate() {
  return document.getElementById("optimizerDate")?.value || state.date;
}
async function parseExcelFile(file) {
  if (!window.XLSX) {
    throw new Error("Excel 解析库尚未加载，请检查 vendor/xlsx/xlsx.full.min.js 本地资源");
  }
  window.STCTImportBudget.checkFileSize(file);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) window.STCTImportBudget.zipPreflight(buf);
  const wb = XLSX.read(buf, { type: "array", cellDates: false, cellHTML: false, bookVBA: false, sheetRows: window.STCTImportBudget.LIMITS.rows + 1 });
  window.STCTImportBudget.checkWorkbook(wb, XLSX);
  if (hasRawWorkbook(wb)) return { __rawUpload: true, raw: excelToRawData(wb) };
  return excelToFlowData(wb);
}
function validateFlowData(data) {
  const required = [
    "depot",
    "routes",
    "daySummaries",
    "routeGeoJson",
    "stopGeoJson",
    "missingStops",
    "splitRows",
  ];
  const missing = required.filter((k) => !(k in data));
  if (missing.length) throw new Error("缺少字段：" + missing.join(", "));
  if (!Array.isArray(data.routes)) throw new Error("routes 必须是数组");
  if (!data.routeGeoJson.features || !data.stopGeoJson.features) {
    throw new Error("GeoJSON features 不完整");
  }
  return true;
}
function parseUploadedText(text) {
  window.STCTImportBudget.checkJsonBudget(text);
  let t = text.trim();
  if (t.startsWith("window.FLOWMAP_DATA")) {
    t = t.replace(/^window\.FLOWMAP_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  }
  const parsed = window.STCTImportBudget.checkValue(JSON.parse(t));
  for (const rows of [parsed.routes, parsed.daySummaries, parsed.orders, parsed.raw?.orders, parsed.raw?.vehicles]) if (Array.isArray(rows) && rows.length > window.STCTImportBudget.LIMITS.rows) throw new Error("IMPORT_ROW_LIMIT");
  return parsed;
}
function applyUploadedData(data) {
  data = (window.STCTValidator && window.STCTValidator.sanitizeUploadData)
    ? window.STCTValidator.sanitizeUploadData(data)
    : data;
  validateFlowData(data);
  DATA = data;
  transportDataApplied = true;
  window.DATA = DATA;
  dataStatus = "已应用";
  dataSource = (data && data.meta && data.meta.source) || dataSource;
  const dates = [...new Set(DATA.routes.map((r) => r.date))].sort();
  byDate.splice(0, byDate.length, ...dates);
  state.date = byDate[0];
  state.route = "ALL";
  state.vehicle = "ALL";
  state.checkedRoutes = new Set();
  dashState.analysisDate = "ALL";
  dashState.carbonDate = "ALL";
  dashState.overviewDate = "ALL";
  dashState.carbonVehicle = "ALL";
  dashState.carbonUtil = "ALL";
  dashState.carbonDistance = "ALL";
  fillSelect(dateFilter, byDate.map((d) => ({ label: d, value: d })));
  dateFilter.value = state.date;
  updateControls();
  if (map && map.loaded && map.loaded()) {
    if (map.getSource("routes")) {
      map.getSource("routes").setData(selectedRouteFeatures());
    }
    if (map.getSource("stops")) {
      map.getSource("stops").setData(selectedStopFeatures());
    }
    if (map.getSource("heat-stops")) {
      map.getSource("heat-stops").setData(selectedStopFeatures());
    }
    if (map.getSource("depot")) {
      map.getSource("depot").setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [DATA.depot.lon, DATA.depot.lat],
          },
          properties: DATA.depot,
        }],
      });
    }
    if (depotMarker) depotMarker.setLngLat([DATA.depot.lon, DATA.depot.lat]);
    refreshMap();
  }
  syncDashboardControls();
  renderAllDashboards();
  updateMetrics();
  try {
    window.dispatchEvent(
      new CustomEvent("stct:data-applied", {
        detail: {
          routes: DATA.routes.length,
          stops: DATA.stopGeoJson.features.length,
          days: byDate.length,
        },
      }),
    );
  } catch (err) {}
  return {
    routes: DATA.routes.length,
    stops: DATA.stopGeoJson.features.length,
    days: byDate.length,
  };
}
function uploadKindLabel(data) {
  return data && data.__rawUpload ? "Raw Data" : "排程结果";
}
function validateUploadData(data) {
  if (window.STCTValidator && window.STCTValidator.validateUploadData) {
    return window.STCTValidator.validateUploadData(data);
  }
  return { valid: true, errors: [], warnings: [], summary: {} };
}
function setUploadPreview(data, fileName) {
  uploadPreview = {
    data,
    fileName,
    validation: validateUploadData(data),
    createdAt: new Date().toLocaleString(),
  };
  dataStatus = "上传预览";
  dataSource = fileName || "上传文件";
  return uploadPreview;
}
function validationHtml(preview) {
  if (!preview) return "";
  const v = preview.validation || { errors: [], warnings: [], summary: {} };
  const ok = v.valid && !v.errors.length;
  const summary = v.summary || {};
  const rows = Object.entries(summary).map(([k, val]) =>
    '<span class="optimizer-badge">' + escapeHTML(k) + " " + escapeHTML(val) +
    "</span>"
  ).join("");
  const errs = (v.errors || []).map((x) => "<li>" + escapeHTML(x) + "</li>")
    .join("");
  const warns = (v.warnings || []).map((x) => "<li>" + escapeHTML(x) + "</li>")
    .join("");
  return '<div class="upload-status"><b>' + (ok ? "校验通过" : "校验未通过") +
    "</b><br><span>文件：</span>" + escapeHTML(preview.fileName || "") +
    "<br><span>类型：</span>" + escapeHTML(uploadKindLabel(preview.data)) +
    "<br>" + rows +
    (errs
      ? '<div style="color:#b91c1c;margin-top:8px"><b>错误</b><ul>' + errs +
        "</ul></div>"
      : "") +
    (warns
      ? '<div style="color:#b54708;margin-top:8px"><b>提醒</b><ul>' + warns +
        "</ul></div>"
      : "") +
    '<div class="optimizer-actions"><button class="primary-btn" id="confirmUploadPreview" ' +
    (!ok ? 'disabled style="opacity:.45;cursor:not-allowed"' : "") +
    '>确认进入下一步</button><button class="ghost-btn" id="cancelUploadPreview">取消预览</button></div></div>';
}
function confirmUploadPreview(statusEl) {
  if (!uploadPreview || !uploadPreview.validation.valid) return;
  const data = uploadPreview.data;
  if (data.__rawUpload) {
    const summary = loadRawData(data.raw);
    if (statusEl) {
      statusEl.innerHTML = "<b><span>Data 已进入待排车：</span></b>" +
        escapeHTML(uploadPreview.fileName) + "<br><span>已加载 </span>" +
        summary.orders + "<span> 个原始订单，</span>" + summary.vehicles +
        "<span> 台车辆、</span>" + summary.days +
        "<span> 个配送日。请进入排车页或路线页生成推荐路线。</span>";
    }
    switchView("optimizerView");
  } else {
    RAW_DATA = null;
    dataStatus = "已排车";
    const summary = applyUploadedData(data);
    if (statusEl) {
      statusEl.innerHTML = "<b><span>排程结果已应用：</span></b>" +
        escapeHTML(uploadPreview.fileName) + "<br><span>已加载 </span>" +
        summary.routes + "<span> 条路线，</span>" + summary.stops +
        "<span> 个停靠点、</span>" + summary.days + "<span> 个配送日。</span>";
    }
  }
  uploadPreview = null;
  if (typeof applyLanguage === "function") applyLanguage(currentLang);
}
function bindUploadPreviewActions(statusEl) {
  document.getElementById("confirmUploadPreview")?.addEventListener(
    "click",
    () => confirmUploadPreview(statusEl),
  );
  document.getElementById("cancelUploadPreview")?.addEventListener(
    "click",
    () => {
      uploadPreview = null;
      dataStatus = RAW_DATA ? "待排车" : "原始数据";
      renderUpload();
    },
  );
}
function renderUpload() {
  const el = document.getElementById("uploadContent");
  if (!el) return;
  el.innerHTML =
    '<div class="dash-grid"><div class="card span-7"><h3>上传数据</h3><div class="upload-box" id="uploadBox"><p><b>拖拽文件到这里</b>，或选择文件上传</p><p class="muted">支持 <span class="code-inline">.xlsx/.xls</span>、<span class="code-inline">routes-data.js</span> 或纯 JSON。支持 Data（Orders / Vehicles / Depots / Constraints）或已排程结果（Route Plan / Vehicle Summary）。</p><input id="uploadFile" type="file" accept=".xlsx,.xls,.js,.json,application/json"><div class="upload-actions"><button class="primary-btn" id="chooseUpload">选择文件</button></div><div class="upload-status" id="uploadStatus"><span>当前状态：</span>' +
    escapeHTML(dataStatus) + "<br><span>数据来源：</span>" +
    escapeHTML(dataSource) + "<br><span>当前数据：</span>" +
    DATA.routes.length + "<span> 条路线，</span>" +
    DATA.stopGeoJson.features.length + "<span> 个可绘制停靠点，</span>" +
    byDate.length +
    '<span> 个配送日。</span></div></div></div><div class="card span-5"><h3>数据文件要求</h3><ul class="field-list"><li>Data：包含 <span class="code-inline">Orders</span>、<span class="code-inline">Vehicles</span>、<span class="code-inline">Depots</span>、<span class="code-inline">Constraints</span> 工作表；订单需填写纬度/经度</li><li>上传 Data 后先进入待排车状态；点击排车页生成结果后，路线、分析、碳排会自动刷新。</li><li>经纬度缺失的点会进入异常页，无法在地图上显示。</li></ul><div class="mini-note"><b>重要：</b>浏览器里的上传只能即时预览。若要下次打开仍使用新数据，请保存并覆盖 <span class="code-inline">data/routes-data.js</span>。</div></div><div class="card span-12"><h3>数据下载</h3><div class="download-grid"><div class="download-card"><b>Data 空白模板</b><p>用于准备原始订单、车辆、仓库和限制条件，上传后由系统自动排车。</p><button class="ghost-btn" id="downloadTemplate">下载 Data 模板</button></div><div class="download-card"><b>STCT 合成 Data 演示数据</b><p>包含完全合成的订单、车辆、仓库和限制条件。上传后进入排车页，由系统生成路线结果。</p><button class="ghost-btn" id="downloadDemoDispatch">下载 Data Demo</button></div><div class="download-card"><b>当前系统数据</b><p>导出当前页面正在使用的 routes-data.js，可作为后续覆盖数据文件。</p><button class="ghost-btn" id="downloadCurrent">下载 routes-data.js</button></div><div class="download-card"><b>路线汇总 CSV</b><p>导出路线、车辆、距离、货量、利用率等分析基础数据。</p><button class="ghost-btn" id="downloadRoutesCsv">下载路线CSV</button></div><div class="download-card"><b>异常明细 CSV</b><p>导出缺坐标、拆分装载等数据质量问题。</p><button class="ghost-btn" id="downloadExceptionsCsv">下载异常CSV</button></div><div class="download-card"><b>碳排明细 CSV</b><p>按当前数据生成路线级 CO₂ 估算明细，默认 0.192 kg/km。</p><button class="ghost-btn" id="downloadCarbonCsv">下载碳排CSV</button></div></div></div></div>';
  const box = document.getElementById("uploadBox"),
    file = document.getElementById("uploadFile"),
    status = document.getElementById("uploadStatus");
  if (APP_CONFIG.enableUpload === false) {
    const b = document.getElementById("chooseUpload");
    if (b) {
      b.disabled = true;
      b.textContent = "上传已关闭";
    }
  }
  if (APP_CONFIG.enableExport === false) {
    [
      "downloadTemplate",
      "downloadDemoDispatch",
      "downloadCurrent",
      "downloadRoutesCsv",
      "downloadExceptionsCsv",
      "downloadCarbonCsv",
    ].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.disabled = true;
    });
  }
  document.getElementById("chooseUpload").onclick = () => file.click();
  function csvEscape(v) {
    return window.STCTUtils.csvSafe(v);
  }
  function downloadText(name, text, type = "text/csv") {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function toCsv(headers, rows) {
    return "# Source: " + dataSource + "\n# Exported at: " +
      new Date().toISOString() + "\n" + headers.join(",") + "\n" +
      rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")).join("\n");
  }
  async function handleFile(f) {
    try {
      window.STCTImportBudget.checkFileSize(f);
      const isExcel = /\.(xlsx|xls)$/i.test(f.name);
      const data = isExcel
        ? await parseExcelFile(f)
        : parseUploadedText(await f.text());
      const preview = setUploadPreview(data, f.name);
      status.innerHTML = validationHtml(preview);
      bindUploadPreviewActions(status);
      if (typeof applyLanguage === "function") applyLanguage(currentLang);
    } catch (err) {
      status.innerHTML =
        '<b style="color:#b91c1c"><span>上传失败：</span></b>' + escapeHTML(err.message);
      if (typeof applyLanguage === "function") applyLanguage(currentLang);
    }
  }
  file.onchange = (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  };
  box.ondragover = (e) => {
    e.preventDefault();
    box.classList.add("drag");
  };
  box.ondragleave = () => box.classList.remove("drag");
  box.ondrop = (e) => {
    e.preventDefault();
    box.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };
  document.getElementById("downloadTemplate").onclick = () => {
    const a = document.createElement("a");
    a.href = "./templates/raw-dispatch-template.xlsx";
    a.download = "Data 智能排车空白模板.xlsx";
    a.click();
  };
  document.getElementById("downloadDemoDispatch").onclick = () => {
    const a = document.createElement("a");
    a.href = "./assets/demo/stct-synthetic-demo.json";
    a.download = "stct-synthetic-demo.json";
    a.click();
  };
  document.getElementById("downloadCurrent").onclick = () =>
    downloadText(
      "routes-data.js",
      "// Source: " + dataSource + "\n// Exported at: " +
        new Date().toISOString() + "\nwindow.FLOWMAP_DATA = " +
        JSON.stringify(DATA, null, 2) + ";\n",
      "text/javascript",
    );
  document.getElementById("downloadRoutesCsv").onclick = () =>
    downloadText(
      "路线汇总.csv",
      toCsv([
        "date",
        "routeId",
        "vehicleId",
        "vehicleName",
        "stops",
        "packages",
        "weight",
        "volume",
        "km",
        "end",
        "weightUtil",
        "volumeUtil",
      ], DATA.routes),
    );
  document.getElementById("downloadExceptionsCsv").onclick = () => {
    const rows = [
      ...DATA.missingStops.map((x) => ({ ...x, type: "缺坐标" })),
      ...DATA.splitRows.map((x) => ({ ...x, type: "拆分装载" })),
    ];
    downloadText(
      "异常明细.csv",
      toCsv([
        "type",
        "date",
        "routeId",
        "vehicleId",
        "code",
        "name",
        "dest",
        "cargoCode",
        "message",
      ], rows),
    );
  };
  document.getElementById("downloadCarbonCsv").onclick = () => {
    const rows = DATA.routes.map((r) => ({
      ...r,
      co2: (r.km * 0.192).toFixed(2),
      factor: 0.192,
    }));
    downloadText(
      "碳排明细.csv",
      toCsv([
        "date",
        "routeId",
        "vehicleId",
        "vehicleName",
        "km",
        "packages",
        "volumeUtil",
        "co2",
        "factor",
      ], rows),
    );
  };
}
function localizeAfterRender() {
  if (typeof applyLanguage === "function") applyLanguage(currentLang);
}
function wrapLocalizedRender(name) {
  let original;
  try {
    original = eval(name);
  } catch (err) {
    return;
  }
  if (typeof original === "function") {
    window[name] = function () {
      const result = original.apply(this, arguments);
      localizeAfterRender();
      return result;
    };
    eval(name + "=window[name]");
  }
}
[
  "updateControls",
  "updateMetrics",
  "showRouteDetail",
  "showStopDetail",
  "renderOverview",
  "renderOptimizer",
  "renderAnalysis",
  "renderCarbon",
  "renderExceptions",
  "renderUpload",
].forEach(wrapLocalizedRender);

function optimizerDistanceKm(a, b) {
  const R = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180,
    dLon = (b[0] - a[0]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * Number(APP_CONFIG.roadDistanceFactor || 1.35);
}
function optimizerTimeAdd(t, min) {
  let h = Math.floor(t / 60), m = t % 60;
  let total = h * 60 + m + min;
  if (total > 720 && t < 780) total = 780 + (total - 720);
  return total;
}
function optimizerTimeText(total) {
  const h = Math.floor(total / 60), m = Math.round(total % 60);
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function optimizerTimeValue(text) {
  if (typeof text === "number") return text;
  const m = String(text || "").match(/(\d{1,2})[:：](\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function optimizerUtilText(v, max) {
  return max ? Math.min(100, v / max * 100).toFixed(1) + "%" : "0%";
}
function optimizerSourceOrders() {
  const sourceDate = optimizerSelectedDate();
  const limitValue = document.getElementById("optimizerLimit")?.value || "60";
  if (RAW_DATA) {
    let orders = RAW_DATA.orders.filter((o) =>
      !sourceDate || sourceDate === "ALL" || o.date === sourceDate
    ).map((o) => ({ ...o, sourceRoute: "RAW" }));
    orders.sort((a, b) =>
      optimizerDistanceKm([RAW_DATA.depot.lon, RAW_DATA.depot.lat], [
        a.lon,
        a.lat,
      ]) -
      optimizerDistanceKm([RAW_DATA.depot.lon, RAW_DATA.depot.lat], [
        b.lon,
        b.lat,
      ])
    );
    if (limitValue !== "ALL") orders = orders.slice(0, Number(limitValue));
    return orders;
  }
  let features = DATA.stopGeoJson.features.filter((f) =>
    f.properties.date === sourceDate &&
    Number.isFinite(f.geometry.coordinates[0]) &&
    Number.isFinite(f.geometry.coordinates[1])
  );
  if (!features.length) {
    features = DATA.stopGeoJson.features.filter((f) =>
      Number.isFinite(f.geometry.coordinates[0]) &&
      Number.isFinite(f.geometry.coordinates[1])
    );
  }
  const seen = new Set();
  let orders = features.map((f, i) => ({
    id: "ORD-" + String(i + 1).padStart(4, "0"),
    code: f.properties.code || ("C" + i),
    name: f.properties.name || ("配送点 " + (i + 1)),
    addr: f.properties.addr || "",
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    count: Number(f.properties.count || 1),
    weight: Math.max(1, Number(f.properties.weight || f.properties.count || 1)),
    volume: Math.max(1, Number(f.properties.volume || f.properties.count || 1)),
    serviceMin: Math.max(1, Number(f.properties.serviceMin || 1)),
    twStart: "09:00",
    twEnd: "17:30",
    sourceRoute: f.properties.routeId,
  })).filter((o) => {
    const key = o.code + "-" + o.lon.toFixed(5) + "-" + o.lat.toFixed(5);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  orders.sort((a, b) =>
    optimizerDistanceKm([DATA.depot.lon, DATA.depot.lat], [a.lon, a.lat]) -
    optimizerDistanceKm([DATA.depot.lon, DATA.depot.lat], [b.lon, b.lat])
  );
  if (limitValue !== "ALL") orders = orders.slice(0, Number(limitValue));
  return orders;
}
function optimizerVehicles() {
  const sourceDate = optimizerSelectedDate();
  if (RAW_DATA) {
    return RAW_DATA.vehicles.filter((v) =>
      !v.availableDate || sourceDate === "ALL" || v.availableDate === sourceDate
    ).map((v, i) => ({ ...v, color: routeColorByIndex(i) })).filter((v) =>
      v.maxVolume > 0
    );
  }
  let routes = DATA.routes.filter((r) => r.date === sourceDate);
  if (!routes.length) routes = DATA.routes.slice(0, 23);
  const unique = [...new Map(routes.map((r) => [r.vehicleId, r])).values()];
  return unique.map((r, i) => ({
    vehicleId: r.vehicleId || ("V" + String(i + 1).padStart(2, "0")),
    vehicleName: r.vehicleName || "配送车辆",
    maxWeight: Number(r.maxWeight || Math.max(r.weight * 1.25, 500)),
    maxVolume: Number(r.maxVolume || Math.max(r.volume * 1.25, 500)),
    color: routeColorByIndex(i),
  })).filter((v) => v.maxVolume > 0);
}
function buildOptimizedPlan() {
  const goal = document.getElementById("optimizerGoal")?.value || "balanced";
  const sourceDate = optimizerSelectedDate();
  const date = RAW_DATA && sourceDate && sourceDate !== "ALL"
    ? sourceDate
    : "OPT-" + new Date().toISOString().slice(0, 10);
  const depot = RAW_DATA ? RAW_DATA.depot : DATA.depot;
  let orders = optimizerSourceOrders();
  let vehicles = optimizerVehicles();
  if (goal === "vehicles") {
    vehicles = vehicles.sort((a, b) => b.maxVolume - a.maxVolume);
  }
  if (goal === "utilization" || goal === "finish") {
    vehicles = vehicles.sort((a, b) => a.maxVolume - b.maxVolume);
  }
  const pending = orders.slice();
  const routes = [];
  const missingStops = [];
  const routeFeatures = [];
  const stopFeatures = [];
  let vehicleIndex = 0;
  function takeNextRoute(vehicle, routeNo) {
    const stops = [];
    let weight = 0,
      volume = 0,
      packages = 0,
      km = 0,
      time = 9 * 60,
      last = [depot.lon, depot.lat];
    while (pending.length) {
      let candidates = pending.map((o, idx) => {
        const d = optimizerDistanceKm(last, [o.lon, o.lat]);
        const arriveTime = optimizerTimeAdd(
          time,
          Math.round(d / ((RAW_DATA?.constraints?.averageSpeedKmh) || 28) * 60),
        );
        let arriveVal = optimizerTimeValue(arriveTime);
        const twStart = optimizerTimeValue(o.twStart || "09:00"),
          twEnd = optimizerTimeValue(o.twEnd || "17:30");
        if (twStart && arriveVal < twStart) arriveVal = twStart;
        return {
          o,
          idx,
          d,
          arriveVal,
          twStart,
          twEnd,
          depotD: optimizerDistanceKm([depot.lon, depot.lat], [o.lon, o.lat]),
        };
      }).filter((x) =>
        weight + x.o.weight <= vehicle.maxWeight &&
        volume + x.o.volume <= vehicle.maxVolume &&
        (!x.twEnd || x.arriveVal <= x.twEnd)
      );
      if (!candidates.length) break;
      if (goal === "distance" || goal === "finish" || goal === "balanced") {
        candidates.sort((a, b) => a.d - b.d);
      } else if (goal === "vehicles") {
        candidates.sort((a, b) =>
          (b.o.volume + b.o.weight) - (a.o.volume + a.o.weight)
        );
      } else if (goal === "utilization") {
        candidates.sort((a, b) => {
          const scoreA = (a.o.volume / vehicle.maxVolume) * 0.72 +
            (a.o.weight / vehicle.maxWeight) * 0.28 - (a.d * 0.002);
          const scoreB = (b.o.volume / vehicle.maxVolume) * 0.72 +
            (b.o.weight / vehicle.maxWeight) * 0.28 - (b.d * 0.002);
          return scoreB - scoreA;
        });
      }
      const pick = candidates[0];
      pending.splice(pick.idx, 1);
      const travel = pick.d;
      km += travel;
      time = optimizerTimeAdd(
        time,
        Math.round(
          travel / ((RAW_DATA?.constraints?.averageSpeedKmh) || 28) * 60,
        ),
      );
      if (pick.twStart && time < pick.twStart) time = pick.twStart;
      const arrive = optimizerTimeText(time);
      const service = Math.max(
        1,
        pick.o.serviceMin + (Math.max(0, pick.o.count - 1) * 0.5),
      );
      time = optimizerTimeAdd(time, Math.round(service));
      const depart = optimizerTimeText(time);
      weight += pick.o.weight;
      volume += pick.o.volume;
      packages += pick.o.count;
      stops.push({
        ...pick.o,
        seq: stops.length + 1,
        travelKm: travel,
        travelMin: Math.round(travel / 28 * 60),
        arrive,
        depart,
      });
      last = [pick.o.lon, pick.o.lat];
      if (time > 17 * 60 + 20) break;
    }
    if (!stops.length) return null;
    const back = optimizerDistanceKm(last, [depot.lon, depot.lat]);
    km += back;
    time = optimizerTimeAdd(
      time,
      Math.round(back / ((RAW_DATA?.constraints?.averageSpeedKmh) || 28) * 60),
    );
    const routeId = date + "-" + String(routeNo).padStart(2, "0");
    const line = [[depot.lon, depot.lat], ...stops.map((s) => [s.lon, s.lat]), [
      depot.lon,
      depot.lat,
    ]];
    const route = {
      date,
      routeId,
      vehicleId: vehicle.vehicleId,
      vehicleName: vehicle.vehicleName,
      stops: stops.length,
      packages,
      weight,
      maxWeight: vehicle.maxWeight,
      volume,
      maxVolume: vehicle.maxVolume,
      km: Number(km.toFixed(1)),
      start: "09:00",
      end: optimizerTimeText(time),
      status: time <= 17 * 60 + 30 ? "OK" : "时间超出",
      weightUtil: optimizerUtilText(weight, vehicle.maxWeight),
      volumeUtil: optimizerUtilText(volume, vehicle.maxVolume),
      color: vehicle.color,
    };
    routes.push(route);
    routeFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line },
      properties: { ...route, color: vehicle.color },
    });
    stops.forEach((s) =>
      stopFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: {
          date,
          routeId,
          vehicleId: vehicle.vehicleId,
          vehicleName: vehicle.vehicleName,
          seq: s.seq,
          code: s.code,
          name: s.name,
          addr: s.addr,
          batch: s.seq,
          count: s.count,
          weight: s.weight,
          volume: s.volume,
          serviceMin: s.serviceMin,
          arrive: s.arrive,
          depart: s.depart,
          travelKm: Number(s.travelKm.toFixed(1)),
          travelMin: s.travelMin,
          coordStatus: "OK",
          cargoCodes: s.id,
          color: vehicle.color,
        },
      })
    );
    return route;
  }
  let routeNo = 1;
  while (pending.length && vehicleIndex < vehicles.length) {
    const r = takeNextRoute(vehicles[vehicleIndex], routeNo);
    vehicleIndex++;
    if (r) routeNo++;
  }
  pending.forEach((o) =>
    missingStops.push({
      date,
      routeId: "UNASSIGNED",
      vehicleId: "-",
      seq: 0,
      code: o.code,
      name: o.name,
      count: o.count,
      weight: o.weight,
      volume: o.volume,
      arrive: "-",
      depart: "-",
      reason: "车辆容量或时间不足",
    })
  );
  const day = {
    date,
    vehicles: routes.length,
    destinations: stopFeatures.length,
    stopBatches: stopFeatures.length,
    packages: routes.reduce((a, r) => a + r.packages, 0),
    weight: routes.reduce((a, r) => a + r.weight, 0),
    volume: routes.reduce((a, r) => a + r.volume, 0),
    km: Number(routes.reduce((a, r) => a + r.km, 0).toFixed(1)),
    latestEnd: routes.map((r) => r.end).sort().at(-1) || "-",
    status: missingStops.length ? "需人工确认" : "OK",
  };
  return {
    depot,
    routes,
    daySummaries: [day],
    routeGeoJson: { type: "FeatureCollection", features: routeFeatures },
    stopGeoJson: { type: "FeatureCollection", features: stopFeatures },
    missingStops,
    splitRows: [],
    meta: {
      goal,
      orders: orders.length,
      unassigned: missingStops.length,
      generatedAt: new Date().toLocaleString(),
    },
  };
}
async function buildOptimizedPlanWithEngine() {
  if (!RAW_DATA) return buildOptimizedPlan();
  const goal = document.getElementById("optimizerGoal")?.value || "balanced";
  const sourceDate = optimizerSelectedDate();
  const limit = document.getElementById("optimizerLimit")?.value || "60";
  try {
    const res = await fetch(
      APP_CONFIG.optimizerApiUrl || "http://127.0.0.1:8787/optimize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          (window.STCTOptimizer && window.STCTOptimizer.buildRequest)
            ? window.STCTOptimizer.buildRequest({
              raw: RAW_DATA,
              date: sourceDate,
              goal,
              limit,
              timeLimitSeconds: 30,
            })
            : {
              raw: RAW_DATA,
              date: sourceDate,
              goal,
              limit,
              timeLimitSeconds: 30,
            },
        ),
      },
    );
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "OR-Tools 服务未返回结果");
    }
    return (window.STCTOptimizer && window.STCTOptimizer.normalizeResponse)
      ? window.STCTOptimizer.normalizeResponse(json)
      : {
        ...json.plan,
        engine: "OR-Tools",
        meta: {
          ...((json.plan && json.plan.meta) || {}),
          source: "OR-Tools API",
          apiVersion: "v1",
        },
      };
  } catch (err) {
    console.warn("OR-Tools optimizer fallback:", err);
    const fallback = buildOptimizedPlan();
    fallback.engine = "演示算法（OR-Tools 未连接）";
    fallback.meta = {
      ...fallback.meta,
      source: "前端演示算法",
      apiVersion: "mock-v1",
    };
    dataStatus = "已排车";
    fallback.engineError = err.message;
    return fallback;
  }
}
function renderOptimizer() {
  const el = document.getElementById("optimizerContent");
  if (!el) return;
  const orders = optimizerSourceOrders();
  const vehicles = optimizerVehicles();
  const current = optimizerPlan;
  const plan = current || { routes: [], daySummaries: [{}], missingStops: [] };
  const routes = plan.routes || [];
  const day = plan.daySummaries[0] || {};
  const avgVol = routes.length
    ? routes.reduce((a, r) => a + utilNum(r.volumeUtil), 0) / routes.length
    : 0;
  const engineNote = plan.engine
    ? "<br><b>当前引擎：</b>" + plan.engine +
      (plan.engineError
        ? ' <span class="optimizer-warn">OR-Tools 回退原因：' +
          plan.engineError + "</span>"
        : "")
    : "";
  el.innerHTML =
    '<div class="optimizer-kpi"><div class="card"><h3>可排订单</h3><div class="big-num">' +
    fmt(orders.length) + '</div><div class="muted">' +
    (RAW_DATA ? "来自上传 Raw Data 的原始订单" : "来自当前路线数据的演示订单") +
    '</div></div><div class="card"><h3>可用车辆</h3><div class="big-num">' +
    fmt(vehicles.length) + '</div><div class="muted">' +
    (RAW_DATA ? "来自上传 Raw Data 的车辆主数据" : "按当前计划车辆能力生成") +
    '</div></div><div class="card"><h3>推荐路线</h3><div class="big-num">' +
    fmt(routes.length) +
    '</div><div class="muted">自动排车结果</div></div><div class="card"><h3>平均容积</h3><div class="big-num">' +
    avgVol.toFixed(0) +
    '%</div><div class="muted">推荐路线平均</div></div></div><div class="card span-12"><h3>生成设置</h3><div class="mini-note">' +
    (RAW_DATA
      ? "当前已加载 Raw Data：订单、车辆、仓库和时间窗约束。Raw Data 会优先调用本地 OR-Tools 服务；服务未启动时自动回退到前端演示算法。<br><b>硬指标：</b>OR-Tools 模式下所有订单必须配送，不允许静默丢单。<br><b>目标逻辑：</b>综合平衡：先考虑距离接近，兼顾容量和时间窗；最少车辆优先：优先使用大容量车辆，并尽量把大订单合并到同车；最短距离优先：每一步选择离当前停靠点最近的可行订单；装载率优先：优先使用容量更接近的小车，并按容积/载重填充率提升选择订单；最早完成优先：优先使用小车和近距离订单，尽量缩短回库时间。"
      : "演示算法会考虑经纬度、车辆载重/容积、预计行驶时间、9:00-17:30 作业时间和 12:00-13:00 午休。当前为前端启发式排车，用于客户演示，不等同正式最优算法。<br><b>目标逻辑：</b>综合平衡：先考虑距离接近，兼顾容量和时间窗；最少车辆优先：优先使用大容量车辆，并尽量把大订单合并到同车；最短距离优先：每一步选择离当前停靠点最近的可行订单；装载率优先：优先使用容量更接近的小车，并按容积/载重填充率提升选择订单；最早完成优先：优先使用小车和近距离订单，尽量缩短回库时间。") +
    engineNote +
    '</div><div class="optimizer-actions"><button class="primary-btn" id="runOptimizerBtn">生成推荐路线</button><button class="ghost-btn" id="applyOptimizerBtn" ' +
    (!current ? 'disabled style="opacity:.45;cursor:not-allowed"' : "") +
    '>应用到路线/分析/碳排</button><button class="ghost-btn" id="restoreOptimizerBtn">恢复原始数据</button></div><div class="optimizer-result"><span class="optimizer-badge">总距离 ' +
    (day.km || 0) + ' km</span><span class="optimizer-badge">最晚回库 ' +
    (day.latestEnd || "-") + '</span><span class="optimizer-badge">货物件数 ' +
    fmt(day.packages || 0) + '</span><span class="optimizer-badge ' +
    (plan.missingStops.length ? "optimizer-warn" : "") + '">未分配 ' +
    plan.missingStops.length + '</span><span class="optimizer-badge">策略 ' +
    (document.getElementById("optimizerGoal")?.selectedOptions[0]
      ?.textContent || "综合平衡") +
    '</span></div></div><div class="dash-grid" style="margin-top:14px"><div class="card span-7"><h3>推荐路线明细</h3><div class="optimizer-route-list">' +
    routes.map((r) =>
      '<div class="optimizer-route-card"><b>' + r.routeId +
      '</b><div class="mini-note">车辆 ' + r.vehicleId + " / " + r.vehicleName +
      " · " + r.stops + " 点 · " + r.km + " km · 回库 " + r.end +
      '</div><span class="optimizer-badge">容积 ' + r.volumeUtil +
      '</span><span class="optimizer-badge">载重 ' + r.weightUtil +
      '</span><span class="optimizer-badge">件数 ' + fmt(r.packages) +
      "</span></div>"
    ).join("") +
    '</div></div><div class="card span-5"><h3>异常与人工确认</h3>' +
    (plan.missingStops.length
      ? '<table class="table"><thead><tr><th>订单</th><th>原因</th></tr></thead><tbody>' +
        plan.missingStops.slice(0, 12).map((x) =>
          "<tr><td>" + x.code + "</td><td>" + (x.reason || "未分配") +
          "</td></tr>"
        ).join("") + "</tbody></table>"
      : '<div class="insight">当前演示订单均已成功排入车辆。可进入路线页查看地图动线。</div>') +
    '<div class="insight">正式版本建议接入 OSRM 或商用地图 API 计算真实道路时间。</div></div></div>';
  document.getElementById("runOptimizerBtn").onclick = async () => {
    const btn = document.getElementById("runOptimizerBtn");
    btn.disabled = true;
    btn.textContent = "正在优化...";
    optimizerPlan = await buildOptimizedPlanWithEngine();
    dataStatus = "已排车";
    dataSource = (optimizerPlan.meta && optimizerPlan.meta.source) ||
      optimizerPlan.engine || dataSource;
    renderOptimizer();
    renderRouteOptimizerStatus();
  };
  document.getElementById("applyOptimizerBtn").onclick = () => {
    if (!optimizerPlan) return;
    applyUploadedData(optimizerPlan);
    switchView("mapView");
    renderRouteOptimizerStatus();
  };
  document.getElementById("restoreOptimizerBtn").onclick = () => {
    optimizerPlan = null;
    applyUploadedData(JSON.parse(JSON.stringify(ORIGINAL_DATA)));
    switchView("optimizerView");
    renderRouteOptimizerStatus();
  };
}
function routeOptimizerDateOptions() {
  const dates = RAW_DATA ? rawDates() : byDate;
  return RAW_DATA
    ? [
      { label: "全部日期", value: "ALL" },
      ...dates.map((d) => ({ label: d, value: d })),
    ]
    : dates.map((d) => ({ label: d, value: d }));
}
function syncRouteOptimizerControls() {
  const dateEl = document.getElementById("mapOptimizerDate"),
    goalEl = document.getElementById("mapOptimizerGoal"),
    limitEl = document.getElementById("mapOptimizerLimit");
  if (dateEl) {
    const current = dateEl.value || state.date;
    fillSelect(dateEl, routeOptimizerDateOptions());
    dateEl.value = [...dateEl.options].some((o) => o.value === current)
      ? current
      : (RAW_DATA ? "ALL" : state.date);
  }
  if (goalEl && document.getElementById("optimizerGoal")) {
    goalEl.value = document.getElementById("optimizerGoal").value ||
      goalEl.value;
  }
  if (limitEl && document.getElementById("optimizerLimit")) {
    limitEl.value = document.getElementById("optimizerLimit").value ||
      limitEl.value;
  }
  renderRouteOptimizerStatus();
}
function renderRouteOptimizerStatus() {
  const status = document.getElementById("mapOptimizerStatus"),
    engine = document.getElementById("mapOptimizerEngine"),
    apply = document.getElementById("mapApplyOptimizerBtn");
  if (!status) return;
  const orders = optimizerSourceOrders();
  const vehicles = optimizerVehicles();
  const planningState = window.STCTPlanning?.state;
  const health = planningState?.engineHealth;
  const healthLabel = health?.available
    ? "OR-Tools 可用"
    : ["unreachable", "timeout"].includes(health?.status)
    ? "优化服务连接失败 · Demo Heuristic"
    : health?.status === "not_checked"
    ? "尚未检测"
    : "OR-Tools 不可用 · Demo Heuristic";
  if (!optimizerPlan) {
    status.innerHTML = (RAW_DATA ? "已加载原始数据：" : "当前使用内置演示数据：") +
      "<b>" + fmt(orders.length) + "</b> Orders，<b>" + fmt(vehicles.length) +
      "</b> Vehicles。请选择目标后生成候选方案。" +
      (planningState?.staleReason ? "<br><span class=\"warn\">" + escapeHTML(planningState.staleReason) + "</span>" : "");
    if (engine) engine.textContent = healthLabel;
    if (apply) {
      apply.disabled = true;
      apply.style.opacity = ".45";
      apply.style.cursor = "not-allowed";
    }
    return;
  }
  const day = (optimizerPlan.daySummaries && optimizerPlan.daySummaries[0]) ||
    {};
  const conservation = optimizerPlan.conservation || {};
  const missing = Number(conservation.unassigned || 0) + Number(conservation.blocked || 0);
  status.innerHTML = '<span class="route-optimizer-pill">路线 ' +
    fmt((optimizerPlan.routes || []).length) +
    '</span><span class="route-optimizer-pill">总距离 ' + (day.km || 0) +
    ' km</span><span class="route-optimizer-pill">最晚回库 ' +
    (day.latestEnd || "-") + '</span><span class="route-optimizer-pill ' +
    (missing ? "warn" : "") + '">未分配 ' + missing +
    "</span><br><span>当前引擎：</span><b>" +
    escapeHTML(optimizerPlan.engine || "Demo Heuristic") + "</b>" +
    (optimizerPlan.meta?.engineError
      ? '<br><span class="warn">OR-Tools 回退原因：' +
        escapeHTML(optimizerPlan.meta.engineError) + "</span>"
      : "");
  if (engine) engine.textContent = optimizerPlan.engine || "已生成";
  if (apply) {
    apply.disabled = conservation.balanced === false;
    apply.style.opacity = apply.disabled ? ".45" : "1";
    apply.style.cursor = apply.disabled ? "not-allowed" : "pointer";
  }
}
function syncOptimizerFromRoutePanel() {
  const d = document.getElementById("mapOptimizerDate")?.value;
  const g = document.getElementById("mapOptimizerGoal")?.value;
  const l = document.getElementById("mapOptimizerLimit")?.value;
  const od = document.getElementById("optimizerDate"),
    og = document.getElementById("optimizerGoal"),
    ol = document.getElementById("optimizerLimit");
  if (od && d) od.value = d;
  if (og && g) og.value = g;
  if (ol && l) ol.value = l;
}
async function runRouteOptimizerPanel() {
  syncOptimizerFromRoutePanel();
  const btn = document.getElementById("mapRunOptimizerBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "正在优化...";
  }
  try {
    if (!window.STCTOptimizer || !window.STCTPlanning) {
      throw new Error("规划模块尚未就绪");
    }
    const date = document.getElementById("mapOptimizerDate")?.value || "ALL";
    const limit = document.getElementById("mapOptimizerLimit")?.value || "60";
    const goal = document.getElementById("mapOptimizerGoal")?.value || "balanced";
    await window.STCTOptimizer.generateScenarios({ date, limit });
    window.STCTPlanning.selectScenario(goal);
    optimizerPlan = window.STCTPlanning.currentCandidate();
    dataStatus = "候选方案已生成";
    dataSource = optimizerPlan?.meta?.source || optimizerPlan?.engine || dataSource;
    renderOptimizer();
    renderRouteOptimizerStatus();
  } catch (error) {
    window.STCTUpload?.notify?.(error.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "生成 6 个候选方案";
    }
  }
}
async function applyRouteOptimizerPanel() {
  try {
    optimizerPlan = await window.STCTPlanning?.applySelected?.();
    if (!optimizerPlan) return;
    switchView("mapView");
    renderRouteOptimizerStatus();
  } catch (error) {
    window.STCTUpload?.notify?.(error.message, "error");
  }
}
function syncDashboardControls() {
  const opts = [
    { label: "全部日期", value: "ALL" },
    ...byDate.map((d) => ({ label: d, value: d })),
  ];
  const od = document.getElementById("overviewDate"),
    optd = document.getElementById("optimizerDate"),
    ad = document.getElementById("analysisDate"),
    cd = document.getElementById("carbonDate");
  if (od) {
    fillSelect(od, opts);
    od.value = dashState.overviewDate;
  }
  if (optd) {
    const optimizerDates = RAW_DATA ? rawDates() : byDate;
    const optimizerOpts = RAW_DATA
      ? [
        { label: "全部日期", value: "ALL" },
        ...optimizerDates.map((d) => ({ label: d, value: d })),
      ]
      : optimizerDates.map((d) => ({ label: d, value: d }));
    fillSelect(optd, optimizerOpts);
    optd.value = RAW_DATA
      ? (optimizerDates.includes(state.date) ? state.date : "ALL")
      : (optimizerDates.includes(state.date) ? state.date : optimizerDates[0]);
  }
  if (ad) {
    fillSelect(ad, opts);
    ad.value = dashState.analysisDate;
  }
  if (cd) {
    fillSelect(cd, opts);
    cd.value = dashState.carbonDate;
  }
  const cv = document.getElementById("carbonVehicle");
  if (cv) {
    const vehicles = [{ label: "全部车型/车辆", value: "ALL" }, ...[
      ...new Map(
        DATA.routes.map(
          (r) => [r.vehicleId, {
            label: r.vehicleId + " / " + r.vehicleName,
            value: r.vehicleId,
          }],
        ),
      ).values(),
    ]];
    fillSelect(cv, vehicles);
    cv.value = dashState.carbonVehicle;
  }
  syncRouteOptimizerControls();
}
function renderAllDashboards() {
  const lang = currentLang;
  currentLang = "zh";
  renderOverview();
  renderOptimizer();
  renderAnalysis();
  renderCarbon();
  renderExceptions();
  renderUpload();
  currentLang = lang;
  if (typeof applyLanguage === "function") applyLanguage(lang);
}
function closeRouteFilter() {
  document.querySelector(".app")?.classList.remove("route-filter-open");
  if (map && typeof map.resize === "function") {
    setTimeout(() => map.resize(), 80);
  }
}
function openRouteFilter() {
  document.querySelector(".app")?.classList.add("route-filter-open");
}
function toggleRouteFilter() {
  const app = document.querySelector(".app");
  if (!app) return;
  app.classList.toggle("route-filter-open");
  if (map && typeof map.resize === "function") {
    setTimeout(() => map.resize(), 80);
  }
}
function switchView(id) {
  const platform = window.STCTPlatformV19;
  const destination = platform?.legacyRoutes?.getById(id)?.targetLogicalPath;
  if (window.STCT_V8_PLATFORM_ENTRY && platform?.instance && destination) {
    platform.instance.navigate(destination);
    return;
  }
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === id)
  );
  document.querySelectorAll(".navbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === id)
  );
  document.querySelector(".app").classList.toggle(
    "no-filter",
    id !== "mapView",
  );
  if (id !== "mapView") closeRouteFilter();
  if (id === "mapView" && map && typeof map.resize === "function") {
    setTimeout(() => map.resize(), 80);
    if (state.route && state.route !== "ALL") {
      setTimeout(() => showRouteDetail(state.route), 140);
    }
  }
  if (id !== "platformRouteView" || !window.STCT_V8_PLATFORM_ENTRY) {
    if (!legacyDashboardReady) {
      updateControls();
      updateMetrics();
      syncDashboardControls();
      legacyDashboardReady = true;
    }
    renderAllDashboards();
    if (typeof applyLanguage === "function") applyLanguage(currentLang);
  }
}
document.querySelectorAll(".navbtn[data-view]").forEach((btn) =>
  btn.addEventListener("click", () => switchView(btn.dataset.view))
);
document.getElementById("mobileFilterToggle")?.addEventListener(
  "click",
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRouteFilter();
  },
);
document.getElementById("filterScrim")?.addEventListener(
  "click",
  closeRouteFilter,
);
document.getElementById("overviewDate")?.addEventListener("change", (e) => {
  dashState.overviewDate = e.target.value;
  renderOverview();
});
document.getElementById("optimizerDate")?.addEventListener(
  "change",
  renderOptimizer,
);
document.getElementById("optimizerGoal")?.addEventListener(
  "change",
  renderOptimizer,
);
document.getElementById("optimizerLimit")?.addEventListener(
  "change",
  renderOptimizer,
);
document.getElementById("mapOptimizerDate")?.addEventListener("change", () => {
  syncOptimizerFromRoutePanel();
  renderRouteOptimizerStatus();
});
document.getElementById("mapOptimizerGoal")?.addEventListener("change", () => {
  syncOptimizerFromRoutePanel();
  renderRouteOptimizerStatus();
});
document.getElementById("mapOptimizerLimit")?.addEventListener("change", () => {
  syncOptimizerFromRoutePanel();
  renderRouteOptimizerStatus();
});
document.getElementById("mapRunOptimizerBtn")?.addEventListener(
  "click",
  runRouteOptimizerPanel,
);
document.getElementById("mapApplyOptimizerBtn")?.addEventListener(
  "click",
  applyRouteOptimizerPanel,
);
document.getElementById("mapOpenOptimizerBtn")?.addEventListener(
  "click",
  () => switchView("optimizerView"),
);
document.getElementById("analysisMetric")?.addEventListener(
  "change",
  renderAnalysis,
);
document.getElementById("analysisDate")?.addEventListener("change", (e) => {
  dashState.analysisDate = e.target.value;
  renderAnalysis();
});
document.getElementById("emissionFactor")?.addEventListener(
  "change",
  renderCarbon,
);
document.getElementById("carbonDate")?.addEventListener("change", (e) => {
  dashState.carbonDate = e.target.value;
  renderCarbon();
});
document.getElementById("carbonVehicle")?.addEventListener("change", (e) => {
  dashState.carbonVehicle = e.target.value;
  renderCarbon();
});
document.getElementById("carbonUtil")?.addEventListener("change", (e) => {
  dashState.carbonUtil = e.target.value;
  renderCarbon();
});
document.getElementById("carbonDistance")?.addEventListener("change", (e) => {
  dashState.carbonDistance = e.target.value;
  renderCarbon();
});
let legacyDashboardReady = !window.STCT_V8_PLATFORM_ENTRY;
if (legacyDashboardReady) {
  updateControls();
  updateMetrics();
  syncDashboardControls();
  renderAllDashboards();
}
let map = null, depotMarker = null;
const forceNoWebGL = new URLSearchParams(window.location.search).get("noWebGL") === "1";
const hasMapLibre = Boolean(
  !window.STCTPlatformV19?.mapRuntime && !forceNoWebGL && window.maplibregl && typeof maplibregl.Map === "function",
);
let mapInitError = null;
if (hasMapLibre) {
  state.mapTheme = window.STCTPlatformV19?.theme?.basemap(APP_CONFIG) === MAP_STYLES.dark ? "dark" : state.mapTheme;
  try {
    map = new maplibregl.Map({
      container: "map",
      style: window.STCTPlatformV19?.theme?.basemap(APP_CONFIG) || APP_CONFIG.mapStyleUrl || MAP_STYLES.liberty,
      center: [DATA.depot.lon, DATA.depot.lat],
      zoom: 11,
      attributionControl: true,
      localIdeographFontFamily: "sans-serif",
      transformRequest: (url, resourceType) => {
        if (
          resourceType === "Glyphs" &&
          url.startsWith("https://tiles.openfreemap.org/fonts/")
        ) {
          const font = /bold/i.test(url)
            ? "Noto Sans Bold"
            : "Noto Sans Regular";
          return {
            url: url.replace(
              /\/fonts\/[^/]+\//,
              `/fonts/${encodeURIComponent(font)}/`,
            ),
          };
        }
        return { url };
      },
    });
  } catch (error) {
    mapInitError = error;
    console.warn("MapLibre initialization failed", error);
  }
}
if (map) {
  window.map = map;
  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    "bottom-right",
  );
  function addFlowMapLayers() {
    if (map.getSource("routes")) return;
    map.addSource("routes", { type: "geojson", data: selectedRouteFeatures() });
    map.addSource("road-routes", { type: "geojson", data: EMPTY_FC });
    map.addSource("heat-stops", {
      type: "geojson",
      data: selectedStopFeatures(),
    });
    map.addSource("segment-labels", {
      type: "geojson",
      data: selectedSegmentFeatures(),
    });
    map.addSource("stops", {
      type: "geojson",
      data: selectedStopFeatures(),
      cluster: true,
      clusterRadius: 32,
      clusterMaxZoom: 12,
    });
    map.addSource("depot", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [DATA.depot.lon, DATA.depot.lat],
          },
          properties: DATA.depot,
        }],
      },
    });
    map.addLayer({
      id: "esg-backdrop",
      type: "background",
      layout: { visibility: "none" },
      paint: {
        "background-color": "rgba(15,23,42,.16)",
        "background-opacity": 1,
      },
    });
    map.addLayer({
      id: "esg-stop-heat",
      type: "heatmap",
      source: "heat-stops",
      maxzoom: 16,
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "heatWeight"],
          0,
          0.18,
          0.35,
          0.72,
          1,
          1.35,
        ],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          7,
          0.83,
          11,
          1.6,
          14,
          2.13,
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 13, 42],
        "heatmap-opacity": 0.92,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(22,163,74,0)",
          0.12,
          "rgba(34,197,94,.55)",
          0.28,
          "rgba(163,230,53,.72)",
          0.45,
          "rgba(250,204,21,.84)",
          0.63,
          "rgba(249,115,22,.92)",
          0.82,
          "rgba(239,68,68,.98)",
          1,
          "rgba(127,29,29,1)",
        ],
      },
    });
    map.addLayer({
      id: "esg-route-heat",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["get", "carbonScore"],
          0,
          8,
          8000,
          14,
          18000,
          22,
          32000,
          30,
        ],
        "line-opacity": 0.82,
        "line-blur": 5,
      },
    });
    map.addLayer({
      id: "route-glow",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 7,
        "line-opacity": 0.14,
        "line-blur": 2,
      },
    });
    map.addLayer({
      id: "route-lines",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3.2,
        "line-opacity": 0.86,
      },
    });
    map.addLayer({
      id: "road-route-casing",
      type: "line",
      source: "road-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 12,
        "line-opacity": 0.98,
      },
    });
    map.addLayer({
      id: "road-route-lines",
      type: "line",
      source: "road-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 7.2,
        "line-opacity": 0.98,
      },
    });
    map.addLayer({
      id: "road-route-arrows",
      type: "symbol",
      source: "road-routes",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 70,
        "text-field": "▶",
        "text-size": 12,
        "text-allow-overlap": true,
        "text-keep-upright": false,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "#fff",
        "text-halo-width": 1.5,
      },
    });
    map.addLayer({
      id: "route-arrows",
      type: "symbol",
      source: "routes",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 54,
        "text-field": "▶",
        "text-size": 11,
        "text-allow-overlap": true,
        "text-keep-upright": false,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "#fff",
        "text-halo-width": 1.2,
      },
    });
    map.addLayer({
      id: "route-labels",
      type: "symbol",
      source: "routes",
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["get", "routeLabel"],
        "text-size": 15,
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "visibility": "visible",
      },
      paint: {
        "text-color": "#003b79",
        "text-halo-color": "#fff",
        "text-halo-width": 3,
        "text-opacity": 0.98,
      },
    });
    map.addLayer({
      id: "segment-distance-labels",
      type: "symbol",
      source: "segment-labels",
      layout: {
        "text-field": ["get", "segmentLabel"],
        "text-size": 11,
        "text-font": ["Open Sans Bold"],
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "visibility": "none",
      },
      paint: {
        "text-color": "#7c2d12",
        "text-halo-color": "#fff7ed",
        "text-halo-width": 2.4,
        "text-opacity": 0.96,
      },
    });
    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "stops",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#2563eb",
        "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 50, 23],
        "circle-opacity": 0.94,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2.5,
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "stops",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
        "text-font": ["Open Sans Bold"],
      },
      paint: {
        "text-color": "#fff",
        "text-halo-color": "#1d4ed8",
        "text-halo-width": 0.5,
      },
    });
    map.addLayer({
      id: "stop-points",
      type: "circle",
      source: "stops",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "count"],
          0,
          5.5,
          20,
          7.5,
          100,
          10,
        ],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2.2,
        "circle-opacity": 0.94,
      },
    });
    map.addLayer({
      id: "stop-labels",
      type: "symbol",
      source: "heat-stops",
      layout: {
        "text-field": ["get", "labelText"],
        "text-size": 12,
        "text-offset": [0, 1.35],
        "text-font": ["Open Sans Regular"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "visibility": "none",
      },
      paint: {
        "text-color": "#0f172a",
        "text-halo-color": "#fff",
        "text-halo-width": 2.6,
        "text-opacity": 0.98,
      },
    });
    map.addLayer({
      id: "depot-halo",
      type: "circle",
      source: "depot",
      paint: {
        "circle-color": "#00a3e0",
        "circle-radius": 28,
        "circle-opacity": 0.24,
        "circle-stroke-color": "#003b79",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "depot-point",
      type: "circle",
      source: "depot",
      paint: {
        "circle-color": "#001f45",
        "circle-radius": 18,
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 5,
        "circle-opacity": 0.96,
      },
    });
    const depotEl = document.createElement("div");
    depotEl.className = "depot-marker";
    depotEl.innerHTML = "";
    depotEl.title = "Depot";
    depotMarker = new maplibregl.Marker({
      element: depotEl,
      anchor: "center",
      offset: [0, 0],
    }).setLngLat([DATA.depot.lon, DATA.depot.lat]).addTo(map);
    map.addLayer({
      id: "depot-label",
      type: "symbol",
      source: "depot",
      layout: {
        "text-field": "DEPOT",
        "text-offset": [0, 2.1],
        "text-size": 12,
        "text-font": ["Open Sans Bold"],
      },
      paint: {
        "text-color": "#003b79",
        "text-halo-color": "#fff",
        "text-halo-width": 2.5,
        "text-opacity": 0,
      },
    });
    map.on("click", "route-lines", (e) => {
      const p = e.features[0].properties;
      lockRoute(p.routeId);
      new maplibregl.Popup().setLngLat(e.lngLat).setHTML(
        '<div class="popup-title">' + escapeHTML(p.routeId) +
          '</div><div class="popup-line">车辆 ' + escapeHTML(p.vehicleId) + " · " +
          fmt(p.stops) + ' Stops</div><div class="popup-line">' + escapeHTML(p.km) +
          " km · 回库 " + escapeHTML(p.end) + "</div>",
      ).addTo(map);
    });
    map.on("click", "stop-points", (e) => {
      const p = e.features[0].properties;
      showStopDetail(p);
      new maplibregl.Popup().setLngLat(e.lngLat).setHTML(
        '<div class="popup-title">' + escapeHTML(p.name || p.code || "配送点") +
          '</div><div class="popup-line">路线 ' + escapeHTML(p.routeId) + " · 到达 " +
          escapeHTML(p.arrive) + '</div><div class="popup-line">Packages ' + fmt(p.count) +
          " · 容量 " + fmt(p.volume) + "</div>",
      ).addTo(map);
    });
    map.on(
      "mouseenter",
      "route-lines",
      () => map.getCanvas().style.cursor = "pointer",
    );
    map.on(
      "mouseleave",
      "route-lines",
      () => map.getCanvas().style.cursor = "",
    );
    map.on(
      "mouseenter",
      "stop-points",
      () => map.getCanvas().style.cursor = "pointer",
    );
    map.on(
      "mouseleave",
      "stop-points",
      () => map.getCanvas().style.cursor = "",
    );
  }
  map.on("load", () => {
    addFlowMapLayers();
    refreshMap();
  });
} else {
  const mapEl = document.getElementById("map");
  if (mapEl) {
    const fallback = document.createElement("div");
    fallback.id = "mapFallback";
    fallback.className = "map-fallback";
    fallback.textContent = forceNoWebGL || (hasMapLibre && mapInitError)
      ? "当前浏览器无法使用 WebGL，交互地图未启动；路线、分析和碳排数据仍可正常查看。"
      : "地图组件未加载；请检查本地静态资源，路线、分析和碳排数据仍可正常查看。";
    mapEl.replaceChildren(fallback);
  }
}
dateFilter.addEventListener("change", (e) => {
  state.date = e.target.value;
  state.route = "ALL";
  state.vehicle = "ALL";
  updateControls();
  refreshMap();
});
routeFilter.addEventListener("change", (e) => {
  if (e.target.value === "ALL") {
    unlockRoutes();
    closeRouteFilter();
  } else {
    lockRoute(e.target.value);
    closeRouteFilter();
  }
});
vehicleFilter.addEventListener("change", (e) => {
  state.vehicle = e.target.value;
  refreshMap();
});
document.getElementById("searchInput").addEventListener("input", (e) => {
  state.search = e.target.value.trim();
  refreshMap();
});
routeList.addEventListener("change", (e) => {
  if (e.target.matches("input[data-route]")) {
    const id = e.target.dataset.route;
    if (e.target.checked) {
      lockRoute(id);
      closeRouteFilter();
    } else {
      state.checkedRoutes.delete(id);
      if (state.route === id) {
        state.route = "ALL";
        routeFilter.value = "ALL";
      }
      refreshMap();
      syncRouteChecks();
    }
  }
});
routeList.addEventListener("click", (e) => {
  const row = e.target.closest(".route-row");
  if (!row || e.target.matches("input")) return;
  const id = row.dataset.routeId;
  if (id) {
    lockRoute(id);
    closeRouteFilter();
  }
});
document.getElementById("clearBtn").addEventListener("click", () => {
  state.route = "ALL";
  state.vehicle = "ALL";
  state.search = "";
  document.getElementById("searchInput").value = "";
  updateControls();
  unlockRoutes();
});
document.getElementById("missingToggle").addEventListener(
  "change",
  (e) =>
    alert(
      e.target.checked
        ? "缺坐标停靠点已记录在异常数据中；没有经纬度时无法绘制在地图上。"
        : "已隐藏缺坐标提示。",
    ),
);
document.getElementById("splitToggle").addEventListener(
  "change",
  (e) =>
    alert("拆分装载已计入对应路线批次；货物级明细请看计划表 Exceptions 页。"),
);
document.getElementById("mapThemeSelect")?.addEventListener(
  "change",
  (e) => {legacyMapThemeOverride=true;changeMapTheme(e.target.value);},
);
document.getElementById("mapPresetSelect")?.addEventListener(
  "change",
  (e) => applyMapPreset(e.target.value),
);
document.getElementById("routeWidthRange")?.addEventListener("input", (e) => {
  state.routeWidth = Number(e.target.value) || 4;
  syncMapOptionControls();
  applyMapVisuals();
});
[
  ["depotLabelToggle", "depot"],
  ["routeLabelToggle", "route"],
  ["deliveryLineToggle", "deliveryLine"],
  ["stopLabelToggle", "stop"],
  ["timeLabelToggle", "time"],
  ["segmentDistanceToggle", "segmentDistance"],
].forEach(([id, key]) =>
  document.getElementById(id)?.addEventListener("change", (e) => {
    state.labels[key] = e.target.checked;
    syncMapOptionControls();
    if (map && map.loaded && map.loaded()) {
      if (map.getSource("stops")) {
        map.getSource("stops").setData(selectedStopFeatures());
      }
      if (map.getSource("heat-stops")) {
        map.getSource("heat-stops").setData(selectedStopFeatures());
      }
      if (map.getSource("segment-labels")) {
        map.getSource("segment-labels").setData(selectedSegmentFeatures());
      }
      applyMapVisuals();
      setTimeout(() => applyMapVisuals(), 120);
    }
  })
);
syncMapOptionControls();
window.addEventListener("load", () => {
  try {
    if (!window.STCT_V8_PLATFORM_ENTRY) {
      updateControls();
      updateMetrics();
      syncDashboardControls();
      renderAllDashboards();
      refreshMap();
    }
    if (window.__AUTH_OK) {
      window.__loginNow &&
        setTimeout(
          () => document.getElementById("loginScreen").style.display = "none",
          0,
        );
    }
  } catch (err) {
    console.error(err);
  }
});
try {
  Object.assign(window, {
    buildOptimizedPlan,
    buildOptimizedPlanWithEngine,
    applyUploadedData,
    loadRawData,
    parseExcelFile,
    parseUploadedText,
    switchView,
    renderOverview,
    renderOptimizer,
    renderAnalysis,
    renderCarbon,
    renderExceptions,
    renderUpload,
    renderAllDashboards,
    optimizerSourceOrders,
    optimizerVehicles,
    utilNum,
    fmt,
  });
} catch (err) {
  console.warn("STCT export skipped", err);
}

window.STCTCore = {
  getData: () => DATA,
  getRawData: () => RAW_DATA,
  getOriginalData: () => ORIGINAL_DATA,
  getTransportDataState: () => ({ applied: transportDataApplied, rawReady: !!RAW_DATA, source: dataSource }),
  getLanguage: () => currentLang,
  getOptimizerPlan: () => optimizerPlan,
  getMap: () => map,
  getUiState: () => state,
  setOptimizerPlan: (plan) => {
    optimizerPlan = plan;
    dataStatus = plan ? "候选方案已生成" : "待生成方案";
    dataSource = plan?.meta?.source || dataSource;
    window.STCTMap?.previewPlan?.(plan || null);
    renderRouteOptimizerStatus();
  },
  applyPlan: applyUploadedData,
  loadRawData,
  parseExcelFile,
  parseUploadedText,
  optimizerSourceOrders,
  optimizerVehicles,
  switchView,
  refreshMap,
  renderRouteOptimizerStatus,
  installRenderers: (adapters) => {
    if (typeof adapters?.renderOptimizer === "function") {
      renderOptimizer = adapters.renderOptimizer;
    }
    if (typeof adapters?.renderAnalysis === "function") {
      renderAnalysis = adapters.renderAnalysis;
    }
    if (typeof adapters?.renderCarbon === "function") {
      renderCarbon = adapters.renderCarbon;
    }
    if (typeof adapters?.renderUpload === "function") {
      renderUpload = adapters.renderUpload;
    }
    if (typeof adapters?.renderAllDashboards === "function") {
      renderAllDashboards = adapters.renderAllDashboards;
    }
    Object.assign(window, adapters || {});
  },
};
