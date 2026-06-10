"""FastAPI server for AI dispatch engine."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import openpyxl

from engine import run, DispatchConfig, VehicleType

import subprocess, tempfile, shutil

OPTIMIZER_SCRIPT = Path(__file__).resolve().parent / "delivery_optimizer.py"

app = FastAPI(title="Dispatch Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Models ----

class StopInput(BaseModel):
    id: str = ""
    lat: float
    lon: float
    weight: float = 0
    volume: float = 0
    address: str = ""
    customer: str = ""
    packages: int = 0
    timeWindow: str = ""


class VehicleTypeInput(BaseModel):
    name: str = "Standard"
    maxWeightKg: float = 600
    maxVolumeL: float = 6000
    costPerKm: float = 100
    count: int = 1


class DispatchRequest(BaseModel):
    stops: list[StopInput]
    depotLat: float = 32.8121
    depotLon: float = 130.7501
    depotOpen: str = "08:00"
    depotClose: str = "18:00"
    speedKmh: float = 30.0
    serviceTimeMin: int = 5
    fleet: list[VehicleTypeInput] = []


class DispatchResponse(BaseModel):
    routes: list[dict]
    summary: dict


# ---- Excel parsing ----

def _parse_excel(file_bytes: bytes) -> list[dict]:
    """Parse uploaded Excel into stop dicts.

    Expected columns (case-insensitive, loose match):
      订单号/ID, 地址/address, 纬度/lat, 经度/lon/lng,
      重量/kg/weight, 体积/L/volume, 客户/customer, 件数/packages
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    header = [str(c).strip().lower() if c else "" for c in rows[0]]

    # Map common column names
    col_map = {}
    for idx, h in enumerate(header):
        if any(k in h for k in ("id", "订单号", "order", "no")):
            col_map.setdefault("id", idx)
        if any(k in h for k in ("lat", "纬度", "latitude")):
            col_map.setdefault("lat", idx)
        if any(k in h for k in ("lon", "lng", "经度", "经度", "longitude")):
            col_map.setdefault("lon", idx)
        if any(k in h for k in ("weight", "重量", "kg")):
            col_map.setdefault("weight", idx)
        if any(k in h for k in ("volume", "体积", "容积", "l")):
            col_map.setdefault("volume", idx)
        if any(k in h for k in ("address", "地址", "addr")):
            col_map.setdefault("address", idx)
        if any(k in h for k in ("customer", "客户", "name")):
            col_map.setdefault("customer", idx)
        if any(k in h for k in ("packages", "件", "pkgs", "qty")):
            col_map.setdefault("packages", idx)

    stops = []
    for row in rows[1:]:
        try:
            lat = float(row[col_map["lat"]]) if "lat" in col_map else None
            lon = float(row[col_map["lon"]]) if "lon" in col_map else None
            if lat is None or lon is None:
                continue
            stops.append({
                "id": str(row[col_map.get("id", 0)]) if "id" in col_map else f"S{len(stops)+1:03d}",
                "lat": lat,
                "lon": lon,
                "weight": float(row[col_map.get("weight", 0)]) if "weight" in col_map else 0,
                "volume": float(row[col_map.get("volume", 0)]) if "volume" in col_map else 0,
                "address": str(row[col_map.get("address", 0)]) if "address" in col_map else "",
                "customer": str(row[col_map.get("customer", 0)]) if "customer" in col_map else "",
                "packages": int(row[col_map.get("packages", 0)]) if "packages" in col_map else 0,
            })
        except (ValueError, TypeError):
            continue
    return stops


# ---- DEMO data generator ----

def _generate_demo_stops(n: int = 80) -> list[dict]:
    """Generate realistic demo stops around Kumamoto."""
    import random
    random.seed(42)
    base_lat, base_lon = 32.8121, 130.7501
    stops = []
    areas = [
        (32.80, 130.72),
        (32.79, 130.75),
        (32.83, 130.78),
        (32.78, 130.70),
        (32.85, 130.72),
        (32.81, 130.80),
        (32.75, 130.69),
        (32.88, 130.74),
        (32.72, 130.79),
        (32.84, 130.82),
        (32.79, 130.65),
        (32.82, 130.85),
    ]
    customers = [
        "熊本第一病院", "下江津薬局", "清水調剤薬局", "西原クリニック",
        "託麻薬局", "帯山調剤薬局", "東区メディカル", "健軍薬局",
        "長嶺薬局", "錦ヶ丘調剤薬局",
    ]
    # Time window presets (70% all-day, 30% specific)
    tw_presets = (
        ["08:00-18:00"] * 7
        + ["09:00-12:00", "08:00-11:00", "10:00-14:00",
           "13:00-17:00", "09:00-15:00", "14:00-18:00"]
    )
    for i in range(n):
        area = random.choice(areas)
        stops.append({
            "id": f"P{i+1:04d}",
            "lat": round(area[0] + random.uniform(-0.02, 0.02), 6),
            "lon": round(area[1] + random.uniform(-0.02, 0.02), 6),
            "weight": round(random.uniform(2, 40), 1),
            "volume": round(random.uniform(5, 150), 1),
            "address": f"熊本県熊本市 配送先{i+1}",
            "customer": random.choice(customers),
            "packages": random.randint(1, 8),
            "timeWindow": random.choice(tw_presets),
        })
    return stops


# ---- API Routes ----

def _default_fleet() -> list[VehicleType]:
    return [
        VehicleType(name="Small Van", max_weight_kg=400, max_volume_l=3000, cost_per_km=80, count=3),
        VehicleType(name="Standard", max_weight_kg=600, max_volume_l=6000, cost_per_km=100, count=2),
    ]


@app.post("/api/dispatch", response_model=DispatchResponse)
async def dispatch_excel(
    file: UploadFile = File(...),
    max_weight: float = Form(600),
    max_volume: float = Form(6000),
    depot_open: str = Form("08:00"),
    depot_close: str = Form("18:00"),
    speed: float = Form(30),
    service: int = Form(5),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        return JSONResponse({"error": "Only .xlsx/.xls files supported"}, status_code=400)

    content = await file.read()
    stops = _parse_excel(content)
    if not stops:
        return JSONResponse({"error": "No valid stops found in Excel"}, status_code=400)

    # Excel upload uses a single vehicle type for simplicity
    fleet = [VehicleType(name="Vehicle", max_weight_kg=max_weight, max_volume_l=max_volume, cost_per_km=100, count=10)]
    config = DispatchConfig(
        depot_open=depot_open, depot_close=depot_close,
        speed_kmh=speed, service_time_min=service,
        fleet=fleet,
    )
    result = run(stops, config)
    return {"routes": result.routes, "summary": result.summary}


@app.post("/api/dispatch/json", response_model=DispatchResponse)
async def dispatch_json(req: DispatchRequest):
    stops = [s.model_dump() for s in req.stops]
    if req.fleet:
        fleet = [VehicleType(name=v.name, max_weight_kg=v.maxWeightKg, max_volume_l=v.maxVolumeL, cost_per_km=v.costPerKm, count=v.count) for v in req.fleet]
    else:
        fleet = _default_fleet()
    config = DispatchConfig(
        depot_lat=req.depotLat, depot_lon=req.depotLon,
        depot_open=req.depotOpen, depot_close=req.depotClose,
        speed_kmh=req.speedKmh, service_time_min=req.serviceTimeMin,
        fleet=fleet,
    )
    result = run(stops, config)
    return {"routes": result.routes, "summary": result.summary}


@app.get("/api/demo")
async def demo_dispatch(
    n: int = 60,
    small_count: int = 3,
    small_w: float = 400,
    small_v: float = 3000,
    standard_count: int = 2,
    standard_w: float = 600,
    standard_v: float = 6000,
    depot_open: str = "08:00",
    depot_close: str = "18:00",
    speed: float = 30,
    service: int = 5,
):
    stops = _generate_demo_stops(n)
    fleet = [
        VehicleType(name="Small Van", max_weight_kg=small_w, max_volume_l=small_v, cost_per_km=60, count=small_count),
        VehicleType(name="Standard", max_weight_kg=standard_w, max_volume_l=standard_v, cost_per_km=100, count=standard_count),
    ]
    config = DispatchConfig(
        depot_open=depot_open, depot_close=depot_close,
        speed_kmh=speed, service_time_min=service,
        fleet=fleet,
    )
    result = run(stops, config)
    return {"routes": result.routes, "summary": result.summary, "solverInfo": result.solver_info}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ---- Dashboard Upload: .xls -> delivery_optimizer -> route_data.js ----

@app.post("/api/upload-dispatch")
async def upload_dispatch(file: UploadFile = File(...)):
    """接收日文格式 .xls 文件，运行优化引擎，返回 route_data.js"""
    if not file.filename.endswith(('.xls', '.xlsx')):
        return JSONResponse({"success": False, "error": "仅支持 .xls / .xlsx 格式"}, status_code=400)

    if not OPTIMIZER_SCRIPT.exists():
        return JSONResponse({"success": False, "error": f"优化脚本未找到: {OPTIMIZER_SCRIPT}"}, status_code=500)

    try:
        content = await file.read()

        # 保存到临时目录
        tmpdir = tempfile.mkdtemp(prefix='dispatch_')
        tmp_xls = os.path.join(tmpdir, file.filename)
        with open(tmp_xls, 'wb') as f:
            f.write(content)

        output_dir = str(OPTIMIZER_SCRIPT.parent)

        # 运行优化引擎
        result = subprocess.run(
            ['python3', str(OPTIMIZER_SCRIPT), tmp_xls, output_dir],
            capture_output=True, text=True, timeout=300
        )

        # 读取生成的 route_data.js
        js_path = os.path.join(output_dir, 'route_data.js')
        if not os.path.exists(js_path):
            return JSONResponse({
                "success": False,
                "error": "优化完成但未生成数据文件",
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-500:],
            })

        with open(js_path, 'r', encoding='utf-8') as f:
            js_content = f.read()

        # 清理
        shutil.rmtree(tmpdir, ignore_errors=True)

        return {
            "success": True,
            "filename": file.filename,
            "dataSize": len(js_content),
            "stdout": result.stdout[-500:],
        }

    except subprocess.TimeoutExpired:
        return JSONResponse({"success": False, "error": "优化超时（5分钟）"}, status_code=500)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/data-status")
async def data_status():
    """返回当前 route_data.js 状态"""
    js_path = OPTIMIZER_SCRIPT.parent / "route_data.js"
    excel_path = OPTIMIZER_SCRIPT.parent / "delivery_plan.xlsx"
    return {
        "hasData": js_path.exists(),
        "dataSize": js_path.stat().st_size if js_path.exists() else 0,
        "hasExcel": excel_path.exists(),
        "excelSize": excel_path.stat().st_size if excel_path.exists() else 0,
    }


# Serve static files in production
ROOT = Path(__file__).resolve().parent.parent
if (ROOT / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"\n{'='*60}")
    print(f"  物流配送分析平台 - 数据服务")
    print(f"  访问地址: http://localhost:{port}/dispatch.html")
    print(f"  上传API:  POST http://localhost:{port}/api/upload-dispatch")
    print(f"  状态API:  GET  http://localhost:{port}/api/data-status")
    print(f"  按 Ctrl+C 停止")
    print(f"{'='*60}\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
