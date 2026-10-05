# STCT 企业单机加固候选 · 20261003_161313

主入口是 index.html#/，不是旧配送页。保留三范围、原生求解、独立复核、草稿、过期保护、地图与报告。当前为受控内部试用候选，Windows 实机、真实 OSRM、真人观察及独立安全补丁复核仍待验；不表示生产上线。

## Mac 与 Windows 的隔离启动

在本目录执行（Mac 用已验证的 python3；Windows 用已具备所需依赖的 Python）：

```text
python3 scripts/local_trial.py start --web-port 9956 --opt-port 9958 --open
python3 scripts/local_trial.py stop
```

Windows 将 python3 换为已有 Python 的命令或完整路径。端口冲突时启动器应拒绝；不要停止其他服务，也不要将此候选切到受保护 8787。正常访问 http://127.0.0.1:9956/index.html?optPort=9958#/ 。通过界面研究包迁移数据，不搬浏览器 IndexedDB 文件夹。没有 Python/OR-Tools 等现有依赖时先记录阻断，本包不会自动安装。

## 数据与旧工具边界

公开 HTTP 文件由 public-resources.json 精确列举；脚本路径、原工作簿、私有研究、生成数据、运行日志和目录列表不属于公开静态资源。映射、单位、来源和计算假设仍按各业务域维护；新增共享预算不会把 UC 月度需求当派车订单。

保留旧配送工具须单独执行 python3 backend/server.py 8765，默认绑定 127.0.0.1。旧页面从 /api/legacy-route-data 获取本机结果，导出通过 /api/legacy-export；不公开 backend/route_data.js 等磁盘文件。旧 CLI 生成的文件可以继续作为只读兼容来源；上传新结果以一个原子私有结果包提交，失败保持旧结果。该工具和现有演示登录都不是生产身份认证；本机用户或进程仍可能调用业务 API。

backend/build_dashboard.py 使用既有 vendor 与旧页面嵌入的 Chart.js，支持 Mac/Windows 路径；请保留 dispatch.html。旧模板已与现有页面业务功能同步，重新生成不再丢掉异常/车辆页面。

## 身份、交付和回退

BUILD_IDENTITY.md 定义五文件求解契约指纹；交付 MANIFEST 单独覆盖完整源码与证据，不宣称五文件指纹等于全应用哈希。原运行版本仍在独立目录，本轮不覆盖、不切换它。使用启动器记录的进程身份停止本候选，再打开原入口即可回退。

UC 研究、报告和含真实业务标识的证据仅供授权内部验收，不能公开发布。原始 UC 工作簿未包含在交付中；依赖、缓存、密钥和既有未授权业务原表排除。详细门槛和未执行项见交付 00_READOUT.md 与 TEST_MATRIX。
