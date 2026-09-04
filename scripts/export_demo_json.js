#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const XLSX = require("../vendor/xlsx/xlsx.full.min.js");

const root = path.resolve(__dirname, "..");
const source = process.argv[2] || path.join(root, "templates", "laiyifen-202605-rawdata.xlsx");
const destination = process.argv[3] || path.join(root, "data", "laiyifen-demo-raw.json");
const workbook = XLSX.read(fs.readFileSync(source), { type: "buffer" });
const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" });
const orders = rows("Orders").map((row) => ({
  id: String(row["订单号"]), code: String(row["客户代码"]), name: row["配送点名称"], address: row["地址"],
  date: String(row["配送日"]), lat: row["纬度"], lon: row["经度"], count: row["件数"], weight: row["重量"], volume: row["体积"],
  twStart: row["时间窗开始"], twEnd: row["时间窗结束"], serviceMin: row["服务时间"], priority: row["优先级"], orderType: row["订单类型"],
}));
const vehicles = rows("Vehicles").map((row) => ({
  id: String(row["车辆ID"]), vehicleId: String(row["车辆ID"]), name: row["车辆名称"], type: row["车型"],
  maxWeight: row["最大载重"], maxVolume: row["最大容积"], start: row["可用开始"], end: row["可用结束"],
  availableDate: row["可用日期"], enabled: true,
}));
const depotRow = rows("Depots")[0];
const constraintsRows = rows("Constraints");
const constraints = Object.fromEntries(constraintsRows.map((row) => [String(row["参数"] || row.parameter || ""), row["值"] ?? row.value]).filter(([key]) => key));
const payload = {
  __rawUpload: true,
  raw: {
    orders,
    vehicles,
    depot: { id: String(depotRow["仓库ID"]), name: depotRow["仓库名称"], address: depotRow["地址"], lat: depotRow["纬度"], lon: depotRow["经度"] },
    constraints: { workStart: "09:00", workEnd: "17:30", maxWaitingMinutes: 90, maxStops: 500, maxRouteMinutes: 1440, ...constraints },
  },
};
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(payload)}\n`);
