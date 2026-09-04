# OR-Tools 本地优化服务

推荐使用仓库根目录的 `start_demo.sh` 与 `stop_demo.sh`，脚本不依赖当前工作目录。

## 可选依赖

```bash
python3 -m pip install -r requirements-demo.txt
```

本轮不会自动安装依赖。本机已验证版本为 `ortools==9.15.6755`、Python 3.9.6；精确 pin 见根目录 `requirements-demo.txt`。未安装 OR-Tools 时，Web 页面仍可运行，并明确使用 `Demo Heuristic`。

## 单独启动

```bash
OPT_PORT=8787 python3 optimizer/ortools_service.py
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

接口将分别返回：

- `ok`：本地 HTTP 服务是否在线。
- `available`：OR-Tools 求解器是否可用。
- `engine`：`OR-Tools` 或 `Demo Heuristic`。
- `maxSolveSeconds`、`maxOrders`：当前本地演示上限。

v1.3 请求必须携带 Canonical Scenario 以及客户端声明的 `contentHash`、`inputHash` 和 `requestHash`。服务端使用 `optimizer/canonical_contract.py` 独立规范化并重算，任何不一致返回 HTTP 400。响应包含服务端 hash、`planHash`、实际 OR-Tools 版本、求解状态与 proven Big-M 上界；浏览器仍须由 `verifier.js` 独立复算并 PASS 后才能应用。

可用环境变量：`OPT_PORT`、`MAX_SOLVE_SECONDS`、`MAX_OPTIMIZER_ORDERS`、`DISABLE_ORTOOLS`。

## 计算假设

- 支持 `18:00` 到 `02:00` 这类跨日时间窗。
- 行驶距离为 Haversine 直线距离乘以请求中的道路折算系数；默认系数由前端 `config.js` 提供。
- 体积和重量均按 contract 的 1000 scale、half-up 规则进入硬约束；输入契约要求车辆两类容量为正，订单需求可为 0。
- 订单处理遵守守恒：输入订单必须进入已分配、未分配或阻断之一，不能因坐标问题静默丢失。
- 订单未分配与阻断项包含稳定 `reasonCode`、置信度和建议动作；确定性预检与求解器推断明确区分。
- 服务水平按优先级权重与已分配订单数优先，再比较距离、车辆、成本、碳排、利用率或 balanced search seed；UI 的 balanced pool score 是当前最佳服务候选池内的相对评分，二者明确分开。
- 服务只用于本地 Demo，不代表真实道路导航、生产调度或生产部署。
