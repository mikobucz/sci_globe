import json
import math
import os
import random

INPUT_FILE = "data/math_dataset.json"
OUTPUT_FILE = "public/live_data.json"

SUBFIELD_CONFIG = {
    "2613": {"name": "Statistics & Probability", "color": "#facc15", "lat": -45, "lon": 0},
    "2614": {"name": "Theoretical Computer Science", "color": "#38bdf8", "lat": 45, "lon": 45},
    "2604": {"name": "Applied Mathematics", "color": "#f87171", "lat": 50, "lon": -45},
    "2612": {"name": "Numerical Analysis", "color": "#4ade80", "lat": 15, "lon": 90},
    "2607": {"name": "Computational Mathematics", "color": "#2dd4bf", "lat": 20, "lon": 135},
    "2611": {"name": "Modeling & Simulation", "color": "#fb923c", "lat": -15, "lon": -90},
    "2602": {"name": "Algebra & Number Theory", "color": "#e879f9", "lat": 60, "lon": 0},
    "2608": {"name": "Geometry & Topology", "color": "#a855f7", "lat": 30, "lon": -135},
    "2606": {"name": "Discrete Math & Combinatorics", "color": "#22d3ee", "lat": -20, "lon": 180},
    "2610": {"name": "Mathematical Physics", "color": "#c084fc", "lat": -55, "lon": -45}
}

def main():
    os.makedirs("public", exist_ok=True)
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    nodes = data["nodes"]
    edges = data["direct_edges"] + data["coupling_edges"]
    node_id_set = {n["id"] for n in nodes}

    # 1. Pozycje kotwic - COMPACT (promień 220px, bez pustej dziury w środku)
    subfield_ids = list(SUBFIELD_CONFIG.keys())
    anchors = {}
    radius = 220.0
    for i, sf_id in enumerate(subfield_ids):
        angle = (2.0 * math.pi * i) / len(subfield_ids)
        anchors[sf_id] = {
            "x": round(math.cos(angle) * radius, 1),
            "y": round(math.sin(angle) * radius, 1),
            "cx": round(math.cos(angle) * radius, 1),
            "cy": round(math.sin(angle) * radius, 1)
        }

    rng = random.Random(42)

    # 2. Obliczanie promieni i sferycznych wektorów jednostkowych
    live_nodes = []
    for node in nodes:
        cites = max(0, node.get("citations", 0))
        r = 4.5 + 0.95 * (cites ** 0.36)
        r = round(max(5.0, min(80.0, r)), 1)
        
        sf_id = node["subfield_id"]
        conf = SUBFIELD_CONFIG.get(sf_id, {"color": "#38bdf8", "name": "Inne", "lat": 0, "lon": 0})
        anchor = anchors.get(sf_id, {"x": 0, "y": 0})

        # Compact 2D initial position in center disc
        init_a = rng.random() * math.pi * 2
        init_d = math.sqrt(rng.random()) * 220
        init_x = math.cos(init_a) * init_d
        init_y = math.sin(init_a) * init_d

        # Sferyczne 3D unit vectors
        lat = math.radians(conf["lat"] + (rng.random() - 0.5) * 30)
        lon = math.radians(conf["lon"] + (rng.random() - 0.5) * 45)
        x_sph = math.cos(lat) * math.sin(lon)
        y_sph = math.sin(lat)
        z_sph = math.cos(lat) * math.cos(lon)
        vlen = math.hypot(x_sph, y_sph, z_sph) or 1.0

        live_nodes.append({
            "id": node["id"],
            "title": node["title"],
            "year": node["year"],
            "citations": cites,
            "subfield_id": sf_id,
            "subfield_name": conf["name"],
            "topic_name": node.get("topic_name", ""),
            "color": conf["color"],
            "r": r,
            "mass": round(r ** 1.8, 1),
            "anchorX": anchor["x"],
            "anchorY": anchor["y"],
            "initX": round(init_x, 1),
            "initY": round(init_y, 1),
            "sx": round(x_sph / vlen, 4),
            "sy": round(y_sph / vlen, 4),
            "sz": round(z_sph / vlen, 4),
            "anchor_sx": round(x_sph / vlen, 4),
            "anchor_sy": round(y_sph / vlen, 4),
            "anchor_sz": round(z_sph / vlen, 4),
            "connections": []
        })

    # 3. Krawędzie
    node_idx_map = {n["id"]: n for n in live_nodes}
    edge_pairs = set()
    live_edges = []

    for e in edges:
        u, v = e["source"], e["target"]
        if u in node_id_set and v in node_id_set and u != v:
            pair = tuple(sorted([u, v]))
            if pair not in edge_pairs:
                edge_pairs.add(pair)
                node_idx_map[u]["connections"].append(v)
                node_idx_map[v]["connections"].append(u)
                live_edges.append({
                    "source": u,
                    "target": v,
                    "weight": round(e.get("weight", 1.0), 2)
                })

    # 4. Strefy 2D i sferyczne
    zones = []
    for sf_id, conf in SUBFIELD_CONFIG.items():
        anc = anchors[sf_id]
        lat = math.radians(conf["lat"])
        lon = math.radians(conf["lon"])
        zones.append({
            "id": sf_id,
            "name": conf["name"],
            "color": conf["color"],
            "cx": anc["cx"],
            "cy": anc["cy"],
            "sx": round(math.cos(lat) * math.sin(lon), 4),
            "sy": round(math.sin(lat), 4),
            "sz": round(math.cos(lat) * math.cos(lon), 4)
        })

    output_data = {
        "zones": zones,
        "nodes": live_nodes,
        "edges": live_edges
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False)

    print(f"Wygenerowano {OUTPUT_FILE}: {len(live_nodes)} prac, {len(live_edges)} krawędzi.")

if __name__ == "__main__":
    main()
