import json
import math
import random
import os
from collections import defaultdict

def main():
    in_path = "data/global_dataset.json"
    if not os.path.exists(in_path):
        print("Waiting for dataset...")
        return
        
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    nodes = data['nodes']
    edges = data['edges']
    fields = data['fields']
    
    print(f"Loaded {len(nodes)} nodes, {len(edges)} edges across {len(fields)} fields.")
    
    # 1. FIELD-NORMALIZED RADII
    field_cites = defaultdict(list)
    for n in nodes:
        field_cites[n['field_id']].append(n['citations'])
        
    field_stats = {}
    for fid, clist in field_cites.items():
        min_c = min(clist)
        max_c = max(clist)
        field_stats[fid] = {
            'min_log': math.log10(max(1, min_c)),
            'max_log': math.log10(max(10, max_c))
        }
        
    # 2. ASSIGN COORDINATES: COMPACT 2D (NO HOLLOW FLOWER) & SPHERICAL 3D
    field_2d_angles = {
        '26': -math.pi / 2,        # Math (North)
        '17': -math.pi / 4,        # CS (North-East)
        '12': 0,                   # Humanities (East)
        '33': math.pi / 4,         # Social Sci (South-East)
        '27': math.pi / 2,         # Medicine (South)
        '13': 3 * math.pi / 4,     # Biology (South-West)
        '16': math.pi,             # Chemistry (West)
        '31': -3 * math.pi / 4     # Physics (North-West)
    }
    
    # Lat/Lon for 3D Globe - evenly spaced across globe
    field_lat_lon = {
        '26': (55, 0),             # Math
        '17': (35, 60),            # CS
        '12': (10, 120),           # Humanities
        '33': (-25, 80),           # Social Sci
        '27': (-50, 0),            # Medicine
        '13': (-25, -80),          # Biology
        '16': (10, -120),          # Chemistry
        '31': (35, -60)            # Physics
    }
    
    rng = random.Random(42)
    node_map = {}
    
    processed_nodes = []
    for n in nodes:
        fid = n['field_id']
        stats = field_stats[fid]
        cites = max(1, n['citations'])
        
        # Normalized power-law radius: 4.5 to 70.0 px
        c_log = math.log10(cites)
        frac = (c_log - stats['min_log']) / max(1e-4, stats['max_log'] - stats['min_log'])
        frac = max(0.0, min(1.0, frac))
        r = 4.5 + 65.0 * math.pow(frac, 1.35)
        
        # 2D Anchor coordinates: COMPACT (radius ~260px, NO HOLLOW CENTER!)
        ang_base = field_2d_angles[fid]
        ang = ang_base + (rng.random() - 0.5) * 0.5
        dist_2d = 120 + rng.random() * 200  # 120px to 320px: smoothly fills from near center outward!
        anchor_x_2d = math.cos(ang) * dist_2d
        anchor_y_2d = math.sin(ang) * dist_2d
        
        # INITIAL 2D POSITION: Uniform dense disc around center, NO artificial petals!
        init_angle = rng.random() * math.pi * 2
        init_dist = math.sqrt(rng.random()) * 260
        init_x = math.cos(init_angle) * init_dist
        init_y = math.sin(init_angle) * init_dist
        
        # 3D Spheroidal coordinates (lat/lon in radians)
        lat_base, lon_base = field_lat_lon[fid]
        lat = math.radians(lat_base + (rng.random() - 0.5) * 35)
        lon = math.radians(lon_base + (rng.random() - 0.5) * 45)
        
        # Unit vector on sphere (R=1)
        x_sph = math.cos(lat) * math.sin(lon)
        y_sph = math.sin(lat)
        z_sph = math.cos(lat) * math.cos(lon)
        
        # Normalize unit vector
        vlen = math.hypot(x_sph, y_sph, z_sph) or 1.0
        x_sph /= vlen
        y_sph /= vlen
        z_sph /= vlen
        
        node_entry = {
            'id': n['id'],
            'title': n['title'],
            'year': n['year'],
            'citations': n['citations'],
            'field_id': fid,
            'field_name': n['field_name'],
            'color': n['color'],
            'r': round(r, 1),
            'mass': round(math.pow(r, 1.8) + 1.0, 1),
            # 2D anchors & compact start
            'anchorX': round(anchor_x_2d, 1),
            'anchorY': round(anchor_y_2d, 1),
            'initX': round(init_x, 1),
            'initY': round(init_y, 1),
            # 3D Spherical unit vectors & individual dispersed anchors
            'sx': round(x_sph, 4),
            'sy': round(y_sph, 4),
            'sz': round(z_sph, 4),
            'anchor_sx': round(x_sph, 4),
            'anchor_sy': round(y_sph, 4),
            'anchor_sz': round(z_sph, 4),
            'connections': []
        }
        processed_nodes.append(node_entry)
        node_map[n['id']] = node_entry
        
    # Populate connection IDs
    for e in edges:
        s = node_map.get(e['source'])
        t = node_map.get(e['target'])
        if s and t:
            if t['id'] not in s['connections']:
                s['connections'].append(t['id'])
            if s['id'] not in t['connections']:
                t['connections'].append(s['id'])
                
    # Zones for 2D ambient fields (compact centroid ~240px)
    zones = []
    for f in fields:
        fid = f['id']
        ang = field_2d_angles[fid]
        lat_base, lon_base = field_lat_lon[fid]
        lat = math.radians(lat_base)
        lon = math.radians(lon_base)
        zones.append({
            'id': fid,
            'name': f['name'],
            'color': f['color'],
            'cx': round(math.cos(ang) * 240, 1),
            'cy': round(math.sin(ang) * 240, 1),
            # Spherical center
            'sx': round(math.cos(lat) * math.sin(lon), 4),
            'sy': round(math.sin(lat), 4),
            'sz': round(math.cos(lat) * math.cos(lon), 4)
        })
        
    out_path = "public/global_data.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            'zones': zones,
            'nodes': processed_nodes,
            'edges': edges
        }, f, ensure_ascii=False)
        
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Saved {out_path} ({size_mb:.2f} MB, {len(processed_nodes)} nodes, {len(edges)} edges)")

if __name__ == '__main__':
    main()
