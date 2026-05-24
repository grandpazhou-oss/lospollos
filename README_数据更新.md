# 数据更新说明

当前页面不再把运输历史数据直接嵌入 HTML，而是读取外部数据文件：

- 页面文件：`index.html`
- 数据文件：`data/routes-data.js`

以后更新运输数据时，只需要重新生成并替换 `data/routes-data.js`，然后刷新页面即可。

## 数据文件格式

`routes-data.js` 需要定义：

```js
window.FLOWMAP_DATA = { ... };
```

对象内包含这些主要字段：

- `depot`：仓库经纬度
- `routes`：路线汇总
- `daySummaries`：每日汇总
- `routeGeoJson`：路线 LineString 图层数据
- `stopGeoJson`：配送点 Point 图层数据
- `missingStops`：缺坐标记录
- `splitRows`：拆分装载记录

## 推荐更新流程

1. 用新的 Excel / CSV 重新计算配送计划。
2. 生成新的 `window.FLOWMAP_DATA = ...;` 文件。
3. 覆盖 `data/routes-data.js`。
4. 刷新 `index.html`。

注意：如果直接用浏览器打开 `file://.../index.html`，推荐继续使用 `.js` 数据文件方式；纯 `.json` 文件在部分浏览器会因为本地安全策略无法读取。
