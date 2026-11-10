#!/usr/bin/env python3
"""
sci_globe - Dataset Builder
Pobiera próbkę najważniejszych prac z 10 głównych subfieldów matematyki z OpenAlex API,
buduje graf cytowań oraz powiązań bibliograficznych (wspólne referencje) i zapisuje do JSON.
"""

import os
import json
import time
import urllib.request
import urllib.error

# 10 oficjalnych subfieldów matematyki w OpenAlex (Field 26: Mathematics)
SUBFIELDS = [
    {"id": "2602", "name": "Algebra and Number Theory"},
    {"id": "2608", "name": "Geometry and Topology"},
    {"id": "2607", "name": "Discrete Mathematics and Combinatorics"},
    {"id": "2610", "name": "Mathematical Physics"},
    {"id": "2613", "name": "Statistics and Probability"},
    {"id": "2614", "name": "Theoretical Computer Science"},
    {"id": "2604", "name": "Applied Mathematics"},
    {"id": "2612", "name": "Numerical Analysis"},
    {"id": "2605", "name": "Computational Mathematics"},
    {"id": "2611", "name": "Modeling and Simulation"},
]

PAPERS_PER_SUBFIELD = 100  # 10 subfieldów * 100 = 1 000 prac w MVP
OUTPUT_DIR = "data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "math_dataset.json")

def clean_id(openalex_url):
    """Zmienia 'https://openalex.org/W12345' na 'W12345' dla oszczędności pamięci."""
    if not openalex_url:
        return ""
    return openalex_url.split("/")[-1]

def fetch_subfield_papers(subfield_id, subfield_name, count=100):
    """Pobiera najbardziej wpływowe prace dla danej poddziedziny z OpenAlex."""
    url = (
        f"https://api.openalex.org/works?"
        f"filter=primary_topic.subfield.id:{subfield_id},has_references:true,from_publication_date:1990-01-01"
        f"&sort=cited_by_count:desc"
        f"&per-page={count}"
        f"&mailto=sci_globe_dev@example.com"
    )
    
    req = urllib.request.Request(url, headers={"User-Agent": "sci_globe/1.0"})
    
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            return data.get("results", [])
    except urllib.error.URLError as e:
        print(f"Błąd pobierania {subfield_name}: {e}")
        return []

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("=== sci_globe: Budowanie zbioru danych z OpenAlex API ===")
    print(f"Pobieranie {PAPERS_PER_SUBFIELD} prac dla każdego z {len(SUBFIELDS)} subfieldów...\n")

    papers_by_id = {}
    
    start_time = time.time()
    for sf in SUBFIELDS:
        sf_id = sf["id"]
        sf_name = sf["name"]
        print(f"-> Pobieranie: {sf_name} (subfields/{sf_id})...", end="", flush=True)
        
        results = fetch_subfield_papers(sf_id, sf_name, count=PAPERS_PER_SUBFIELD)
        added = 0
        for w in results:
            w_id = clean_id(w.get("id"))
            if not w_id or w_id in papers_by_id:
                continue
            
            topic = w.get("primary_topic") or {}
            
            papers_by_id[w_id] = {
                "id": w_id,
                "title": w.get("title") or "Bez tytułu",
                "year": w.get("publication_year"),
                "citations": w.get("cited_by_count", 0),
                "subfield_id": sf_id,
                "subfield_name": sf_name,
                "topic_name": topic.get("display_name", "Ogólne"),
                "references": [clean_id(ref) for ref in w.get("referenced_works", [])]
            }
            added += 1
            
        print(f" pobrano {added} prac.")
        time.sleep(0.15)  # Uprzejme tempo zapytań

    nodes = list(papers_by_id.values())
    node_id_set = set(papers_by_id.keys())
    print(f"\nŁącznie unikalnych prac w bazie: {len(nodes):,}")

    # 1. Krawędzie bezpośrednie (kto kogo cytuje wewnątrz zbioru)
    direct_edges = []
    for paper in nodes:
        u = paper["id"]
        for ref_id in paper["references"]:
            if ref_id in node_id_set:
                direct_edges.append({"source": u, "target": ref_id, "type": "direct"})

    # 2. Powiązania bibliograficzne (Bibliographic Coupling)
    # Dwa papiery łączymy, jeśli cytują te same prace (nawet z zewnątrz!)
    print("Obliczanie wspólnych referencji (Bibliographic Coupling)...")
    
    # Indeks odwrócony: referencja -> lista prac z naszego zbioru, które ją cytują
    ref_to_papers = {}
    for paper in nodes:
        u = paper["id"]
        for ref_id in paper["references"]:
            if ref_id not in ref_to_papers:
                ref_to_papers[ref_id] = []
            ref_to_papers[ref_id].append(u)

    # Zliczamy wspólne referencje dla każdej pary prac
    pair_weights = {}
    for ref_id, citing_papers in ref_to_papers.items():
        if len(citing_papers) < 2:
            continue
        # Jeśli więcej niż 50 prac cytuje tę samą rzecz, to zbyt powszechna referencja (szum)
        if len(citing_papers) > 50:
            continue
            
        for i in range(len(citing_papers)):
            for j in range(i + 1, len(citing_papers)):
                pair = tuple(sorted([citing_papers[i], citing_papers[j]]))
                pair_weights[pair] = pair_weights.get(pair, 0) + 1

    # Zachowujemy krawędzie o co najmniej 2 wspólnych referencjach
    coupling_edges = []
    cross_subfield_bridges = 0
    for (u, v), weight in pair_weights.items():
        if weight >= 2:
            is_cross = papers_by_id[u]["subfield_id"] != papers_by_id[v]["subfield_id"]
            if is_cross:
                cross_subfield_bridges += 1
            coupling_edges.append({
                "source": u,
                "target": v,
                "weight": weight,
                "type": "coupling",
                "is_cross_subfield": is_cross
            })

    print(f"Bezpośrednich krawędzi cytowań: {len(direct_edges):,}")
    print(f"Powiązań przez wspólne referencje: {len(coupling_edges):,}")
    print(f"W tym mostów łączących RÓŻNE kontynenty: {cross_subfield_bridges:,}")

    # Zapis do pliku
    dataset = {
        "metadata": {
            "total_nodes": len(nodes),
            "direct_edges_count": len(direct_edges),
            "coupling_edges_count": len(coupling_edges),
            "cross_subfield_bridges": cross_subfield_bridges,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S")
        },
        "subfields": SUBFIELDS,
        "nodes": nodes,
        "direct_edges": direct_edges,
        "coupling_edges": coupling_edges
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - start_time
    file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"\nSukces! Dane zapisane do '{OUTPUT_FILE}' ({file_size_mb:.2f} MB)")
    print(f"Czas wykonania: {elapsed:.2f} sekundy.")

if __name__ == "__main__":
    main()

