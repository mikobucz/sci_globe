//! sci_globe Headless Simulation Lab & CLI Diagnostic Runner (`sci_globe-cli`).
//!
//! Usage examples:
//!   cargo run --release --bin sci_globe-cli
//!   cargo run --release --bin sci_globe-cli -- --dataset global --sample 1000 --preset pure --only-connected
//!   cargo run --release --bin sci_globe-cli -- --dataset global --sample 1000 --anchor 0.0 --cohesion 0.35 --nebula 0.4 --ghost 0.45
//!   cargo run --release --bin sci_globe-cli -- --dump-json /tmp/report.json

use sci_globe::diagnostics::{
    analyze_islands, analyze_layout, apply_preset, load_custom_presets_file,
    load_scenario_from_file, run_profiled_simulation,
};
use sci_globe::engine::SimParams;
use std::env;
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();

    let mut dataset: Option<String> = None;
    let mut sample_count: Option<usize> = None;
    let mut dataset_seed: Option<u32> = None;
    let mut scramble_seed: Option<u32> = None;
    let mut only_connected: Option<bool> = None;
    let mut preset = "anchors".to_string();
    let mut inspect_count = 4usize;
    let mut show_islands = false;
    let mut min_island_size = 4usize;
    let mut dump_json: Option<String> = None;
    let mut save_map: Option<String> = None;

    let mut params = SimParams::default();
    let mut custom_overrides: Vec<(String, f32)> = Vec::new();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--list-presets" => {
                println!("Built-in presets: anchors, pure, cohesion, nebula, gravity, tight");
                let custom = load_custom_presets_file("public/presets.json");
                if custom.is_empty() {
                    println!("Custom presets (public/presets.json): [none saved yet]");
                } else {
                    println!("Custom presets (public/presets.json):");
                    for (name, snap) in &custom {
                        println!("  - \"{}\" -> {:?}", name, snap);
                    }
                }
                return;
            }
            "--list-maps" => {
                println!("\nWYGENEROWANE MAPY (public/generated_maps.json):");
                println!("========================================================================================================================");
                if let Ok(content) = fs::read_to_string("public/generated_maps.json") {
                    if let Ok(maps) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(arr) = maps.as_array() {
                            for m in arr {
                                let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("-");
                                let name = m.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                                let pr = m.get("preset").and_then(|v| v.as_str()).unwrap_or("-");
                                let n = m.get("sampleCount").and_then(|v| v.as_u64()).unwrap_or(0);
                                let d_seed = m.get("datasetSeed").and_then(|v| v.as_u64()).unwrap_or(0);
                                let s_seed = m.get("scrambleSeed").and_then(|v| v.as_u64()).unwrap_or(0);
                                let time = m.get("computeTime").and_then(|v| v.as_str()).unwrap_or("-");
                                let purity = m.get("metrics").and_then(|x| x.get("knnPurity")).and_then(|v| v.as_str()).unwrap_or("-");
                                println!(
                                    "  * [{:<26}] Prace: {:<5} | Preset: {:<16} | DatasetSeed: {:<5} | ScrambleSeed: {:<7} | Czas: {:<7} | KNN: {}",
                                    name, n, pr, d_seed, s_seed, time, purity
                                );
                            }
                        }
                    }
                }
                println!("========================================================================================================================");
                return;
            }
            "--save-map" if i + 1 < args.len() => {
                save_map = Some(args[i + 1].clone());
                i += 2;
            }
            "--dataset" if i + 1 < args.len() => {
                dataset = Some(args[i + 1].clone());
                i += 2;
            }
            "--sample" if i + 1 < args.len() => {
                sample_count = args[i + 1].parse().ok();
                i += 2;
            }
            "--dataset-seed" if i + 1 < args.len() => {
                dataset_seed = args[i + 1].parse().ok();
                i += 2;
            }
            "--seed" | "--scramble-seed" if i + 1 < args.len() => {
                scramble_seed = args[i + 1].parse().ok();
                i += 2;
            }
            "--only-connected" => {
                only_connected = Some(true);
                i += 1;
            }
            "--all-nodes" => {
                only_connected = Some(false);
                i += 1;
            }
            "--preset" if i + 1 < args.len() => {
                preset = args[i + 1].clone();
                i += 2;
            }
            "--inspect" if i + 1 < args.len() => {
                inspect_count = args[i + 1].parse().unwrap_or(4);
                i += 2;
            }
            "--islands" => {
                show_islands = true;
                i += 1;
            }
            "--min-island" if i + 1 < args.len() => {
                show_islands = true;
                min_island_size = args[i + 1].parse().unwrap_or(4);
                i += 2;
            }
            "--dump-json" if i + 1 < args.len() => {
                dump_json = Some(args[i + 1].clone());
                i += 2;
            }
            "--anchor" | "--cohesion" | "--ghost" | "--nebula" | "--nebula-cut" | "--spring" | "--deg-norm"
            | "--bridge" | "--scale" | "--margin"
                if i + 1 < args.len() =>
            {
                let key = args[i].clone();
                let val: f32 = args[i + 1].parse().unwrap_or(0.0);
                custom_overrides.push((key, val));
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let saved_snap = apply_preset(&mut params, &preset);
    for (k, v) in &custom_overrides {
        match k.as_str() {
            "--anchor" => params.anchor_strength = *v,
            "--cohesion" => params.subfield_cohesion = *v,
            "--ghost" => params.ghost_annealing = *v,
            "--nebula" => params.nebula_repulsion = *v,
            "--nebula-cut" => params.nebula_cutoff = *v,
            "--spring" => params.spring_stiffness = *v,
            "--deg-norm" => params.degree_norm = *v,
            "--bridge" => params.bridge_mult = *v,
            "--scale" => params.radius_scale = *v,
            "--margin" => params.collision_margin = *v,
            _ => {}
        }
    }

    let final_dataset = dataset
        .or_else(|| saved_snap.as_ref().and_then(|s| s.dataset.clone()))
        .unwrap_or_else(|| "global".to_string());
    let final_sample = sample_count
        .or_else(|| saved_snap.as_ref().and_then(|s| s.sampleCount))
        .unwrap_or(1000);
    let final_ds_seed = dataset_seed
        .or_else(|| saved_snap.as_ref().and_then(|s| s.datasetSeed))
        .unwrap_or(1337);
    let final_only_conn = only_connected
        .or_else(|| saved_snap.as_ref().and_then(|s| s.onlyConnected))
        .unwrap_or(true);
    let final_scramble_seed = scramble_seed
        .or_else(|| saved_snap.as_ref().and_then(|s| s.scrambleSeed))
        .unwrap_or(42);

    let file_path = if final_dataset == "math" {
        "public/live_data.json"
    } else {
        "public/global_data.json"
    };

    let mut scen = load_scenario_from_file(
        file_path,
        final_sample,
        final_ds_seed,
        final_only_conn,
        true,
        params,
    )
    .expect("Failed to load scenario");

    scen.universe.scramble(final_scramble_seed, true);

    println!("================================================================================");
    println!(
        " SCI_GLOBE HEADLESS SIMULATION LAB | Dataset: {} | Nodes: {} | Edges: {}",
        file_path,
        scen.nodes.len(),
        scen.universe.edge_u.len()
    );
    println!(
        " Preset: '{}' | ds_seed={} | scramble_seed={} | only_connected={}",
        preset, final_ds_seed, final_scramble_seed, final_only_conn
    );
    println!(
        " Physics: anchor={:.2} cohesion={:.2} ghost={:.2} nebula={:.2} deg_norm={:.2}",
        scen.universe.params.anchor_strength,
        scen.universe.params.subfield_cohesion,
        scen.universe.params.ghost_annealing,
        scen.universe.params.nebula_repulsion,
        scen.universe.params.degree_norm
    );
    println!("================================================================================");

    let prof = run_profiled_simulation(&mut scen.universe, 1000);
    let rep = analyze_layout(&scen, prof, inspect_count);

    // 1. CPU Performance Breakdown
    let p = &rep.profile;
    let steps_f = p.steps_executed.max(1) as f64;
    let tot = p.total_us.max(1.0);
    println!(
        "\n[1] SUB-STEP CPU PROFILER ({} steps until T={:.4}, total {:.1} ms -> {:.0} FPS cap)",
        p.steps_executed,
        rep.final_temperature,
        tot / 1000.0,
        1e6 / (tot / steps_f)
    );
    println!("--------------------------------------------------------------------------------");
    println!(
        "  - Centroids & Anchors   : {:7.1} us/step ({:5.1}%)",
        p.anchors_cohesion_us / steps_f,
        p.anchors_cohesion_us * 100.0 / tot
    );
    println!(
        "  - Nebula Repulsion      : {:7.1} us/step ({:5.1}%)",
        p.nebula_repulsion_us / steps_f,
        p.nebula_repulsion_us * 100.0 / tot
    );
    println!(
        "  - Citation Springs      : {:7.1} us/step ({:5.1}%)",
        p.citation_springs_us / steps_f,
        p.citation_springs_us * 100.0 / tot
    );
    println!(
        "  - Riemann Integration   : {:7.1} us/step ({:5.1}%)",
        p.riemann_integration_us / steps_f,
        p.riemann_integration_us * 100.0 / tot
    );
    println!(
        "  - SpatialGrid3D Rebuild : {:7.1} us/step ({:5.1}%)",
        p.grid_rebuild_us / steps_f,
        p.grid_rebuild_us * 100.0 / tot
    );
    println!(
        "  - PBD / XPBD Collisions : {:7.1} us/step ({:5.1}%)",
        p.pbd_collisions_us / steps_f,
        p.pbd_collisions_us * 100.0 / tot
    );
    println!(
        "  = TOTAL PER STEP        : {:7.1} us/step (100.0%)",
        tot / steps_f
    );

    // 2. Topological & Spatial Quality Scorecard
    println!("\n[2] TOPOLOGICAL & SPATIAL QUALITY SCORECARD");
    println!("--------------------------------------------------------------------------------");
    println!(
        "  * Spatial 10-NN Field Purity (All nodes)      : {:5.1}%",
        rep.knn_field_purity_pct
    );
    println!(
        "  * Internal Papers Purity (Continent interior) : {:5.1}%",
        rep.internal_node_purity_pct
    );
    println!(
        "  * Bridge Papers Purity   (Coastline border)   : {:5.1}% (lower = sits on border!)",
        rep.bridge_node_purity_pct
    );
    println!(
        "  * Mean Geodesic Distance (Cited vs Random)    : {:5.1} deg vs {:5.1} deg",
        rep.mean_connected_angle_deg, rep.mean_random_angle_deg
    );
    println!(
        "  * Cited Pairs within <= 25 deg on Globe       : {:5.1}%",
        rep.citations_within_25deg_pct
    );
    println!(
        "  * Spatial 10-NN that are 1-hop/2-hop Citations: {:5.1}%",
        rep.knn_citation_1hop_or_2hop_pct
    );
    println!(
        "  * Trapped / Jammed Foreign Outliers           : {} / {} ({:.2}%)",
        rep.trapped_count, rep.node_count, rep.trapped_pct
    );
    if !rep.trapped_examples.is_empty() {
        for t in &rep.trapped_examples {
            println!(
                "      -> [idx={}] '{}' ({}, deg={}) trapped inside {} at (lat={:.1}, lon={:.1})",
                t.idx, t.title, t.own_field, t.degree, t.dominant_neighbor_field, t.lat_deg, t.lon_deg
            );
        }
    }

    // 3. Circle Packing & Fish-Scale Overlap Audit
    println!("\n[3] CIRCLE PACKING & OVERLAP AUDIT ('Fish-Scale' Diagnostics)");
    println!("--------------------------------------------------------------------------------");
    println!(
        "  * Physical 3D Sphere Overlapping Pairs        : {} pairs (mean={:.2}px, max={:.2}px)",
        rep.physical_overlapping_pairs, rep.mean_overlap_px, rep.max_overlap_px
    );
    println!(
        "  * 2D Screen Foreshortening Overlaps (z > 0.1) : {} pairs (orthographic horizon effect)",
        rep.screen_foreshortened_overlaps
    );

    // 4. Continent Fragmentation per Discipline
    println!("\n[4] CONTINENT COHESION BY DISCIPLINE");
    println!("--------------------------------------------------------------------------------");
    for d in &rep.discipline_continents {
        println!(
            "  * {:<28} : {:4} papers | {:2} islands | {:5.1}% in main continent",
            d.field_name, d.node_count, d.island_count, d.main_continent_share_pct
        );
    }

    // 5. Coordinate & Spatial Neighborhood Inspector
    println!("\n[5] SPATIAL COORDINATE & NEIGHBORHOOD INSPECTOR");
    println!("--------------------------------------------------------------------------------");
    for ins in &rep.inspections {
        println!(
            "  NODE [{}] ({}) '{}' | {} | cites={:.0} | deg={}",
            ins.idx, ins.role, ins.title, ins.field_name, ins.citations, ins.degree
        );
        println!(
            "    Coords: sx={:.3}, sy={:.3}, sz={:.3} (lat={:+.1} deg, lon={:+.1} deg)",
            ins.sx, ins.sy, ins.sz, ins.lat_deg, ins.lon_deg
        );
        for nb in &ins.neighbors {
            let rel = if nb.is_direct_citation {
                "[1-HOP CITED]"
            } else if nb.is_two_hop {
                "[2-HOP CO-CITED]"
            } else {
                "[SPATIAL ONLY]"
            };
            let f_tag = if nb.same_field { "SAME-FIELD" } else { "FOREIGN   " };
            println!(
                "      -> {:5.1} deg | {} | {:<16} | '{}' ({})",
                nb.dist_deg, f_tag, rel, nb.title, nb.field_name
            );
        }
    }

    if show_islands {
        let islands = analyze_islands(&scen, min_island_size);
        println!(
            "\n[6] BOTTOM-UP ISLAND CARTOGRAPHER (Islands with >= {} papers: {} found)",
            min_island_size,
            islands.len()
        );
        println!("================================================================================");
        for isl in &islands {
            println!(
                "  ISLAND [{} #{}] | {} papers ({} isolated) | Center: (lat={:+.1} deg, lon={:+.1} deg, r={:.1} deg)",
                isl.field_name,
                isl.island_rank,
                isl.node_count,
                isl.isolated_nodes,
                isl.center_lat_deg,
                isl.center_lon_deg,
                isl.radius_deg
            );
            println!(
                "    * Emergent Topic (TF-IDF) : [{}]",
                isl.keywords_tfidf.join(", ")
            );
            println!(
                "    * Citation Structure      : {} internal edges ({:.1}% same-field retention) | {} to other {} islands | {} cross-field (Top: {})",
                isl.internal_edges,
                isl.internal_retention_pct,
                isl.external_same_field_edges,
                isl.field_name,
                isl.external_cross_field_edges,
                isl.top_foreign_partner
            );
            for p in &isl.core_papers {
                println!(
                    "      -> [#{:<4} | in_deg={:2}, tot_deg={:2} | {:6.0} cites] '{}' ({})",
                    p.idx, p.internal_deg, p.total_deg, p.citations, p.title, p.year
                );
            }
            if !isl.closest_foreign_neighbors.is_empty() {
                println!("    * Closest Foreign Neighbors on Globe:");
                for nb in &isl.closest_foreign_neighbors {
                    if let Some((ua, ref ta, ub, ref tb)) = nb.sample_bridge_pair {
                        let link_tag = if nb.citation_bridges > 0 {
                            format!("{} direct citation bridges", nb.citation_bridges)
                        } else {
                            "0 bridges (coastal contact)".to_string()
                        };
                        println!(
                            "      ~> [{} #{}] (border gap={:.1} deg | {}) e.g. [#{}] '{}' <-> [#{}] '{}'",
                            nb.foreign_field,
                            nb.foreign_island_rank,
                            nb.min_border_gap_deg,
                            link_tag,
                            ua,
                            ta,
                            ub,
                            tb
                        );
                    }
                }
            }
            println!("--------------------------------------------------------------------------------");
        }
    }

    if let Some(json_path) = dump_json {
        if let Ok(serialized) = serde_json::to_string_pretty(&rep) {
            let _ = fs::write(&json_path, serialized);
            println!("\n[Saved full JSON diagnostic report to {}]", json_path);
        }
    }

    if let Some(map_name) = save_map {
        let elapsed_sec = rep.profile.total_us / 1_000_000.0;
        let fps = if rep.profile.total_us > 0.0 {
            (rep.profile.steps_executed as f64) / elapsed_sec
        } else {
            0.0
        };
        let map_id = format!("map_{}_{}", scen.nodes.len(), final_scramble_seed);

        let mut positions = serde_json::Map::with_capacity(scen.nodes.len());
        let round6 = |v: f32| -> f64 { ((v as f64) * 1_000_000.0).round() / 1_000_000.0 };
        for node in &scen.nodes {
            let idx = node.idx;
            positions.insert(
                node.id.clone(),
                serde_json::json!([
                    round6(scen.universe.sx[idx]),
                    round6(scen.universe.sy[idx]),
                    round6(scen.universe.sz[idx])
                ]),
            );
        }

        let up = &scen.universe.params;
        let snapshot_rel = format!("generated/{}.json", map_id);
        let snapshot_disk = format!("public/{}", snapshot_rel);
        let snapshot_payload = serde_json::json!({
            "version": 1,
            "dataset": final_dataset,
            "sampleCount": scen.nodes.len(),
            "onlyConnected": final_only_conn,
            "globeRadius": scen.universe.globe_radius,
            "params": {
                "radiusScale": up.radius_scale,
                "anchorStrength": up.anchor_strength,
                "subfieldCohesion": up.subfield_cohesion,
                "ghostAnnealing": up.ghost_annealing,
                "nebulaRepulsion": up.nebula_repulsion,
                "nebulaCutoff": up.nebula_cutoff,
                "centerGravity": up.center_gravity,
                "giantGravity": up.giant_gravity,
                "springStiffness": up.spring_stiffness,
                "degreeNorm": up.degree_norm,
                "bridgeMult": up.bridge_mult,
                "springGap": up.spring_gap,
                "sizeExponent": up.size_exponent,
                "massExponent": up.mass_exponent,
                "collisionMargin": up.collision_margin,
                "globeRadius": scen.universe.globe_radius
            },
            "positions": positions
        });

        let _ = fs::create_dir_all("public/generated");
        let snapshot_saved = serde_json::to_string(&snapshot_payload)
            .ok()
            .and_then(|s| fs::write(&snapshot_disk, s).ok())
            .is_some();

        let mut new_entry = serde_json::json!({
            "id": map_id,
            "name": map_name,
            "preset": preset,
            "dataset": final_dataset,
            "sampleCount": scen.nodes.len(),
            "datasetSeed": final_ds_seed,
            "scrambleSeed": final_scramble_seed,
            "onlyConnected": final_only_conn,
            "globeRadius": scen.universe.globe_radius,
            "computeTime": format!("{:.1}s", elapsed_sec),
            "source": "Terminal CLI (sci_globe-cli)",
            "timestamp": "CLI run",
            "metrics": {
                "knnPurity": format!("{:.1}%", rep.knn_field_purity_pct),
                "trappedPct": format!("{:.2}%", rep.trapped_pct),
                "fps": format!("{:.1}", fps)
            }
        });
        if snapshot_saved {
            if let Some(obj) = new_entry.as_object_mut() {
                obj.insert("snapshotFile".to_string(), serde_json::Value::String(snapshot_rel));
            }
        }

        let mut maps_list: Vec<serde_json::Value> = Vec::new();
        if let Ok(content) = fs::read_to_string("public/generated_maps.json") {
            if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str(&content) {
                maps_list = arr;
            }
        }
        maps_list.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(&map_id));
        maps_list.insert(0, new_entry);
        if let Ok(serialized) = serde_json::to_string_pretty(&maps_list) {
            let _ = fs::write("public/generated_maps.json", serialized);
            println!("\n[Zapisano mape do public/generated_maps.json pod nazwa: '{}']", map_name);
            if snapshot_saved {
                println!("[Zapisano gotowy stan wspolrzednych do {}]", snapshot_disk);
            }
        }
    }
}
