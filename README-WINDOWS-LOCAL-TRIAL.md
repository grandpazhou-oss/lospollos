# STCT Windows 单机受控试用入口

本入口供单台 Windows 电脑在本机浏览器试用，**尚未在 Windows 实机验收，也不是生产部署**。现有 macOS `start_demo.sh`、`stop_demo.sh` 和默认端口没有改动。本入口默认使用 `127.0.0.1:8865`（页面）与 `127.0.0.1:8887`（求解），不切换受保护的 8787。

## 启动与停止

在 Windows 电脑上保留完整项目目录，使用装有根目录 `requirements-demo.txt` 中 OR-Tools 的 Python 3。脚本不会自动安装依赖。双击 `start_windows.cmd`，或在命令提示符运行：

```bat
start_windows.cmd
```

如有多个 Python，先指定实际装有依赖的解释器：

```bat
set "STCT_PYTHON=C:\Path\To\python.exe"
start_windows.cmd
```

启动脚本会检查端口、页面和原生求解服务；只有两者都就绪才报告成功。默认页面是 `http://127.0.0.1:8865/index.html?optPort=8887#/`。更换隔离端口可运行 `start_windows.cmd --web-port 9865 --opt-port 9887`。停止时运行 `stop_windows.cmd`；停止脚本核对本入口记录的进程身份和创建时间，身份不符会拒绝结束进程。不要用它停止其他 STCT 实例。命令窗口中的 `pause` 可通过设置 `STCT_NO_PAUSE=1` 关闭。

运行记录和日志默认写入 `%LOCALAPPDATA%\STCT\local-trial`；可用 `STCT_RUN_DIR` 指向专用目录。启动失败时检查该目录中的 `web.log` 和 `optimizer.log`。如果求解服务未就绪，入口会关闭自己刚启动的进程并报告失败；网页的演示降级不等于原生供应链求解已就绪。

## 从 Mac 转移研究

研究保存在浏览器配置文件及其访问来源对应的 IndexedDB 中。先在 Mac 的“情景库”导出所需研究包，再在 Windows 的“情景库”通过页面控件导入，核对研究身份、结果与过期状态后重新打开。不要直接复制浏览器的 IndexedDB 目录。研究包可能含真实业务资料，只在获准设备和渠道中转移；原始 UC 工作簿不用放进程序目录。

改变页面端口也会改变浏览器存储来源；重新选用旧端口不会自动把另一台电脑的研究带过来。保存失败时当前研究仍留在页面，可从“情景库”导出未保存草稿，再处理磁盘或浏览器配额问题。

## 实机验收清单

Windows 上尚需用真实机器和目标浏览器完成以下检查，未执行前不能写 PASS：

1. 启动、重复启动、占用端口拒绝、停止和重启；核对只结束本入口的进程，求解作业取消与超时没有残留 Worker。
2. 从首页完成 Demo → Facility → 非 UC 供应链研究；再用获准的 UC 副本完成全链 C→C4，检查原生求解、独立校验、保存、刷新回读和 HTML/CSV/JSON 导出。
3. 验证中文路径、Excel 导入、打印、390px 显示、离线地图提示及无 WebGL 视图。地图底图仍依赖在线瓦片；浏览器图形加速策略可能影响 WebGL。
4. Mac 上重跑相同的关键链路和原有启停脚本，确认 Windows 增量没有改变结果语义或破坏旧入口。

本地演示登录不是生产身份认证。真人观察仍为 `NOT_RUN`，正式 v1.8 Soak 仍为 `DEFERRED_BY_USER`，8787 保持 `ACTIVATION_PENDING`。

## 2026-10-03 企业加固候选

本轮独立副本的启动和原始服务保护说明见 `README-ENTERPRISE-CANDIDATE.md`。请使用 HTTP 启动入口，不以 file:// 页面连接求解服务。Windows 实机与本地 OSRM 仍待在目标环境验收。
