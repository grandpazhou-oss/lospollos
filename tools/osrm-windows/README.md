# Windows 本地 OSRM 准备包（候选版）

此目录可单独复制到 Windows。STCT 主项目无需安装 Docker 即可继续在 Mac/Windows 上运行。
本包只准备道路矩阵；不修改排车求解器，不改变 8787/8791/8877，不调用公共路由服务。

## 已验证与未验证

- 已核对官方 GHCR 镜像 `26.7.3-debian` 的 manifest，含 Linux amd64/arm64；使用 image-manifest.json 中 SHA-256 摘要锁定，不依赖 latest。
- 已在 Mac 执行 Python 标准库契约测试；包含有向非对称距离、单位、不可达、贴路距离、未知坐标系、分批、端口与容器归属保护。
- Windows CMD、Docker 真正运行、中国路网预处理、实际道路距离与机器资源峰值：**NOT_RUN**。本机没有 Docker，且无可访问 Windows 实机。
- 不把测试模拟响应当成真实路网计算证据。

## 1. Windows 准备

1. 按 [Docker 官方 Windows 文档](https://docs.docker.com/desktop/setup/install/windows-install/) 安装符合要求的 Docker Desktop，启用 WSL 2 / Linux containers。企业使用资格以官方条款为准。
2. 安装或使用现有 Python 3.10+；CMD 中 `py -3 --version` 应成功。不安装任何 pip/npm 依赖。
3. 在 PowerShell 或 CMD 打开此目录，先运行 `osrm.cmd doctor`。它只检查，不安装、不修改配置。
4. 准备足够的 SSD 空间与 Docker 内存。全国 PBF 压缩体积不代表解压、图预处理和运行内存；先用小区域试跑并记录 Docker 实际峰值。若机器资源不足，记录阻断，不通过降低数据范围假装全国覆盖成功。

## 2. 获取路网文件（用户操作，不下载业务资料）

可手动下载，也可以运行下面的校验下载命令（仅下载公共路网；此交付没有在 Mac 上下载全国 PBF）：

```bat
osrm.cmd download --download-to "D:\OSM\china-20260929-download.osm.pbf"
```

此命令校验发布者 MD5，并记录自己的 SHA-256、URL、HTTP Last-Modified 和下载时间；失败保留 `.partial`，不会作为有效路网使用。文件名中的日期只是你的命名，仍须核对实际数据时间。可用 `--url` 指定 Geofabrik 有日期的亚洲区域文件。

从 [Geofabrik 中国页面](https://download.geofabrik.de/asia/china.html) 下载有明确时间的 `.osm.pbf`，记录页面上的数据时间；核对发布者校验文件。
如使用 `china-latest.osm.pbf`，保留实际下载时间、页面上的数据时间和 SHA-256，不能只写 latest。

PowerShell 例：

```powershell
Get-FileHash 'D:\OSM\china-YYMMDD.osm.pbf' -Algorithm SHA256
```

跨省运输优先用中国连续路网。不能将几个孤立省份文件拼成“全国可达”；小区域试跑仅证明该范围。
原 PBF 保留不动。准备脚本将它复制到新目录。不要将 PBF 放进 Git 或项目审查 ZIP。

## 3. 预处理

以下路径、日期、哈希请替换成你的文件信息。日期是示例占位，不是本包已下载的数据。

```bat
osrm.cmd prepare --pbf "D:\OSM\china-YYMMDD.osm.pbf" --data "D:\STCT-OSRM\china-run-01" --dataset-date "2026-09-29" --threads 4 --pbf-sha256 "实际的64位SHA256"
```

按顺序运行 extract → partition → customize（MLD）。每步日志与状态位于 `--data` 目录。
默认每步上限 6 小时；可用 `--stage-timeout 秒` 明确调整。Ctrl+C 取消时仅停止此工具启动且归属校验通过的容器。
失败目录保留供排查；重试使用新目录，不覆盖半成品或原文件。
**脚本不会自动删除任何既有容器或目录，也不会调整 Docker 资源。**

## 4. 启停

```bat
osrm.cmd start --data "D:\STCT-OSRM\china-run-01" --port 5001
osrm.cmd status --data "D:\STCT-OSRM\china-run-01"
osrm.cmd stop --data "D:\STCT-OSRM\china-run-01"
```

只发布 `127.0.0.1:5001`，其他电脑不能访问。不在本轮开放公网、防火墙或远程路由端点。
端口被占用则停止并报告；不杀占用进程。`start` 会检查图文件 SHA-256，全国图检查需要时间。
没有配置系统开机启动；Docker/电脑重启后再次 start。
启动输出不是就绪证明；以 status 和下面的矩阵请求为准。

## 5. STCT 研究 → 道路矩阵 → 重算

1. 在原 STCT 供应链设计页面，通过业务控件导入和确认映射，保存研究，下载原生研究包或草稿包。无需编写 JSON。
2. **先确认坐标系**。WGS84 可直接使用；已标明 GCJ-02/BD-09 的坐标会被拒绝，不会改名为 WGS84。
3. 对未知坐标系，优先核实来源。仅在你明确承担该假设时加 `--assume-wgs84`；这不是转换，假设节点 ID 会保存在审计文件。
4. 运行：

```bat
matrix.cmd --study "D:\Studies\study-package.json" --data "D:\STCT-OSRM\china-run-01" --scope joint --out "D:\Studies\roads-run-01"
```

`--scope outbound` 只测仓→需求点；`upstream` 测供应商→仓；`joint` 同时测两端。
启用直送或中转的研究分别加 `--direct` 或 `--transfer`。不会将历史未知来源虚构为一个坐标。
同址业务节点保留独立 ID；去重的是距离请求对，不是物量或月度记录。
默认总预算 600 秒、每批最多 100 个坐标、最多 50000 个有向对。可用 `--budget` 设置时间预算。
默认允许贴路距离 ≤1000 米，这只是质检阈值，不是正确性担保；必要时用 `--max-snap-m` 收紧。

5. 只有全部请求对通过才产生 `matrix.csv`。否则产生 `audit.json` 与 `partial-rows.json`，退出码 2；没有可冒充完整矩阵的 CSV。修复坐标、路网或范围后换新输出目录重试。
6. 在供应链设计的“补充测算依据 / 距离矩阵”控件导入 `matrix.csv`，预览并确认，选择“估算道路”口径，重新分析。输入变化会沿用既有过期保护。
7. 保留 `audit.json` 随研究附件一起审查。CSV 的数据时间和策略会进入研究距离行。相同口径重新计算现状和候选，不拿旧地理结果直接与道路结果计算改善率。

原生包只在本机读取；送到 OSRM 的仅为坐标。工具核对运行容器的归属和端口；禁止重定向、系统代理和公网 endpoint。

## 6. 必须知道的解释边界

- OSRM Table 返回路由策略选中路径的距离/时间（默认汽车策略侧重行驶时间），不是几何直线，也不必然是最短里程路径。
- m→km、s 保留；双向分别计算。不使用 fallback_speed 或默认道路放大系数填补失败。
- 输出固定为 `ESTIMATED_ROAD`。全国路网、默认 car.lua 不构成货车高度/重量/时段限行、实时交通、收费、SLA 或真实 GPS 核验。
- 不生成运价、车辆或库存资料。更可信的道路数据会改变候选排序，不能保证重现地理筛选结论。
- 距离矩阵不会自动给现有关系地图增加逐段道路折线；本包未开发路线几何绘制。
- [OSRM 官方部署说明](https://github.com/Project-OSRM/osrm-backend)；[OSRM API](https://project-osrm.org/docs/v5.24.0/api/)；[OpenStreetMap 署名与 ODbL](https://www.openstreetmap.org/copyright)。报告引用道路数据时保留 © OpenStreetMap contributors 及来源时间。

## Windows 实测记录（待填写）

| 项目 | 结果 |
|---|---|
| Windows / WSL / Docker / Python 版本 | NOT_RUN |
| CPU / RAM / Docker 分配 / SSD 可用 | NOT_RUN |
| PBF 文件、数据时间、SHA-256 | NOT_RUN |
| extract / partition / customize 时间与峰值 | NOT_RUN |
| 冷启动 / 10 对 / 全研究矩阵时间 | NOT_RUN |
| 抽样道路与业务人员核对 | NOT_RUN |
| 双向 / 不可达 / 重启 / 停止归属 | NOT_RUN |

本目录无真实客户数据、路网大文件、密钥或依赖。交付仅为待 Windows 实机验收的准备包。
