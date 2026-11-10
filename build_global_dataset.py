import urllib.request
import json
import time
import os
from collections import defaultdict

FIELDS = [
    {
        "id": "26",
        "name": "Mathematics",
        "color": "#4e9fff",
        "lat": 65,  # North
        "lon": 0
    },
    {
        "id": "17",
        "name": "Computer Science",
        "color": "#38d9a9",
        "lat": 45,
        "lon": 45
    },
    {
        "id": "31",
        "name": "Physics & Astronomy",
        "color": "#a78bfa",
        "lat": 45,
        "lon": -45
    },
    {
        "id": "16",
        "name": "Chemistry & Materials",
        "color": "#f59e0b",
        "lat": 0,
        "lon": -90
    },
    {
        "id": "13",
        "name": "Biology & Genetics",
        "color": "#10b981",
        "lat": -20,
        "lon": -135
    },
    {
        "id": "27",
        "name": "Medicine",
        "color": "#ef4444",
        "lat": -45,
        "lon": 180
    },
    {
        "id": "33",
        "name": "Social Sciences",
        "color": "#f97316",
        "lat": -20,
        "lon": 90
    },
    {
        "id": "12",
        "name": "Arts & Humanities",
        "color": "#ec4899",
        "lat": 25,
        "lon": 135
    }
]

def fetch_field_papers(field_id, target_count=1250):
    papers = []
    page = 1
    per_page = 200
    
    while len(papers) < target_count:
        fetch_n = min(per_page, target_count - len(papers))
        url = (
            f"https://api.openalex.org/works?"
            f"filter=primary_topic.field.id:https://openalex.org/fields/{field_id},is_paratext:false"
            f"&sort=cited_by_count:desc"
            f"&per_page={fetch_n}&page={page}"
            f"&select=id,doi,title,publication_year,cited_by_count,primary_topic,referenced_works"
        )
        
        req = urllib.request.Request(url, headers={'User-Agent': 'mailto:sci_globe@example.org'})
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                results = data.get('results', [])
                if not results:
                    break
                papers.extend(results)
                print(f"  Field {field_id} page {page}: fetched {len(results)} (total: {len(papers)})")
                if len(results) < fetch_n:
                    break
                page += 1
                time.sleep(0.08)
        except Exception as e:
            print(f"  Error fetching page {page} for field {field_id}: {e}")
            time.sleep(1)
            break
            
    return papers[:target_count]

def main():
    os.makedirs("data", exist_ok=True)
    all_nodes = []
    paper_id_map = {}
    
    print("=== Fetching Global Science Dataset (8 Fields x 1,250 = 10,000 papers) ===")
    
    for f in FIELDS:
        print(f"\nFetching {f['name']} (Field {f['id']})...")
        papers = fetch_field_papers(f['id'], target_count=1250)
        
        for p in papers:
            full_id = p.get('id', '')
            short_id = full_id.split('/')[-1]
            title = p.get('title') or 'Untitled'
            cites = p.get('cited_by_count') or 0
            year = p.get('publication_year') or 2000
            refs = [r.split('/')[-1] for r in p.get('referenced_works', [])]
            
            node = {
                'id': short_id,
                'full_id': full_id,
                'title': title,
                'year': year,
                'citations': cites,
                'field_id': f['id'],
                'field_name': f['name'],
                'color': f['color'],
                'lat': f['lat'],
                'lon': f['lon'],
                'references': refs
            }
            all_nodes.append(node)
            paper_id_map[short_id] = node

    print(f"\nTotal papers collected: {len(all_nodes)}")
    
    # Extract Direct Citations
    dataset_ids = set(paper_id_map.keys())
    direct_edges = []
    
    for n in all_nodes:
        for ref_id in n['references']:
            if ref_id in dataset_ids:
                direct_edges.append({
                    'source': n['id'],
                    'target': ref_id,
                    'type': 'direct_citation',
                    'weight': 1.0
                })
                
    print(f"Direct intra-dataset citation edges: {len(direct_edges)}")
    
    # Bibliographic coupling for inter-field bridges
    print("Calculating bibliographic coupling...")
    ref_to_citing = defaultdict(list)
    for n in all_nodes:
        for ref in n['references']:
            ref_to_citing[ref].append(n['id'])
            
    pair_shared = defaultdict(int)
    for ref, citing_list in ref_to_citing.items():
        if 2 <= len(citing_list) <= 30:
            for i in range(len(citing_list)):
                for j in range(i + 1, len(citing_list)):
                    u = citing_list[i]
                    v = citing_list[j]
                    if u > v:
                        u, v = v, u
                    pair_shared[(u, v)] += 1
                    
    coupling_edges = []
    for (u, v), count in pair_shared.items():
        if count >= 3:
            u_node = paper_id_map[u]
            v_node = paper_id_map[v]
            is_cross = (u_node['field_id'] != v_node['field_id'])
            w = count if not is_cross else count * 1.5
            coupling_edges.append({
                'source': u,
                'target': v,
                'type': 'bib_coupling',
                'weight': round(w, 2),
                'shared_refs': count
            })
            
    print(f"Bibliographic coupling edges: {len(coupling_edges)}")
    
    # Combine & prune edges (max 12 connections per node to keep physics nimble)
    node_adj = defaultdict(list)
    for e in direct_edges + coupling_edges:
        node_adj[e['source']].append(e)
        node_adj[e['target']].append(e)
        
    final_edges_set = set()
    final_edges = []
    
    for nid, conn in node_adj.items():
        sorted_conn = sorted(conn, key=lambda x: x['weight'], reverse=True)[:10]
        for e in sorted_conn:
            pair = tuple(sorted([e['source'], e['target']]))
            if pair not in final_edges_set:
                final_edges_set.add(pair)
                final_edges.append(e)
                
    print(f"Final pruned graph edges: {len(final_edges)}")
    
    out_path = "data/global_dataset.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            'fields': FIELDS,
            'nodes': all_nodes,
            'edges': final_edges
        }, f, ensure_ascii=False)
        
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"Saved {out_path} ({size_mb:.2f} MB)")

if __name__ == '__main__':
    main()

