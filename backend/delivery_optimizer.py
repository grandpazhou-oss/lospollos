#!/usr/bin/env python3
"""
Delivery Route Optimizer - VRPTW with Capacity Constraints
Uses Clarke-Wright Savings Algorithm + 2-opt improvement + destination splitting

Usage:
  python3 delivery_optimizer.py [<input.xls>] [<output_dir>]
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import math, os, sys, json
from collections import defaultdict

# ============================================================
# CONFIGURATION (overridable via command line)
# ============================================================
INPUT_FILE = "/Users/gz/Downloads/■マスタ・荷物記入シート.xls"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

WORK_START = 9.0
WORK_END = 17.5
LUNCH_START = 12.0
LUNCH_END = 13.0

# Vehicle capacity (system units)
VEH_W_CAP = 30
VEH_V_CAP = 6000

# Unit conversion: parcel data -> vehicle units
# Weight: parcel in grams -> vehicle units. 1 unit ≈ 20kg = 20,000g
# Volume: parcel in cm³ -> vehicle units. 1 unit ≈ 900 cm³
W_CONV = 20000
V_CONV = 900

AVG_SPEED_KPH = 30


# ============================================================
# DATA PARSING
# ============================================================

def parse_parcel_data(path):
    """Parse 荷物情報 sheet"""
    raw = pd.read_excel(path, sheet_name=0, header=None)
    data = raw.iloc[6:].copy()

    df = pd.DataFrame()
    df['parcel_code'] = data.iloc[:, 0]
    df['parcel_name'] = data.iloc[:, 1]
    df['weight'] = pd.to_numeric(data.iloc[:, 2], errors='coerce')
    df['volume'] = pd.to_numeric(data.iloc[:, 3], errors='coerce')
    df['delivery_date'] = pd.to_datetime(data.iloc[:, 4], format='%Y%m%d', errors='coerce')
    df['from_id'] = data.iloc[:, 7].apply(
        lambda x: str(int(float(x))).zfill(2) if pd.notna(x) and str(x) != 'nan' else '01')
    df['to_id'] = data.iloc[:, 13].apply(
        lambda x: str(int(float(x))).zfill(6) if pd.notna(x) and str(x) != 'nan' else None)
    df['work_time_base'] = pd.to_numeric(data.iloc[:, 24], errors='coerce').fillna(1)
    df['work_time_extra'] = pd.to_numeric(data.iloc[:, 25], errors='coerce').fillna(0.5)

    return df[(df['weight'].notna()) & (df['volume'].notna()) &
              (df['delivery_date'].notna()) & (df['weight'] > 0)].copy()


def parse_customer_master(path):
    """Parse 顧客（配送先）マスタ sheet"""
    raw = pd.read_excel(path, sheet_name=1, header=None)
    data = raw.iloc[10:].copy()

    df = pd.DataFrame()
    df['customer_code'] = data.iloc[:, 1].astype(str).str.replace('.0', '', regex=False).str.zfill(6)
    df['customer_name'] = data.iloc[:, 2]
    df['address'] = data.iloc[:, 4]
    df['tw_start'] = pd.to_numeric(data.iloc[:, 14], errors='coerce').fillna(900)
    df['tw_end'] = pd.to_numeric(data.iloc[:, 15], errors='coerce').fillna(1730)
    df['work_time_base'] = pd.to_numeric(data.iloc[:, 31], errors='coerce').fillna(1)
    df['work_time_extra'] = pd.to_numeric(data.iloc[:, 32], errors='coerce').fillna(0.5)

    return df[df['customer_code'].str.match(r'^\d{6}$')].copy()


def parse_coordinates(path):
    """Parse from to经纬度 sheet"""
    raw = pd.read_excel(path, sheet_name=3, header=None)
    data = raw.iloc[1:].copy()

    df = pd.DataFrame()
    df['code'] = data.iloc[:, 0].astype(str).str.replace('.0', '', regex=False).str.zfill(6)
    df['name'] = data.iloc[:, 1]
    df['address'] = data.iloc[:, 2]
    df['lat'] = pd.to_numeric(data.iloc[:, 3], errors='coerce')
    df['lon'] = pd.to_numeric(data.iloc[:, 4], errors='coerce')
    df['type'] = data.iloc[:, 5]

    return df[df['lat'].notna() & df['lon'].notna()].copy()


def parse_vehicles(path):
    """Parse 計画車両マスタ sheet"""
    raw = pd.read_excel(path, sheet_name=6, header=None)
    data = raw.iloc[9:].copy()

    vehicles = []
    for i in range(len(data)):
        row = data.iloc[i]
        code = str(row.iloc[1]) if pd.notna(row.iloc[1]) else None
        if code and code != 'nan':
            vehicles.append({
                'code': code,
                'name': str(row.iloc[2]) if pd.notna(row.iloc[2]) else '',
                'tonnage': float(row.iloc[4]) if pd.notna(row.iloc[4]) else 0.6,
                'vtype': int(float(row.iloc[5])) if pd.notna(row.iloc[5]) else 1,
                'max_w': float(row.iloc[6]) if pd.notna(row.iloc[6]) else VEH_W_CAP,
                'max_v': float(row.iloc[7]) if pd.notna(row.iloc[7]) else VEH_V_CAP,
                'depot': str(int(float(row.iloc[13]))) if pd.notna(row.iloc[13]) else '01',
                'start_time': int(float(row.iloc[15])) if pd.notna(row.iloc[15]) else 900,
                'end_time': int(float(row.iloc[16])) if pd.notna(row.iloc[16]) else 1730,
            })
    return vehicles


# ============================================================
# DISTANCE & TIME
# ============================================================

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat/2)**2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def travel_time_minutes(dist_km):
    return (dist_km / AVG_SPEED_KPH) * 60


def build_distance_matrices(locations):
    """Build distance and time matrices"""
    n = len(locations)
    dist = np.zeros((n, n))
    time = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i != j:
                d = haversine_km(locations[i]['lat'], locations[i]['lon'],
                                 locations[j]['lat'], locations[j]['lon'])
                dist[i, j] = d
                time[i, j] = travel_time_minutes(d)
    return dist, time


# ============================================================
# TIME UTILITIES
# ============================================================

def time_to_min(t):
    """Convert time (military 900/1730 or decimal 9.5) to minutes from midnight"""
    if t >= 100:
        h, m = int(t) // 100, int(t) % 100
        return h * 60 + m
    return t * 60


def min_to_str(m):
    h, mi = int(m // 60), int(m % 60)
    return f"{h:02d}:{mi:02d}"


def service_time(n_parcels, base=1.0, extra=0.5):
    if n_parcels <= 0:
        return 0
    return base + (n_parcels - 1) * extra


# ============================================================
# DESTINATION SPLITTING
# ============================================================

def split_oversized_destinations(destinations, max_w, max_v):
    """Split destinations that individually exceed vehicle capacity into
    multiple virtual destinations. Each split gets a proportional share
    of parcels, weight, and volume."""
    normal = []
    split_log = []

    for dest in destinations:
        w_veh = dest['weight_veh']
        v_veh = dest['volume_veh']

        if w_veh <= max_w and v_veh <= max_v:
            normal.append(dest)
            continue

        # Determine number of splits needed
        n_splits_w = math.ceil(w_veh / max_w) if w_veh > max_w else 1
        n_splits_v = math.ceil(v_veh / max_v) if v_veh > max_v else 1
        n_splits = max(n_splits_w, n_splits_v)

        # Proportional split
        split_w = dest['total_weight'] / n_splits
        split_v = dest['total_volume'] / n_splits
        split_parcels = max(1, dest['n_parcels'] // n_splits)
        split_svc = service_time(split_parcels)

        split_log.append({
            'dest_id': dest['id'],
            'name': dest.get('name', ''),
            'n_splits': n_splits,
            'orig_weight': dest['total_weight'],
            'orig_volume': dest['total_volume'],
            'orig_parcels': dest['n_parcels'],
        })

        for s in range(n_splits):
            normal.append({
                **dest,
                'id': f"{dest['id']}-{s+1}",
                'orig_id': dest['id'],
                'n_parcels': split_parcels if s < n_splits - 1 else dest['n_parcels'] - split_parcels * (n_splits - 1),
                'total_weight': split_w,
                'total_volume': split_v,
                'weight_veh': split_w / W_CONV,
                'volume_veh': split_v / V_CONV,
                'service_time': split_svc if s < n_splits - 1 else service_time(dest['n_parcels'] - split_parcels * (n_splits - 1)),
                'is_split': True,
                'split_group': dest['id'],
            })

    return normal, split_log


# ============================================================
# CLARKE-WRIGHT SAVINGS ALGORITHM
# ============================================================

def compute_savings(dist, depot=0):
    """Compute savings s(i,j) = d(i,0) + d(0,j) - d(i,j)"""
    n = dist.shape[0]
    savings = []
    for i in range(1, n):
        for j in range(i+1, n):
            s = dist[i, depot] + dist[depot, j] - dist[i, j]
            savings.append((s, i, j))
    savings.sort(key=lambda x: x[0], reverse=True)
    return savings


def route_time_feasible(route_indices, time_mat, dests, depot_idx,
                         ws_min, we_min, lunch_s, lunch_e):
    """Check if a route is time-feasible. Returns (feasible, end_time_min)"""
    t = ws_min
    prev = depot_idx
    served_until = t  # track when last service completes

    for idx in route_indices:
        d = dests[idx - 1]
        t += time_mat[prev, idx]

        tw_s = time_to_min(d['tw_start'])
        tw_e = time_to_min(d['tw_end'])

        if t < tw_s:
            t = tw_s

        # Lunch break: if arrival is during lunch, wait until lunch ends
        if lunch_s <= t < lunch_e:
            t = lunch_e

        if t > tw_e:
            return False, None

        # Service may push into lunch → push entire service after lunch
        svc = d['service_time']
        if t < lunch_s and t + svc > lunch_s:
            t = lunch_e

        t += svc
        served_until = t
        prev = idx

    t += time_mat[prev, depot_idx]

    if t > we_min:
        return False, None

    return True, t


def build_routes_savings(dests, dist, time_mat, ws_min, we_min, lunch_s, lunch_e):
    """Build routes using Clarke-Wright savings algorithm."""
    n = len(dests)
    if n == 0:
        return []

    depot = 0
    savings = compute_savings(dist, depot)

    # Each destination starts as its own route
    routes = {i: [i] for i in range(1, n)}
    r_w = {i: dests[i-1]['weight_veh'] for i in range(1, n)}
    r_v = {i: dests[i-1]['volume_veh'] for i in range(1, n)}
    r_time = {}
    r_end = {i: (i, i) for i in range(1, n)}  # (first_stop, last_stop)

    # Compute initial route times
    for i in range(1, n):
        ok, end_t = route_time_feasible([i], time_mat, dests, depot,
                                         ws_min, we_min, lunch_s, lunch_e)
        if not ok:
            r_time[i] = we_min + 1  # mark as infeasible but keep
        else:
            r_time[i] = end_t

    # Merge routes
    for saving, i, j in savings:
        ri = rj = None
        for rid, stops in routes.items():
            if i in stops:
                ri = rid
            if j in stops:
                rj = rid
        if ri is None or rj is None or ri == rj:
            continue

        # Check merge feasibility: i and j must be at ends of their routes
        ei_s, ei_e = r_end[ri]
        ej_s, ej_e = r_end[rj]

        # Determine merge direction
        if ei_e == i and ej_s == j:
            merged = routes[ri] + routes[rj]
        elif ej_e == j and ei_s == i:
            merged = routes[rj] + routes[ri]
        elif ei_e == i and ej_e == j:
            merged = routes[ri] + list(reversed(routes[rj]))
        elif ei_s == i and ej_s == j:
            merged = list(reversed(routes[ri])) + routes[rj]
        else:
            continue

        # Check capacity
        mw = r_w[ri] + r_w[rj]
        mv = r_v[ri] + r_v[rj]
        if mw > VEH_W_CAP * 0.98 or mv > VEH_V_CAP * 0.98:
            continue

        # Check time feasibility
        ok, end_t = route_time_feasible(merged, time_mat, dests, depot,
                                         ws_min, we_min, lunch_s, lunch_e)
        if not ok:
            continue

        # Merge
        del routes[rj]
        routes[ri] = merged
        r_w[ri] = mw
        r_v[ri] = mv
        r_time[ri] = end_t
        r_end[ri] = (merged[0], merged[-1])
        del r_w[rj], r_v[rj], r_time[rj], r_end[rj]

    return list(routes.values())


# ============================================================
# 2-OPT IMPROVEMENT
# ============================================================

def two_opt(route, dist, time_mat, dests, ws_min, we_min, lunch_s, lunch_e, depot=0):
    """2-opt local search on a single route. Respects time feasibility."""
    if len(route) < 3:
        return route
    best = list(route)
    improved = True
    iters = 0
    while improved and iters < 100:
        improved = False
        iters += 1
        for i in range(len(best) - 1):
            for j in range(i + 2, len(best)):
                a = best[i-1] if i > 0 else depot
                b = best[i]
                c = best[j-1]
                d = best[j+1] if j < len(best)-1 else depot

                old_d = dist[a, b] + dist[c, d]
                new_d = dist[a, c] + dist[b, d]

                if new_d < old_d - 0.01:
                    trial = best[:i] + list(reversed(best[i:j+1])) + best[j+1:]
                    ok, _ = route_time_feasible(trial, time_mat, dests, depot,
                                                 ws_min, we_min, lunch_s, lunch_e)
                    if ok:
                        best = trial
                        improved = True
                        break
            if improved:
                break
    return best


# ============================================================
# ROUTE DETAIL COMPUTATION
# ============================================================

def compute_route_detail(route, time_mat, dests, depot, ws_min, lunch_s, lunch_e):
    """Compute detailed timeline for a route."""
    events = []
    t = ws_min
    prev = depot
    total_dist = 0.0

    for pos, idx in enumerate(route):
        d = dests[idx - 1]
        travel = time_mat[prev, idx]
        t += travel

        tw_s = time_to_min(d['tw_start'])
        if t < tw_s:
            t = tw_s

        # Lunch break
        if lunch_s <= t < lunch_e:
            t = lunch_e

        svc = d['service_time']
        if t < lunch_s and t + svc > lunch_s:
            t = lunch_e

        depart = t + svc

        events.append({
            'stop': pos + 1,
            'dest_id': d['orig_id'] if d.get('is_split') else d['id'],
            'dest_name': d.get('name', ''),
            'address': d.get('address', ''),
            'n_parcels': d['n_parcels'],
            'total_weight': round(d['total_weight'], 0),
            'total_volume': round(d['total_volume'], 0),
            'travel_min': round(travel, 1),
            'arrive': min_to_str(t),
            'depart': min_to_str(depart),
            'service_min': round(svc, 1),
            'is_split': d.get('is_split', False),
        })
        t = depart
        prev = idx

    return_travel = time_mat[prev, depot]
    t += return_travel

    return events, min_to_str(t), round(return_travel, 1)


# ============================================================
# DAILY OPTIMIZATION
# ============================================================

def optimize_day(date, parcels, coord_df, customer_df, vehicles,
                 ws_min, we_min, lunch_s, lunch_e):
    """Optimize delivery routes for a single day."""

    # Depot location
    depot_mask = coord_df['type'].str.contains('from|拠点', na=False) | (coord_df['code'] == '000000')
    depot_row = coord_df[depot_mask]
    if len(depot_row) == 0:
        depot_row = coord_df.iloc[:1]

    depot = {
        'id': 'DEPOT',
        'lat': depot_row.iloc[0]['lat'],
        'lon': depot_row.iloc[0]['lon'],
        'name': str(depot_row.iloc[0].get('name', '倉庫')),
    }

    # Filter and aggregate parcels for this day
    day = parcels[parcels['delivery_date'] == date].copy()
    if len(day) == 0:
        return None, None, None, None

    agg = day.groupby('to_id').agg(
        n_parcels=('parcel_code', 'count'),
        total_weight=('weight', 'sum'),
        total_volume=('volume', 'sum'),
    ).reset_index()

    # Build destination list
    destinations = []
    skipped = []

    for _, row in agg.iterrows():
        dest_id = row['to_id']
        coord = coord_df[coord_df['code'] == dest_id]
        if len(coord) == 0:
            skipped.append(dest_id)
            continue

        lat = coord.iloc[0]['lat']
        lon = coord.iloc[0]['lon']
        name = str(coord.iloc[0].get('name', ''))
        addr = str(coord.iloc[0].get('address', ''))

        # Customer time window
        cust = customer_df[customer_df['customer_code'] == dest_id]
        tw_s, tw_e = 900, 1730
        if len(cust) > 0:
            tw_s = cust.iloc[0]['tw_start']
            tw_e = cust.iloc[0]['tw_end']

        w_veh = float(row['total_weight']) / W_CONV
        v_veh = float(row['total_volume']) / V_CONV
        n_p = int(row['n_parcels'])

        destinations.append({
            'id': dest_id,
            'orig_id': dest_id,
            'name': name,
            'address': addr,
            'lat': lat,
            'lon': lon,
            'n_parcels': n_p,
            'total_weight': float(row['total_weight']),
            'total_volume': float(row['total_volume']),
            'weight_veh': w_veh,
            'volume_veh': v_veh,
            'service_time': service_time(n_p),
            'tw_start': tw_s,
            'tw_end': tw_e,
            'is_split': False,
            'split_group': None,
        })

    if len(destinations) == 0:
        return None, None, None, skipped

    # Split oversized destinations
    destinations, split_log = split_oversized_destinations(destinations, VEH_W_CAP, VEH_V_CAP)

    # Build distance matrices
    all_locs = [depot] + [{'lat': d['lat'], 'lon': d['lon']} for d in destinations]
    dist, time_mat = build_distance_matrices(all_locs)

    # Build routes
    routes = build_routes_savings(destinations, dist, time_mat, ws_min, we_min, lunch_s, lunch_e)

    # Improve with 2-opt
    improved = [two_opt(r, dist, time_mat, destinations, ws_min, we_min, lunch_s, lunch_e)
                for r in routes]

    # Sort routes by size (largest first)
    improved.sort(key=len, reverse=True)

    # Assign to vehicles and compute details
    detailed = []
    total_p, total_w, total_v, total_dests = 0, 0, 0, 0
    served_dest_ids = set()

    for i, route in enumerate(improved):
        if i >= len(vehicles):
            # Extra routes beyond vehicle count - still include as "overflow"
            pass

        veh = vehicles[i] if i < len(vehicles) else {'code': f'OVERFLOW-{i}', 'name': '予備車両'}

        events, ret_time, ret_travel = compute_route_detail(
            route, time_mat, destinations, 0, ws_min, lunch_s, lunch_e)

        r_w = sum(destinations[idx-1]['weight_veh'] for idx in route)
        r_v = sum(destinations[idx-1]['volume_veh'] for idx in route)
        r_p = sum(destinations[idx-1]['n_parcels'] for idx in route)

        for idx in route:
            d = destinations[idx-1]
            oid = d.get('orig_id', d['id'])
            served_dest_ids.add(oid)

        total_p += r_p
        total_w += sum(destinations[idx-1]['total_weight'] for idx in route)
        total_v += sum(destinations[idx-1]['total_volume'] for idx in route)
        total_dests += len(route)

        detailed.append({
            'vehicle_code': veh['code'],
            'vehicle_name': veh['name'],
            'stops': len(route),
            'total_parcels': r_p,
            'weight_veh': round(r_w, 2),
            'volume_veh': round(r_v, 2),
            'w_util_pct': round(r_w / VEH_W_CAP * 100, 1),
            'v_util_pct': round(r_v / VEH_V_CAP * 100, 1),
            'return_time': ret_time,
            'events': events,
        })

    # Summary
    summary = {
        'date': date.strftime('%Y-%m-%d'),
        'total_parcels': int(total_p),
        'total_weight': round(total_w, 0),
        'total_volume': round(total_v, 0),
        'n_destinations_input': len(agg),
        'n_destinations_served': len(served_dest_ids),
        'n_destinations_skipped': len(skipped),
        'n_routes': len(detailed),
        'n_vehicles_used': min(len(detailed), len(vehicles)),
        'n_overflows': max(0, len(detailed) - len(vehicles)),
        'n_splits': len(split_log),
        'avg_w_util': round(np.mean([r['w_util_pct'] for r in detailed]), 1) if detailed else 0,
        'avg_v_util': round(np.mean([r['v_util_pct'] for r in detailed]), 1) if detailed else 0,
    }

    return detailed, summary, split_log, skipped


# ============================================================
# EXCEL OUTPUT
# ============================================================

def generate_excel(daily_routes, summaries, split_logs, skipped_logs, vehicles, output_path):
    """Generate multi-sheet Excel output."""

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        # Sheet 1: Daily Summary
        if summaries:
            pd.DataFrame(summaries).to_excel(writer, sheet_name='日別サマリ', index=False)

        # Sheet 2: Detailed Delivery Plan
        all_rows = []
        for date_str, routes in daily_routes.items():
            for veh_idx, route in enumerate(routes):
                for evt in route['events']:
                    all_rows.append({
                        '配送日': date_str,
                        '車両コード': route['vehicle_code'],
                        '車両名称': route['vehicle_name'],
                        '配送順': evt['stop'],
                        '配送先ID': evt['dest_id'],
                        '配送先名称': evt['dest_name'],
                        '配送先住所': evt['address'],
                        '荷物数': evt['n_parcels'],
                        '合計重量(g)': evt['total_weight'],
                        '合計容積(cm3)': evt['total_volume'],
                        '移動時間(分)': evt['travel_min'],
                        '到着時刻': evt['arrive'],
                        '出発時刻': evt['depart'],
                        '作業時間(分)': evt['service_min'],
                        '分割配送': '是' if evt['is_split'] else '',
                    })

        if all_rows:
            pd.DataFrame(all_rows).to_excel(writer, sheet_name='配送計画詳細', index=False)

        # Sheet 3: Route Summary
        route_rows = []
        for date_str, routes in daily_routes.items():
            for route in routes:
                route_rows.append({
                    '配送日': date_str,
                    '車両コード': route['vehicle_code'],
                    '車両名称': route['vehicle_name'],
                    '配送先数': route['stops'],
                    '総荷物数': route['total_parcels'],
                    '重量稼働率(%)': route['w_util_pct'],
                    '容積稼働率(%)': route['v_util_pct'],
                    '帰着時刻': route['return_time'],
                })
        if route_rows:
            pd.DataFrame(route_rows).to_excel(writer, sheet_name='ルートサマリ', index=False)

        # Sheet 4: Split Log
        all_splits = []
        for date_str, splits in split_logs.items():
            for s in splits:
                s['date'] = date_str
                all_splits.append(s)
        if all_splits:
            pd.DataFrame(all_splits).to_excel(writer, sheet_name='分割配送記録', index=False)

        # Sheet 5: Skipped Destinations
        all_skipped = []
        for date_str, skips in skipped_logs.items():
            for s in skips:
                all_skipped.append({'配送日': date_str, '配送先ID': s, '理由': '座標情報なし'})
        if all_skipped:
            pd.DataFrame(all_skipped).to_excel(writer, sheet_name='未割当配送先', index=False)

    print(f"\nOutput saved to: {output_path}")


# ============================================================
# MAIN
# ============================================================

def main():
    print("=" * 60)
    print("DELIVERY ROUTE OPTIMIZER - VRPTW with Capacity Constraints")
    print("=" * 60)

    print("\n[1/4] Loading data...")
    parcels = parse_parcel_data(INPUT_FILE)
    customers = parse_customer_master(INPUT_FILE)
    coords = parse_coordinates(INPUT_FILE)
    vehicles = parse_vehicles(INPUT_FILE)
    print(f"  Parcels: {len(parcels)} | Customers: {len(customers)} | "
          f"Coordinates: {len(coords)} | Vehicles: {len(vehicles)}")

    ws_min = time_to_min(WORK_START)
    we_min = time_to_min(WORK_END)
    lunch_s = time_to_min(LUNCH_START)
    lunch_e = time_to_min(LUNCH_END)

    dates = sorted(parcels['delivery_date'].dropna().unique())
    print(f"\n[2/4] Optimizing {len(dates)} delivery days...")

    daily_routes = {}
    all_summaries = []
    all_splits = {}
    all_skipped = {}

    for i, date in enumerate(dates):
        print(f"  Day {i+1:2d}/{len(dates)}: {date.strftime('%Y-%m-%d')} ...", end=' ')

        routes, summary, splits, skipped = optimize_day(
            date, parcels, coords, customers, vehicles,
            ws_min, we_min, lunch_s, lunch_e)

        if summary is None:
            print("NO DATA")
            continue

        daily_routes[date.strftime('%Y-%m-%d')] = routes
        all_summaries.append(summary)
        if splits:
            all_splits[date.strftime('%Y-%m-%d')] = splits
        if skipped:
            all_skipped[date.strftime('%Y-%m-%d')] = skipped

        flags = []
        if summary['n_overflows'] > 0:
            flags.append(f"OVERFLOW={summary['n_overflows']}")
        if summary['n_splits'] > 0:
            flags.append(f"SPLIT={summary['n_splits']}")
        if summary['n_destinations_skipped'] > 0:
            flags.append(f"SKIP={summary['n_destinations_skipped']}")

        flag_str = f" [{' | '.join(flags)}]" if flags else ""
        print(f"{summary['n_routes']} routes, "
              f"{summary['n_destinations_served']}/{summary['n_destinations_input']} dests{flag_str}")

    # Print summary
    print(f"\n[3/4] Results Summary")
    print("-" * 80)
    header = (f"{'Date':<12} {'Parcels':>7} {'Dests':>5} {'Routes':>6} "
              f"{'VehUse':>6} {'W_Util':>7} {'V_Util':>7} {'Split':>5} {'Skip':>5} {'Over':>5}")
    print(header)
    print("-" * 80)

    total_p, total_r, total_s, total_sk, total_ov = 0, 0, 0, 0, 0
    for s in all_summaries:
        print(f"{s['date']:<12} {s['total_parcels']:7d} {s['n_destinations_input']:5d} "
              f"{s['n_routes']:6d} {s['n_vehicles_used']:6d} "
              f"{s['avg_w_util']:6.1f}% {s['avg_v_util']:6.1f}% "
              f"{s['n_splits']:5d} {s['n_destinations_skipped']:5d} {s['n_overflows']:5d}")
        total_p += s['total_parcels']
        total_r += s['n_routes']
        total_s += s['n_splits']
        total_sk += s['n_destinations_skipped']
        total_ov += s['n_overflows']

    print("-" * 80)
    print(f"{'TOTAL':<12} {total_p:7d} {'':>5} {total_r:6d} "
          f"{'':>6} {'':>7} {'':>7} {total_s:5d} {total_sk:5d} {total_ov:5d}")

    total_missing = sum(len(v) for v in all_skipped.values())
    if total_missing > 0:
        print(f"\n  Note: {total_missing} destination-days skipped due to missing coordinates")

    # Generate output
    excel_path = os.path.join(OUTPUT_DIR, 'delivery_plan.xlsx')
    print(f"\n[4/4] Generating Excel output...")
    generate_excel(daily_routes, all_summaries, all_splits, all_skipped, vehicles, excel_path)

    # Generate route data JSON for dashboard
    json_path = os.path.join(OUTPUT_DIR, 'route_data.json')
    compact_path = os.path.join(OUTPUT_DIR, 'route_data_compact.json')
    print(f"[5/5] Exporting route data JSON for dashboard...")
    export_route_json(daily_routes, all_summaries, json_path, compact_path)
    print("Done!")


def export_route_json(daily_routes, all_summaries, json_path, compact_path):
    """Export route data as JSON for the dashboard HTML."""
    # Find depot from coordinate data
    coords = parse_coordinates(INPUT_FILE)
    depot_mask = coords['type'].str.contains('from|拠点', na=False)
    if depot_mask.any():
        depot_row = coords[depot_mask].iloc[0]
    else:
        depot_row = coords.iloc[0]

    depot = {
        'lat': float(depot_row['lat']),
        'lon': float(depot_row['lon']),
        'name': str(depot_row.get('name', '仓库')),
        'address': str(depot_row.get('address', '')),
    }

    routes_by_date = {}
    total_routes = 0
    for date_str, routes in daily_routes.items():
        day_data = {}
        for r in routes:
            stops = []
            for evt in r['events']:
                stops.append({
                    'id': evt['dest_id'],
                    'name': evt['dest_name'],
                    'address': evt['address'],
                    'lat': 0, 'lon': 0,
                    'parcels': evt['n_parcels'],
                    'arrive': evt['arrive'],
                    'depart': evt['depart'],
                    'travel_min': evt['travel_min'],
                    'service_min': evt['service_min'],
                    'is_split': evt.get('is_split', False),
                })
            day_data[r['vehicle_code']] = {
                'vehicle_name': r['vehicle_name'],
                'stop_count': r['stops'],
                'total_parcels': r['total_parcels'],
                'last_depart': r['events'][-1]['depart'] if r['events'] else '-',
                'stops': stops,
            }
            total_routes += 1
        routes_by_date[date_str] = day_data

    # Enrich stops with lat/lon from coordinate data
    coord_dict = {}
    for _, row in coords.iterrows():
        coord_dict[row['code']] = (float(row['lat']), float(row['lon']))

    for date_str, day_data in routes_by_date.items():
        for veh_code, veh_data in day_data.items():
            for stop in veh_data['stops']:
                base_id = stop['id'].split('-')[0]  # handle split dest IDs like "115246-1"
                if base_id in coord_dict:
                    stop['lat'], stop['lon'] = coord_dict[base_id]

    output = {'depot': depot, 'routes_by_date': routes_by_date}

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    with open(compact_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    # Export as JS variable file (for dashboard to load via <script src>)
    js_path = os.path.join(OUTPUT_DIR, 'route_data.js')
    compact_json = json.dumps(output, ensure_ascii=False, separators=(',', ':'))
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('var ROUTE_DATA = ')
        f.write(compact_json)
        f.write(';\n')

    print(f"  JSON: {json_path}")
    print(f"  JS:   {js_path}")
    print(f"  {len(routes_by_date)} days, {total_routes} routes")


if __name__ == '__main__':
    if len(sys.argv) > 1:
        INPUT_FILE = sys.argv[1]
    if len(sys.argv) > 2:
        OUTPUT_DIR = sys.argv[2]
    main()
