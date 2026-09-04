#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const outputDir = path.join(__dirname, "fixtures");
fs.mkdirSync(outputDir, { recursive: true });
for (const count of [60, 120, 240]) {
  const orders = Array.from({ length: count }, (_, index) => ({
    id: `SD${count}-${String(index + 1).padStart(4, "0")}`,
    date: "2026-06-01",
    lon: Number((121.30 + (index % 20) * 0.002).toFixed(7)),
    lat: Number((31.10 + Math.floor(index / 20) * 0.002).toFixed(7)),
    count: 1,
    volume: 0.1,
    weight: 1,
    serviceMin: 2,
    twStart: "09:00",
    twEnd: "17:30",
    priority: index % 10 === 0 ? "high" : index % 4 === 0 ? "medium" : "normal",
  }));
  fs.writeFileSync(path.join(outputDir, `single-day-${count}.json`), `${JSON.stringify({ fixtureVersion: "v1.3", planningDate: "2026-06-01", orders }, null, 2)}\n`);
}
