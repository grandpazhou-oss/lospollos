#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputPath = process.argv[2] || path.join(root, "assets", "demo", "stct-synthetic-demo.json");
const seed = 140031;
let state = seed >>> 0;

function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
}

function coordinate(index, dateIndex) {
  const ring = 0.016 + (index % 5) * 0.006;
  const angle = (index * 137.508 + dateIndex * 19 + random() * 8) * Math.PI / 180;
  return {
    lon: Number((121.3600 + Math.cos(angle) * ring).toFixed(6)),
    lat: Number((31.1800 + Math.sin(angle) * ring).toFixed(6)),
  };
}

const dates = [
  { date: "2026-09-01", count: 10, volumes: [3, 3, 3, 1, 3, 3, 3, 1, 3, 3] },
  { date: "2026-09-02", count: 14, volumes: Array(14).fill(3.5) },
  { date: "2026-09-03", count: 12, volumes: Array(12).fill(3) },
];
const priorities = ["high", "medium", "normal"];
const orders = [];

dates.forEach((day, dateIndex) => {
  for (let index = 0; index < day.count; index += 1) {
    const seq = index + 1;
    const coord = coordinate(index, dateIndex);
    orders.push({
      id: `DEMO-${day.date.replaceAll("-", "")}-${String(seq).padStart(3, "0")}`,
      code: `DEMO-STORE-${String(dateIndex * 20 + seq).padStart(3, "0")}`,
      name: `演示配送点 ${String.fromCharCode(65 + dateIndex)}-${String(seq).padStart(2, "0")}`,
      address: `演示区域 ${String.fromCharCode(65 + dateIndex)}-${String(seq).padStart(3, "0")}（非真实地址）`,
      date: day.date,
      lon: coord.lon,
      lat: coord.lat,
      count: 10 + (index % 4) * 5,
      volume: day.volumes[index],
      weight: 0,
      serviceMin: 8,
      twStart: dateIndex === 1 ? "08:00" : index % 4 === 0 ? "08:00" : index % 4 === 1 ? "09:00" : "10:00",
      twEnd: dateIndex === 1 ? "17:00" : index % 4 === 0 ? "13:00" : index % 4 === 1 ? "15:00" : "17:00",
      priority: priorities[index % priorities.length],
      orderType: "synthetic-demo",
      requiredVehicleType: "",
    });
  }
});

const vehicles = [
  { id: "DEMO-VEH-01", vehicleId: "DEMO-VEH-01", name: "演示车辆 01", vehicleName: "演示车辆 01", type: "demo-van", maxVolume: 10, maxWeight: 1000, start: "08:00", end: "18:00", fixedCost: 80, perKmCost: 4.2, perMinuteCost: 0.3, perStopCost: 6, emissionFactor: 0.18, enabled: true },
  { id: "DEMO-VEH-02", vehicleId: "DEMO-VEH-02", name: "演示车辆 02", vehicleName: "演示车辆 02", type: "demo-van", maxVolume: 10, maxWeight: 1000, start: "08:00", end: "18:00", fixedCost: 90, perKmCost: 4.0, perMinuteCost: 0.3, perStopCost: 6, emissionFactor: 0.17, enabled: true },
  { id: "DEMO-VEH-03", vehicleId: "DEMO-VEH-03", name: "演示车辆 03", vehicleName: "演示车辆 03", type: "demo-van", maxVolume: 10, maxWeight: 1000, start: "08:00", end: "18:00", fixedCost: 85, perKmCost: 4.5, perMinuteCost: 0.28, perStopCost: 6, emissionFactor: 0.20, enabled: true },
  { id: "DEMO-VEH-04", vehicleId: "DEMO-VEH-04", name: "演示车辆 04", vehicleName: "演示车辆 04", type: "demo-van", maxVolume: 10, maxWeight: 1000, start: "08:00", end: "18:00", fixedCost: 95, perKmCost: 4.1, perMinuteCost: 0.32, perStopCost: 6, emissionFactor: 0.15, enabled: true },
];

const payload = {
  meta: {
    id: "STCT-SYNTHETIC-DEMO-V14",
    label: "STCT v1.4 完全合成演示数据",
    synthetic: true,
    seed,
    generator: "scripts/build_demo_data_v14.js",
    notice: "所有名称、地址、标识和坐标均为确定性合成，仅用于本地功能测试。",
  },
  depot: {
    id: "DEMO-DEPOT-01",
    code: "DEMO-DEPOT-01",
    name: "演示配送中心",
    address: "演示区域中心（非真实地址）",
    addr: "演示区域中心（非真实地址）",
    lon: 121.36,
    lat: 31.18,
  },
  vehicles,
  orders,
  constraints: {
    workStart: "08:00",
    workEnd: "18:00",
    maxWaitingMinutes: 90,
    maxStops: 20,
    maxRouteMinutes: 600,
    roadDistanceFactor: 1.35,
    averageSpeedKmh: 28,
    defaultServiceMinutes: 8,
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
