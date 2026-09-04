#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "main.js"), "utf8");
const keys = [
  "日期模式", "单日规划", "跨日汇总（按配送日独立规划）", "新增车辆模板",
  "插入方式", "路线末尾", "指定停靠点之后", "自动最小增量位置",
  "场景级原因", "确定", "可能", "未知", "原始优先级会进入 Canonical Scenario、inputHash 与 OR-Tools 服务层级。",
];
for (const key of keys) {
  const occurrences = source.split(`\"${key}\"`).length - 1;
  assert(occurrences >= 2, `${key} is missing an English or Japanese mapping`);
}
assert(source.includes("Multi-day Summary"));
assert(source.includes("複数日サマリー"));
assert(source.includes("Automatic Minimum-increment Position"));
assert(source.includes("自動最小増分位置"));
process.stdout.write(`${JSON.stringify({ status: "PASS", keys: keys.length, languages: ["zh", "en", "ja"] }, null, 2)}\n`);
