# OR-Tools 优化服务

当前稳定目录：`/Users/gz/Documents/lospollos`

## 启动页面

```bash
cd /Users/gz/Documents/lospollos
python3 -m http.server 8765
```

页面地址：

```text
http://127.0.0.1:8765/index.html
```

## 启动 OR-Tools

```bash
python3 /Users/gz/Documents/lospollos/optimizer/ortools_service.py
```

服务地址：

```text
http://127.0.0.1:8787
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

正常返回应包含：

```json
{"ok": true, "engine": "OR-Tools"}
```

## 当前规则

- Raw Data 排车优先调用 OR-Tools。
- OR-Tools 模式下，所有订单必须配送，不允许静默丢单。
- 支持跨日时间窗，例如 `18:00` 到 `02:00` 会被识别为次日 02:00。
- 支持经纬度反写自动纠偏，例如天津数据中 `经度 39.x / 纬度 117.x` 会自动交换。
- 如果 OR-Tools 服务未启动，前端会回退到演示算法，并显示回退原因。
