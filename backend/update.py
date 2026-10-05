#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键更新脚本: Excel → 配送最適化 → ダッシュボードHTML生成

使用方法:
  1. 新しい .xls ファイルを配置
  2. python3 update.py <XLSファイルのパス>
  3. dispatch.html をブラウザで開く（更新完了）

例:
  python3 update.py "/Users/gz/Downloads/■マスタ・荷物記入シート.xls"
"""

import sys
import os
import subprocess

# Project root
ROOT = os.path.dirname(os.path.abspath(__file__))
OPTIMIZER = os.path.join(ROOT, 'delivery_optimizer.py')
BUILDER = os.path.join(ROOT, 'build_dashboard.py')

def main():
    if len(sys.argv) < 2:
        print("使用方法: python3 update.py <XLSファイルのパス>")
        print("例: python3 update.py '/Users/gz/Downloads/荷物記入シート.xls'")
        sys.exit(1)

    xls_path = sys.argv[1]
    if not os.path.exists(xls_path):
        print(f"エラー: ファイルが見つかりません: {xls_path}")
        sys.exit(1)

    print("=" * 60)
    print("配送ダッシュボード 更新パイプライン")
    print("=" * 60)

    # Step 1: Run optimizer (reads XLS -> generates route_data + delivery_plan.xlsx)
    print("\n[1/3] 配送最適化を実行中...")

    # Patch the optimizer's INPUT_FILE and OUTPUT_FILE
    import delivery_optimizer as opt
    opt.INPUT_FILE = xls_path
    opt.OUTPUT_FILE = os.path.join(ROOT, 'delivery_plan.xlsx')
    opt.main()

    # Step 2: Extract route data to JSON
    print("\n[2/3] ルートデータを抽出中...")
    result = subprocess.run([
        sys.executable, '-c', '''
import pandas as pd, json, math, os
import sys
sys.path.insert(0, sys.argv[1])

# Re-parse data using the optimizer's logic
from delivery_optimizer import (
    parse_parcel_data, parse_customer_master, parse_coordinates, parse_vehicles,
    optimize_day, time_to_min, WORK_START, WORK_END, LUNCH_START, LUNCH_END
)

INPUT, OUTPUT, COMPACT = sys.argv[2:5]

parcels = parse_parcel_data(INPUT)
customers = parse_customer_master(INPUT)
coords = parse_coordinates(INPUT)
vehicles = parse_vehicles(INPUT)

ws = time_to_min(WORK_START); we = time_to_min(WORK_END)
ls = time_to_min(LUNCH_START); le = time_to_min(LUNCH_END)

dates = sorted(parcels['delivery_date'].dropna().unique())
routes_by_date = {}
total_routes = 0

for date in dates:
    detailed, summary, split_log, skipped = optimize_day(
        date, parcels, coords, customers, vehicles, ws, we, ls, le)
    if detailed is None:
        continue
    day_routes = {}
    for r in detailed:
        stops = []
        for evt in r['events']:
            stops.append({
                'id': evt['dest_id'],
                'name': evt['dest_name'],
                'address': evt['address'],
                'lat': coords[coords['code']==evt['dest_id']].iloc[0]['lat'] if len(coords[coords['code']==evt['dest_id']])>0 else 0,
                'lon': coords[coords['code']==evt['dest_id']].iloc[0]['lon'] if len(coords[coords['code']==evt['dest_id']])>0 else 0,
                'parcels': evt['n_parcels'],
                'arrive': evt['arrive'],
                'depart': evt['depart'],
                'travel_min': evt['travel_min'],
                'service_min': evt['service_min'],
                'is_split': evt.get('is_split', False),
            })
        day_routes[r['vehicle_code']] = {
            'vehicle_name': r['vehicle_name'],
            'stop_count': r['stops'],
            'total_parcels': r['total_parcels'],
            'last_depart': r['events'][-1]['depart'] if r['events'] else '-',
            'stops': stops,
        }
        total_routes += 1
    routes_by_date[date.strftime('%Y-%m-%d')] = day_routes

# Depot
depot_mask = coords['type'].str.contains('from|拠点', na=False)
if depot_mask.any():
    depot_row = coords[depot_mask].iloc[0]
else:
    depot_row = coords.iloc[0]
depot = {'lat': depot_row['lat'], 'lon': depot_row['lon'], 'name': str(depot_row.get('name', '仓库')), 'address': str(depot_row.get('address', ''))}

output = {'depot': depot, 'routes_by_date': routes_by_date}

with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

with open(COMPACT, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

dates_count = len(routes_by_date)
print(f"OK: {dates_count}天, {total_routes}路线, depot={depot['name']}")
''', ROOT, xls_path, os.path.join(ROOT, 'route_data.json'), os.path.join(ROOT, 'route_data_compact.json')], capture_output=True, text=True, timeout=120, check=True)

    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr[:500])

    # Step 3: Rebuild dashboard HTML
    print("\n[3/3] ダッシュボードHTMLを生成中...")
    result = subprocess.run([sys.executable, BUILDER], capture_output=True, text=True, timeout=60, check=True)
    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr[:500])

    dashboard_path = os.path.join(ROOT, '..', 'dispatch.html')
    print(f"\n{'=' * 60}")
    print(f"更新完了!")
    print(f"  配送計画: {os.path.join(ROOT, 'delivery_plan.xlsx')}")
    print(f"  ダッシュボード: {dashboard_path}")
    print(f"  ブラウザで {dashboard_path} を開いてください")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
