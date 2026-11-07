//! Headless Simulation Lab, Sub-Step CPU Profiler, and Spatial/Topological Diagnostics
//! (Compiled only on native desktop targets; excluded from the browser .wasm binary).

use crate::engine::{Mulberry32, SimParams, Universe};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::Instant;

#[derive(Debug, Clone, Deserialize)]
pub struct RawZone {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub cx: f32,
    #[serde(default)]
    pub cy: f32,
    #[serde(default)]
    pub sx: f32,
    #[serde(default)]
    pub sy: f32,
    #[serde(default)]
    pub sz: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub struct RawNode {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub citations: f32,
    #[serde(default)]
    pub field_id: Option<String>,
    #[serde(default)]
    pub subfield_id: Option<String>,
    #[serde(default)]
    pub field_name: Option<String>,
    #[serde(default)]
    pub subfield_name: Option<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub initX: Option<f32>,
    #[serde(default)]
    pub initY: Option<f32>,
    #[serde(default)]
    pub anchorX: Option<f32>,
    #[serde(default)]
    pub anchorY: Option<f32>,
    #[serde(default)]
    pub sx: Option<f32>,
    #[serde(default)]
    pub sy: Option<f32>,
    #[serde(default)]
    pub sz: Option<f32>,
    #[serde(default)]
    pub anchor_sx: Option<f32>,
    #[serde(default)]
    pub anchor_sy: Option<f32>,
    #[serde(default)]
    pub anchor_sz: Option<f32>,
    #[serde(default)]
    pub connections: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawEdge {
    pub source: String,
    pub target: String,
    #[serde(default = "default_weight")]
    pub weight: f32,
}

fn default_weight() -> f32 {
    1.0
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawDataset {
    pub zones: Vec<RawZone>,
    pub nodes: Vec<RawNode>,
    pub edges: Vec<RawEdge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeMeta {
    pub idx: usize,
    pub id: String,
    pub title: String,
    pub year: i32,
    pub citations: f32,
    pub field_idx: u16,
    pub field_name: String,
}

pub struct LoadedScenario {
    pub universe: Universe,
    pub zones: Vec<RawZone>,
    pub nodes: Vec<NodeMeta>,
    pub adj: Vec<Vec<usize>>,
}

#[derive(Default, Debug, Clone, Serialize)]
pub struct StepProfile {
    pub steps_executed: u32,
    pub total_us: f64,
    pub anchors_cohesion_us: f64,
    pub nebula_repulsion_us: f64,
    pub citation_springs_us: f64,
    pub riemann_integration_us: f64,
    pub grid_rebuild_us: f64,
    pub pbd_collisions_us: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrappedNodeInfo {
    pub idx: usize,
    pub title: String,
    pub own_field: String,
    pub dominant_neighbor_field: String,
    pub degree: usize,
    pub foreign_neighbor_ratio: f32,
    pub lat_deg: f32,
    pub lon_deg: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DisciplineContinentStat {
    pub field_name: String,
    pub node_count: usize,
    pub island_count: usize,
    pub main_continent_share_pct: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct NeighborEntry {
    pub idx: usize,
    pub title: String,
    pub field_name: String,
    pub dist_deg: f32,
    pub same_field: bool,
    pub is_direct_citation: bool,
    pub is_two_hop: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoordinateInspection {
    pub idx: usize,
    pub id: String,
    pub title: String,
    pub field_name: String,
    pub citations: f32,
    pub degree: usize,
    pub role: String,
    pub sx: f32,
    pub sy: f32,
    pub sz: f32,
    pub lat_deg: f32,
    pub lon_deg: f32,
    pub neighbors: Vec<NeighborEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutDiagnosticReport {
    pub node_count: usize,
    pub edge_count: usize,
    pub final_temperature: f32,
    pub profile: StepProfile,
    // Spatial & Topological Sanity Metrics
    pub knn_field_purity_pct: f32,
    pub internal_node_purity_pct: f32,
    pub bridge_node_purity_pct: f32,
    pub mean_connected_angle_deg: f32,
    pub mean_random_angle_deg: f32,
    pub citations_within_25deg_pct: f32,
    pub knn_citation_1hop_or_2hop_pct: f32,
    // Jamming / Trapped Nodes
    pub trapped_count: usize,
    pub trapped_pct: f32,
    pub trapped_examples: Vec<TrappedNodeInfo>,
    // Circle Packing & Overlap Audit ("Fish-scale" analysis)
    pub physical_overlapping_pairs: usize,
    pub mean_overlap_px: f32,
    pub max_overlap_px: f32,
    pub screen_foreshortened_overlaps: usize,
    // Continent Fragmentation
    pub discipline_continents: Vec<DisciplineContinentStat>,
    // Sampled Coordinate Inspections
    pub inspections: Vec<CoordinateInspection>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[allow(non_snake_case)]
pub struct SavedPresetSnapshot {
    pub dataset: Option<String>,
    pub sampleCount: Option<usize>,
    pub datasetSeed: Option<u32>,
    pub scrambleSeed: Option<u32>,
    pub onlyConnected: Option<bool>,
    pub radiusScale: Option<f32>,
    pub anchorStrength: Option<f32>,
    pub subfieldCohesion: Option<f32>,
    pub ghostAnnealing: Option<f32>,
    pub nebulaRepulsion: Option<f32>,
    pub centerGravity: Option<f32>,
    pub giantGravity: Option<f32>,
    pub springStiffness: Option<f32>,
    pub degreeNorm: Option<f32>,
    pub bridgeMult: Option<f32>,
    pub springGap: Option<f32>,
    pub sizeExponent: Option<f32>,
    pub massExponent: Option<f32>,
    pub collisionMargin: Option<f32>,
    pub nebulaCutoff: Option<f32>,
}

pub fn load_custom_presets_file(path: &str) -> HashMap<String, SavedPresetSnapshot> {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, SavedPresetSnapshot>>(&raw) {
            return map;
        }
    }
    HashMap::new()
}

pub fn apply_saved_snapshot(params: &mut SimParams, snap: &SavedPresetSnapshot) {
    if let Some(v) = snap.radiusScale {
        params.radius_scale = v;
    }
    if let Some(v) = snap.anchorStrength {
        params.anchor_strength = v;
    }
    if let Some(v) = snap.subfieldCohesion {
        params.subfield_cohesion = v;
    }
    if let Some(v) = snap.ghostAnnealing {
        params.ghost_annealing = v;
    }
    if let Some(v) = snap.nebulaRepulsion {
        params.nebula_repulsion = v;
    }
    if let Some(v) = snap.centerGravity {
        params.center_gravity = v;
    }
    if let Some(v) = snap.giantGravity {
        params.giant_gravity = v;
    }
    if let Some(v) = snap.springStiffness {
        params.spring_stiffness = v;
    }
    if let Some(v) = snap.degreeNorm {
        params.degree_norm = v;
    }
    if let Some(v) = snap.bridgeMult {
        params.bridge_mult = v;
    }
    if let Some(v) = snap.springGap {
        params.spring_gap = v;
    }
    if let Some(v) = snap.sizeExponent {
        params.size_exponent = v;
    }
    if let Some(v) = snap.massExponent {
        params.mass_exponent = v;
    }
    if let Some(v) = snap.collisionMargin {
        params.collision_margin = v;
    }
    if let Some(v) = snap.nebulaCutoff {
        params.nebula_cutoff = v;
    }
}

pub fn apply_preset(params: &mut SimParams, preset: &str) -> Option<SavedPresetSnapshot> {
    let clean_name = preset.strip_prefix("custom:").unwrap_or(preset);
    let custom_map = load_custom_presets_file("public/presets.json");

    // 1. Check exact or case-insensitive match in public/presets.json
    if let Some(snap) = custom_map.get(clean_name).or_else(|| {
        custom_map
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(clean_name))
            .map(|(_, v)| v)
    }) {
        apply_saved_snapshot(params, snap);
        return Some(snap.clone());
    }

    // 2. Fallback to built-in presets
    match clean_name {
        "anchors" => {
            params.anchor_strength = 1.0;
            params.subfield_cohesion = 0.0;
            params.ghost_annealing = 0.0;
            params.nebula_repulsion = 0.0;
            params.center_gravity = 0.0012;
            params.giant_gravity = 0.0;
        }
        "pure" => {
            params.anchor_strength = 0.0;
            params.subfield_cohesion = 0.0;
            params.ghost_annealing = 0.35;
            params.nebula_repulsion = 0.0;
            params.center_gravity = 0.0008;
            params.giant_gravity = 0.0;
        }
        "cohesion" => {
            params.anchor_strength = 0.0;
            params.subfield_cohesion = 0.45;
            params.ghost_annealing = 0.5;
            params.nebula_repulsion = 0.6;
            params.center_gravity = 0.0006;
            params.giant_gravity = 0.0;
        }
        "nebula" => {
            params.anchor_strength = 0.0;
            params.subfield_cohesion = 0.1;
            params.ghost_annealing = 0.3;
            params.nebula_repulsion = 1.2;
            params.center_gravity = 0.0002;
            params.giant_gravity = 0.0;
        }
        "gravity" => {
            params.anchor_strength = 0.0;
            params.subfield_cohesion = 0.15;
            params.ghost_annealing = 0.25;
            params.nebula_repulsion = 0.2;
            params.center_gravity = 0.001;
            params.giant_gravity = 0.05;
        }
        "tight" => {
            params.anchor_strength = 0.0;
            params.subfield_cohesion = 0.0;
            params.ghost_annealing = 0.0;
            params.nebula_repulsion = 0.0;
            params.center_gravity = 0.0035;
            params.spring_stiffness = 0.06;
            params.giant_gravity = 0.0;
        }
        _ => {
            eprintln!(
                "[WARN] Unknown preset '{}'. Available custom presets in public/presets.json: {:?}",
                clean_name,
                custom_map.keys().collect::<Vec<_>>()
            );
        }
    }
    None
}

pub fn load_scenario_from_file(
    path: &str,
    sample_count: usize,
    dataset_seed: u32,
    only_connected: bool,
    is_globe: bool,
    params: SimParams,
) -> Result<LoadedScenario, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let raw: RawDataset =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in {}: {}", path, e))?;

    let mut rng = Mulberry32::new(dataset_seed);

    let mut candidate_pool: Vec<&RawNode> = if only_connected {
        raw.nodes
            .iter()
            .filter(|n| !n.connections.is_empty())
            .collect()
    } else {
        raw.nodes.iter().collect()
    };

    // Deterministic Fisher-Yates shuffle matching wasm_loader.js
    for i in (1..candidate_pool.len()).rev() {
        let j = (rng.next_f32() * ((i + 1) as f32)) as usize % (i + 1);
        candidate_pool.swap(i, j);
    }

    let target_count = sample_count.min(candidate_pool.len());
    let mut active_list: Vec<&RawNode> = candidate_pool[..target_count].to_vec();

    if only_connected {
        let mut sub_ids: HashSet<&str> = active_list.iter().map(|n| n.id.as_str()).collect();
        let mut connected_sub_ids: HashSet<&str> = HashSet::new();
        for e in &raw.edges {
            if sub_ids.contains(e.source.as_str()) && sub_ids.contains(e.target.as_str()) {
                connected_sub_ids.insert(e.source.as_str());
                connected_sub_ids.insert(e.target.as_str());
            }
        }

        if connected_sub_ids.len() < target_count && candidate_pool.len() > target_count {
            for &cand in &candidate_pool[target_count..] {
                if connected_sub_ids.len() >= target_count {
                    break;
                }
                if cand
                    .connections
                    .iter()
                    .any(|cid| sub_ids.contains(cid.as_str()))
                {
                    sub_ids.insert(cand.id.as_str());
                    active_list.push(cand);
                    for cid in &cand.connections {
                        if sub_ids.contains(cid.as_str()) {
                            connected_sub_ids.insert(cand.id.as_str());
                            connected_sub_ids.insert(cid.as_str());
                        }
                    }
                }
            }
        }

        active_list.retain(|n| connected_sub_ids.contains(n.id.as_str()));
    }

    let mut zone_map: HashMap<&str, usize> = HashMap::new();
    for (idx, z) in raw.zones.iter().enumerate() {
        zone_map.insert(z.id.as_str(), idx);
    }

    let n = active_list.len();
    let mut init_x = Vec::with_capacity(n);
    let mut init_y = Vec::with_capacity(n);
    let mut init_sx = Vec::with_capacity(n);
    let mut init_sy = Vec::with_capacity(n);
    let mut init_sz = Vec::with_capacity(n);
    let mut anchor_x = Vec::with_capacity(n);
    let mut anchor_y = Vec::with_capacity(n);
    let mut anchor_sx = Vec::with_capacity(n);
    let mut anchor_sy = Vec::with_capacity(n);
    let mut anchor_sz = Vec::with_capacity(n);
    let mut citations = Vec::with_capacity(n);
    let mut field_idx = Vec::with_capacity(n);
    let mut nodes_meta = Vec::with_capacity(n);
    let mut id_to_idx: HashMap<&str, usize> = HashMap::with_capacity(n);

    for (idx, node) in active_list.iter().enumerate() {
        let fid = node
            .field_id
            .as_deref()
            .or(node.subfield_id.as_deref())
            .unwrap_or("0");
        let z_idx = zone_map.get(fid).copied().unwrap_or(0);
        let z = raw.zones.get(z_idx);

        let x0 = node
            .initX
            .filter(|v| v.abs() < 1000.0)
            .unwrap_or_else(|| (rng.next_f32() - 0.5) * 300.0);
        let y0 = node
            .initY
            .filter(|v| v.abs() < 1000.0)
            .unwrap_or_else(|| (rng.next_f32() - 0.5) * 300.0);

        let mut sx0 = node.sx.unwrap_or_else(|| (rng.next_f32() - 0.5) * 2.0);
        let mut sy0 = node.sy.unwrap_or_else(|| (rng.next_f32() - 0.5) * 2.0);
        let mut sz0 = node.sz.unwrap_or_else(|| (rng.next_f32() - 0.5) * 2.0);
        let len = (sx0 * sx0 + sy0 * sy0 + sz0 * sz0).sqrt().max(1e-6);
        sx0 /= len;
        sy0 /= len;
        sz0 /= len;

        init_x.push(x0);
        init_y.push(y0);
        init_sx.push(sx0);
        init_sy.push(sy0);
        init_sz.push(sz0);

        anchor_x.push(node.anchorX.unwrap_or_else(|| z.map(|zv| zv.cx).unwrap_or(0.0)));
        anchor_y.push(node.anchorY.unwrap_or_else(|| z.map(|zv| zv.cy).unwrap_or(0.0)));
        anchor_sx.push(node.anchor_sx.unwrap_or_else(|| z.map(|zv| zv.sx).unwrap_or(sx0)));
        anchor_sy.push(node.anchor_sy.unwrap_or_else(|| z.map(|zv| zv.sy).unwrap_or(sy0)));
        anchor_sz.push(node.anchor_sz.unwrap_or_else(|| z.map(|zv| zv.sz).unwrap_or(sz0)));

        citations.push(node.citations.max(1.0));
        field_idx.push(z_idx as u16);

        let fname = node
            .field_name
            .clone()
            .or_else(|| node.subfield_name.clone())
            .or_else(|| z.map(|zv| zv.name.clone()))
            .unwrap_or_else(|| "Science".to_string());

        id_to_idx.insert(node.id.as_str(), idx);
        nodes_meta.push(NodeMeta {
            idx,
            id: node.id.clone(),
            title: node.title.clone(),
            year: node.year.unwrap_or(0),
            citations: node.citations,
            field_idx: z_idx as u16,
            field_name: fname,
        });
    }

    let mut edge_u = Vec::new();
    let mut edge_v = Vec::new();
    let mut edge_w = Vec::new();
    let mut adj = vec![Vec::new(); n];

    for e in &raw.edges {
        if let (Some(&u), Some(&v)) = (
            id_to_idx.get(e.source.as_str()),
            id_to_idx.get(e.target.as_str()),
        ) {
            if u != v {
                edge_u.push(u as u32);
                edge_v.push(v as u32);
                edge_w.push(e.weight);
                adj[u].push(v);
                adj[v].push(u);
            }
        }
    }

    let mut universe = Universe::new();
    universe.is_globe = is_globe;
    universe.params = params;
    universe.load_graph(
        &init_x,
        &init_y,
        &init_sx,
        &init_sy,
        &init_sz,
        &anchor_x,
        &anchor_y,
        &anchor_sx,
        &anchor_sy,
        &anchor_sz,
        &citations,
        &field_idx,
        &edge_u,
        &edge_v,
        &edge_w,
    );

    Ok(LoadedScenario {
        universe,
        zones: raw.zones,
        nodes: nodes_meta,
        adj,
    })
}

/// Runs the simulation with high-precision per-subsystem timers until temperature < 0.004 (or max_steps).
pub fn run_profiled_simulation(u: &mut Universe, max_steps: u32) -> StepProfile {
    let mut prof = StepProfile::default();
    let t_total_start = Instant::now();

    for _ in 0..max_steps {
        if u.temperature < 0.004 {
            break;
        }
        prof.steps_executed += 1;
        let cur_temp = u.temperature;

        if u.is_globe {
            let n = u.sx.len();
            // 1. Centroids & Anchors
            let t0 = Instant::now();
            const MAX_FIELDS: usize = 32;
            let mut cx_sum = [0.0f32; MAX_FIELDS];
            let mut cy_sum = [0.0f32; MAX_FIELDS];
            let mut cz_sum = [0.0f32; MAX_FIELDS];
            let mut c_count = [0u32; MAX_FIELDS];

            if u.params.subfield_cohesion > 0.0 {
                for i in 0..n {
                    let f = (u.field_idx[i] as usize) & (MAX_FIELDS - 1);
                    cx_sum[f] += u.sx[i];
                    cy_sum[f] += u.sy[i];
                    cz_sum[f] += u.sz[i];
                    c_count[f] += 1;
                }
                for f in 0..MAX_FIELDS {
                    if c_count[f] > 0 {
                        let len = (cx_sum[f] * cx_sum[f]
                            + cy_sum[f] * cy_sum[f]
                            + cz_sum[f] * cz_sum[f])
                            .sqrt()
                            .max(1e-5);
                        cx_sum[f] /= len;
                        cy_sum[f] /= len;
                        cz_sum[f] /= len;
                    }
                }
            }

            let k_anchor = 0.0035 * u.params.anchor_strength * cur_temp;
            let k_cohesion = 0.0028 * u.params.subfield_cohesion * cur_temp;
            for i in 0..n {
                let px = u.sx[i];
                let py = u.sy[i];
                let pz = u.sz[i];
                if u.params.anchor_strength > 0.0 {
                    let dot = (px * u.anchor_sx[i] + py * u.anchor_sy[i] + pz * u.anchor_sz[i])
                        .clamp(-1.0, 1.0);
                    let theta = dot.acos();
                    let tx = u.anchor_sx[i] - px * dot;
                    let ty = u.anchor_sy[i] - py * dot;
                    let tz = u.anchor_sz[i] - pz * dot;
                    let t_len = (tx * tx + ty * ty + tz * tz).sqrt();
                    if t_len > 1e-5 {
                        let f_mag = theta * k_anchor / t_len;
                        u.svx[i] += tx * f_mag;
                        u.svy[i] += ty * f_mag;
                        u.svz[i] += tz * f_mag;
                    }
                }
                if u.params.subfield_cohesion > 0.0 {
                    let f = (u.field_idx[i] as usize) & (MAX_FIELDS - 1);
                    if c_count[f] > 1 {
                        let dot = (px * cx_sum[f] + py * cy_sum[f] + pz * cz_sum[f]).clamp(-1.0, 1.0);
                        let theta = dot.acos();
                        let tx = cx_sum[f] - px * dot;
                        let ty = cy_sum[f] - py * dot;
                        let tz = cz_sum[f] - pz * dot;
                        let t_len = (tx * tx + ty * ty + tz * tz).sqrt();
                        if t_len > 1e-5 {
                            let f_mag = theta * k_cohesion / t_len;
                            u.svx[i] += tx * f_mag;
                            u.svy[i] += ty * f_mag;
                            u.svz[i] += tz * f_mag;
                        }
                    }
                }
            }
            prof.anchors_cohesion_us += t0.elapsed().as_secs_f64() * 1e6;

            // 2. Nebula Repulsion
            let t1 = Instant::now();
            if u.params.nebula_repulsion > 0.0 {
                let rep_scale = u.params.nebula_repulsion * 0.00035 * cur_temp;
                let r_cut = u.params.nebula_cutoff.clamp(0.05, 1.2);
                let r_cut_sq = r_cut * r_cut;
                let inv_r_cut = 1.0 / r_cut;

                u.nebula_grid_3d.rebuild(&u.sx, &u.sy, &u.sz);

                let cell_size = u.nebula_grid_3d.cell_size();
                let search_radius = (r_cut / cell_size).ceil() as i32;
                let dim = u.nebula_grid_3d.dim;
                let dim_i = dim as i32;
                let dim_sq = dim * dim;

                for i in 0..n {
                    let ax = u.sx[i];
                    let ay = u.sy[i];
                    let az = u.sz[i];
                    let fa = u.field_idx[i];

                    let (cx, cy, cz) = u.nebula_grid_3d.cell_coords(ax, ay, az);
                    let cx_i = cx as i32;
                    let cy_i = cy as i32;
                    let cz_i = cz as i32;

                    let min_x = (cx_i - search_radius).max(0);
                    let max_x = (cx_i + search_radius).min(dim_i - 1);
                    let min_y = (cy_i - search_radius).max(0);
                    let max_y = (cy_i + search_radius).min(dim_i - 1);
                    let min_z = (cz_i - search_radius).max(0);
                    let max_z = (cz_i + search_radius).min(dim_i - 1);

                    for nz in min_z..=max_z {
                        let z_offset = (nz as usize) * dim_sq;
                        for ny in min_y..=max_y {
                            let yz_offset = z_offset + (ny as usize) * dim;
                            for nx in min_x..=max_x {
                                let c_idx = yz_offset + (nx as usize);
                                let mut curr = u.nebula_grid_3d.head[c_idx];
                                while curr >= 0 {
                                    let j = curr as usize;
                                    if j > i && u.field_idx[j] != fa {
                                        let dx = u.sx[j] - ax;
                                        let dy = u.sy[j] - ay;
                                        let dz = u.sz[j] - az;
                                        let chord_sq = dx * dx + dy * dy + dz * dz;
                                        if chord_sq < r_cut_sq && chord_sq > 1e-6 {
                                            let dist = chord_sq.sqrt();
                                            let q = 1.0 - dist * inv_r_cut;
                                            let push = rep_scale * (q * q) / (dist + 0.05);
                                            let nx_dir = dx / dist;
                                            let ny_dir = dy / dist;
                                            let nz_dir = dz / dist;
                                            u.svx[i] -= nx_dir * push;
                                            u.svy[i] -= ny_dir * push;
                                            u.svz[i] -= nz_dir * push;
                                            u.svx[j] += nx_dir * push;
                                            u.svy[j] += ny_dir * push;
                                            u.svz[j] += nz_dir * push;
                                        }
                                    }
                                    curr = u.nebula_grid_3d.next[j];
                                }
                            }
                        }
                    }
                }
            }
            prof.nebula_repulsion_us += t1.elapsed().as_secs_f64() * 1e6;

            // 3. Citation Springs
            let t2 = Instant::now();
            let inv_globe = 1.0 / u.globe_radius;
            let k_spring = u.params.spring_stiffness * cur_temp * 0.38;
            let m = u.edge_u.len();
            for e in 0..m {
                let ui = u.edge_u[e] as usize;
                let vi = u.edge_v[e] as usize;
                let ux = u.sx[ui];
                let uy = u.sy[ui];
                let uz = u.sz[ui];
                let vx_pos = u.sx[vi];
                let vy_pos = u.sy[vi];
                let vz_pos = u.sz[vi];

                let dot = (ux * vx_pos + uy * vy_pos + uz * vz_pos).clamp(-1.0, 1.0);
                let ang_dist = dot.acos();
                let target_ang = (u.r[ui] + u.r[vi] + u.params.spring_gap) * inv_globe;

                if ang_dist > target_ang {
                    let stretch = ang_dist - target_ang;
                    let w = if u.edge_is_cross[e] != 0 {
                        u.edge_weight[e] * u.params.bridge_mult
                    } else {
                        u.edge_weight[e]
                    };
                    let force = stretch * k_spring * w;
                    let inv_u = u.deg_factor[ui] / (u.mass[ui] * 0.1 + 1.0);
                    let inv_v = u.deg_factor[vi] / (u.mass[vi] * 0.1 + 1.0);

                    let tux = vx_pos - ux * dot;
                    let tuy = vy_pos - uy * dot;
                    let tuz = vz_pos - uz * dot;
                    let tu_len = (tux * tux + tuy * tuy + tuz * tuz).sqrt();
                    if tu_len > 1e-5 {
                        let inv_tu = 1.0 / tu_len;
                        let fu = force * inv_u * inv_tu;
                        u.svx[ui] += tux * fu;
                        u.svy[ui] += tuy * fu;
                        u.svz[ui] += tuz * fu;

                        let tvx = ux - vx_pos * dot;
                        let tvy = uy - vy_pos * dot;
                        let tvz = uz - vz_pos * dot;
                        let fv = force * inv_v * inv_tu;
                        u.svx[vi] += tvx * fv;
                        u.svy[vi] += tvy * fv;
                        u.svz[vi] += tvz * fv;
                    }
                }
            }
            prof.citation_springs_us += t2.elapsed().as_secs_f64() * 1e6;

            // 4. Riemann Integration
            let t3 = Instant::now();
            for i in 0..n {
                let px = u.sx[i];
                let py = u.sy[i];
                let pz = u.sz[i];
                let v_dot_x = u.svx[i] * px + u.svy[i] * py + u.svz[i] * pz;
                let mut vx = u.svx[i] - px * v_dot_x;
                let mut vy = u.svy[i] - py * v_dot_x;
                let mut vz = u.svz[i] - pz * v_dot_x;

                let spd = (vx * vx + vy * vy + vz * vz).sqrt();
                if spd > 0.02 {
                    let scale = 0.02 / spd;
                    vx *= scale;
                    vy *= scale;
                    vz *= scale;
                }
                let nx = px + vx;
                let ny = py + vy;
                let nz = pz + vz;
                u.svx[i] = vx * 0.85;
                u.svy[i] = vy * 0.85;
                u.svz[i] = vz * 0.85;
                let len = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-6);
                u.sx[i] = nx / len;
                u.sy[i] = ny / len;
                u.sz[i] = nz / len;
            }
            prof.riemann_integration_us += t3.elapsed().as_secs_f64() * 1e6;

            // 5 & 6. SpatialGrid3D Rebuild + PBD/XPBD Collisions
            let t_norm = cur_temp.clamp(0.0, 1.0);
            let ghost_factor = u.params.ghost_annealing.clamp(0.0, 1.0);
            let same_hardness = 1.0 - (ghost_factor * 0.75 * t_norm * t_norm);
            let cross_hardness = 1.0 - (ghost_factor * 0.98 * t_norm.powf(0.65));

            for _pass in 0..2 {
                let tg = Instant::now();
                u.grid_3d.rebuild(&u.sx, &u.sy, &u.sz);
                prof.grid_rebuild_us += tg.elapsed().as_secs_f64() * 1e6;

                let tp = Instant::now();
                let dim = u.grid_3d.dim;
                let dim_sq = dim * dim;
                for i in 0..n {
                    let ax = u.sx[i];
                    let ay = u.sy[i];
                    let az = u.sz[i];
                    let ar = u.r[i];
                    let inv_a = u.inv_mass[i];
                    let fa = u.field_idx[i];
                    let (cx, cy, cz) = u.grid_3d.cell_coords(ax, ay, az);
                    let z_start = cz.saturating_sub(1);
                    let z_end = (cz + 1).min(dim - 1);
                    let y_start = cy.saturating_sub(1);
                    let y_end = (cy + 1).min(dim - 1);
                    let x_start = cx.saturating_sub(1);
                    let x_end = (cx + 1).min(dim - 1);

                    for nz_cell in z_start..=z_end {
                        let z_off = nz_cell * dim_sq;
                        for ny_cell in y_start..=y_end {
                            let yz_off = z_off + ny_cell * dim;
                            for nx_cell in x_start..=x_end {
                                let mut j_idx = u.grid_3d.head[yz_off + nx_cell];
                                while j_idx >= 0 {
                                    let j = j_idx as usize;
                                    j_idx = u.grid_3d.next[j];
                                    if j <= i {
                                        continue;
                                    }
                                    let dx = u.sx[j] - ax;
                                    let dy = u.sy[j] - ay;
                                    let dz = u.sz[j] - az;
                                    let chord_sq = dx * dx + dy * dy + dz * dz;
                                    let min_ang = (ar + u.r[j] + u.params.collision_margin) * inv_globe;
                                    let min_chord = 2.0 * (min_ang * 0.5).sin();
                                    if chord_sq < min_chord * min_chord {
                                        let chord_dist = chord_sq.max(1e-6).sqrt();
                                        let overlap = min_chord - chord_dist;
                                        let nx = dx / chord_dist;
                                        let ny = dy / chord_dist;
                                        let nz = dz / chord_dist;
                                        let hardness = if fa == u.field_idx[j] {
                                            same_hardness
                                        } else {
                                            cross_hardness
                                        };
                                        let pbd_stiff = 0.38 * hardness;
                                        let inv_b = u.inv_mass[j];
                                        let total_inv = inv_a + inv_b;
                                        if total_inv > 0.0 {
                                            let shift = overlap * pbd_stiff / total_inv;
                                            u.sx[i] -= nx * shift * inv_a;
                                            u.sy[i] -= ny * shift * inv_a;
                                            u.sz[i] -= nz * shift * inv_a;
                                            u.sx[j] += nx * shift * inv_b;
                                            u.sy[j] += ny * shift * inv_b;
                                            u.sz[j] += nz * shift * inv_b;

                                            let rvx = u.svx[j] - u.svx[i];
                                            let rvy = u.svy[j] - u.svy[i];
                                            let rvz = u.svz[j] - u.svz[i];
                                            let vn = rvx * nx + rvy * ny + rvz * nz;
                                            if vn < 0.0 {
                                                let impulse = vn * hardness * 0.5 / total_inv;
                                                u.svx[i] += nx * impulse * inv_a;
                                                u.svy[i] += ny * impulse * inv_a;
                                                u.svz[i] += nz * impulse * inv_a;
                                                u.svx[j] -= nx * impulse * inv_b;
                                                u.svy[j] -= ny * impulse * inv_b;
                                                u.svz[j] -= nz * impulse * inv_b;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                for i in 0..n {
                    let len = (u.sx[i] * u.sx[i] + u.sy[i] * u.sy[i] + u.sz[i] * u.sz[i])
                        .sqrt()
                        .max(1e-6);
                    u.sx[i] /= len;
                    u.sy[i] /= len;
                    u.sz[i] /= len;
                }
                prof.pbd_collisions_us += tp.elapsed().as_secs_f64() * 1e6;
            }
        } else {
            u.step(1);
        }

        u.temperature *= 0.994;
    }

    prof.total_us = t_total_start.elapsed().as_secs_f64() * 1e6;
    prof
}

#[inline]
fn xyz_to_lat_lon(sx: f32, sy: f32, sz: f32) -> (f32, f32) {
    let lat = sy.clamp(-1.0, 1.0).asin().to_degrees();
    let lon = sx.atan2(sz).to_degrees();
    (lat, lon)
}

/// Evaluates all topological, spatial, packing, and neighborhood sanity metrics on a settled scenario.
pub fn analyze_layout(scen: &LoadedScenario, profile: StepProfile, inspect_count: usize) -> LayoutDiagnosticReport {
    let u = &scen.universe;
    let n = u.sx.len();
    let m = u.edge_u.len();

    // Build fast 1-hop and 2-hop lookup sets per node
    let mut one_hop: Vec<HashSet<usize>> = vec![HashSet::new(); n];
    for i in 0..n {
        for &nb in &scen.adj[i] {
            one_hop[i].insert(nb);
        }
    }

    // 1. k-NN Spatial Purity, Internal vs Bridge Purity, Jammed Outlier Detection, and k-NN Citation Recall
    let k_neighbors = 10.min(n.saturating_sub(1));
    let mut total_same_field_ratio = 0.0f32;
    let mut internal_purity_sum = 0.0f32;
    let mut internal_count = 0usize;
    let mut bridge_purity_sum = 0.0f32;
    let mut bridge_count = 0usize;
    let mut knn_citation_hits = 0usize;
    let mut knn_total_pairs = 0usize;

    let mut trapped_examples = Vec::new();
    let mut trapped_count = 0usize;

    // Precompute all-pairs geodesic distances (in radians) for exact k-NN and overlap audit
    let mut dists_rad = vec![0.0f32; n * n];
    let mut physical_overlapping_pairs = 0usize;
    let mut overlap_sum_px = 0.0f32;
    let mut max_overlap_px = 0.0f32;
    let mut screen_foreshortened_overlaps = 0usize;

    for i in 0..n {
        let ax = u.sx[i];
        let ay = u.sy[i];
        let az = u.sz[i];
        for j in (i + 1)..n {
            let dot = (ax * u.sx[j] + ay * u.sy[j] + az * u.sz[j]).clamp(-1.0, 1.0);
            let theta = dot.acos();
            dists_rad[i * n + j] = theta;
            dists_rad[j * n + i] = theta;

            // Physical arc distance in globe pixels vs sum of radii
            let arc_px = theta * u.globe_radius;
            let min_req_px = u.r[i] + u.r[j];
            if arc_px < min_req_px {
                let ov = min_req_px - arc_px;
                if ov > 0.25 {
                    physical_overlapping_pairs += 1;
                    overlap_sum_px += ov;
                    if ov > max_overlap_px {
                        max_overlap_px = ov;
                    }
                }
            } else {
                // Check if visible on front hemisphere (z > 0.1) and overlapping on 2D orthographic screen
                if az > 0.1 && u.sz[j] > 0.1 {
                    let dx_scr = (u.sx[j] - ax) * u.globe_radius;
                    let dy_scr = (u.sy[j] - ay) * u.globe_radius;
                    let scr_dist = (dx_scr * dx_scr + dy_scr * dy_scr).sqrt();
                    if scr_dist < min_req_px - 0.5 {
                        screen_foreshortened_overlaps += 1;
                    }
                }
            }
        }
    }

    for i in 0..n {
        let mut order: Vec<usize> = (0..n).filter(|&j| j != i).collect();
        let row_off = i * n;
        order.sort_by(|&a, &b| {
            dists_rad[row_off + a]
                .partial_cmp(&dists_rad[row_off + b])
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let fi = u.field_idx[i];
        let mut same_cnt = 0usize;
        let mut field_votes: HashMap<u16, usize> = HashMap::new();

        for &nb in &order[..k_neighbors] {
            let f_nb = u.field_idx[nb];
            *field_votes.entry(f_nb).or_insert(0) += 1;
            if f_nb == fi {
                same_cnt += 1;
            }
            knn_total_pairs += 1;
            if one_hop[i].contains(&nb)
                || scen.adj[i].iter().any(|&mid| one_hop[mid].contains(&nb))
            {
                knn_citation_hits += 1;
            }
        }

        let purity = (same_cnt as f32) / (k_neighbors.max(1) as f32);
        total_same_field_ratio += purity;

        // Classify node as internal vs interdisciplinary bridge
        let deg = scen.adj[i].len();
        let own_field_edges = scen.adj[i]
            .iter()
            .filter(|&&nb| u.field_idx[nb] == fi)
            .count();
        let cross_edges = deg.saturating_sub(own_field_edges);

        if deg > 0 && cross_edges == 0 {
            internal_purity_sum += purity;
            internal_count += 1;
        } else if cross_edges > 0 {
            bridge_purity_sum += purity;
            bridge_count += 1;
        }

        // Detect trapped/jammed node: has edges predominantly (>= 75%) to its own field,
        // yet >= 80% of its spatial k-NN belong to foreign fields!
        if deg > 0 && (own_field_edges as f32 / deg as f32) >= 0.75 && purity <= 0.20 {
            trapped_count += 1;
            if trapped_examples.len() < 8 {
                let (&dom_f, _) = field_votes
                    .iter()
                    .max_by_key(|&(_, c)| c)
                    .unwrap_or((&fi, &0));
                let dom_name = scen
                    .zones
                    .get(dom_f as usize)
                    .map(|z| z.name.clone())
                    .unwrap_or_else(|| format!("Field {}", dom_f));
                let (lat, lon) = xyz_to_lat_lon(u.sx[i], u.sy[i], u.sz[i]);
                trapped_examples.push(TrappedNodeInfo {
                    idx: i,
                    title: scen.nodes[i].title.clone(),
                    own_field: scen.nodes[i].field_name.clone(),
                    dominant_neighbor_field: dom_name,
                    degree: deg,
                    foreign_neighbor_ratio: 1.0 - purity,
                    lat_deg: lat,
                    lon_deg: lon,
                });
            }
        }
    }

    // 2. Connected Citation Distance vs Random Distance
    let mut connected_ang_sum = 0.0f32;
    let mut within_25deg_cnt = 0usize;
    for e in 0..m {
        let ui = u.edge_u[e] as usize;
        let vi = u.edge_v[e] as usize;
        let deg_ang = dists_rad[ui * n + vi].to_degrees();
        connected_ang_sum += deg_ang;
        if deg_ang <= 25.0 {
            within_25deg_cnt += 1;
        }
    }
    let mean_connected_angle_deg = if m > 0 {
        connected_ang_sum / (m as f32)
    } else {
        0.0
    };

    let mut rand_ang_sum = 0.0f32;
    let mut rand_pairs = 0usize;
    let step_stride = (n / 80).max(1);
    for i in (0..n).step_by(step_stride) {
        for j in ((i + 1)..n).step_by(step_stride) {
            rand_ang_sum += dists_rad[i * n + j].to_degrees();
            rand_pairs += 1;
        }
    }
    let mean_random_angle_deg = if rand_pairs > 0 {
        rand_ang_sum / (rand_pairs as f32)
    } else {
        90.0
    };

    // 3. Continent Fragmentation per Discipline (BFS on spatial proximity graph)
    let mut discipline_continents = Vec::new();
    for (z_idx, zone) in scen.zones.iter().enumerate() {
        let f_nodes: Vec<usize> = (0..n)
            .filter(|&i| u.field_idx[i] as usize == z_idx)
            .collect();
        if f_nodes.is_empty() {
            continue;
        }
        let mut visited: HashSet<usize> = HashSet::new();
        let mut comp_sizes = Vec::new();

        for &start in &f_nodes {
            if visited.contains(&start) {
                continue;
            }
            let mut q = vec![start];
            visited.insert(start);
            let mut c_size = 0usize;
            while let Some(curr) = q.pop() {
                c_size += 1;
                for &cand in &f_nodes {
                    if !visited.contains(&cand) {
                        // Consider two same-field papers part of the same landmass if within ~14 degrees or 3.5x sum of radii
                        let thresh_rad =
                            ((u.r[curr] + u.r[cand]) * 3.5 / u.globe_radius).max(0.20);
                        if dists_rad[curr * n + cand] <= thresh_rad {
                            visited.insert(cand);
                            q.push(cand);
                        }
                    }
                }
            }
            comp_sizes.push(c_size);
        }
        comp_sizes.sort_unstable_by(|a, b| b.cmp(a));
        let largest = comp_sizes.first().copied().unwrap_or(0);
        // Count significant islands (>= 3 papers)
        let significant_islands = comp_sizes.iter().filter(|&&s| s >= 3).count().max(1);
        discipline_continents.push(DisciplineContinentStat {
            field_name: zone.name.clone(),
            node_count: f_nodes.len(),
            island_count: significant_islands,
            main_continent_share_pct: (largest as f32) * 100.0 / (f_nodes.len() as f32),
        });
    }

    // 4. Coordinate & Spatial Neighborhood Inspector for key papers
    let mut sample_indices: Vec<(usize, String)> = Vec::new();
    // Pick top cited hub
    if let Some((hub_idx, _)) = scen
        .nodes
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.citations.partial_cmp(&b.1.citations).unwrap())
    {
        sample_indices.push((hub_idx, "Monumental Hub".to_string()));
    }
    // Pick top interdisciplinary bridge paper
    if let Some(bridge_idx) = (0..n).max_by_key(|&i| {
        scen.adj[i]
            .iter()
            .filter(|&&nb| u.field_idx[nb] != u.field_idx[i])
            .count()
    }) {
        if !sample_indices.iter().any(|(idx, _)| *idx == bridge_idx) {
            sample_indices.push((bridge_idx, "Interdisciplinary Bridge".to_string()));
        }
    }
    // Add any trapped node or high-degree nodes up to inspect_count
    if let Some(trapped) = trapped_examples.first() {
        if !sample_indices.iter().any(|(idx, _)| *idx == trapped.idx) {
            sample_indices.push((trapped.idx, "Trapped Outlier".to_string()));
        }
    }
    for i in 0..n {
        if sample_indices.len() >= inspect_count {
            break;
        }
        if scen.adj[i].len() >= 4 && !sample_indices.iter().any(|(idx, _)| *idx == i) {
            sample_indices.push((i, "Connected Paper".to_string()));
        }
    }

    let mut inspections = Vec::new();
    for (idx, role) in sample_indices.into_iter().take(inspect_count) {
        let mut order: Vec<usize> = (0..n).filter(|&j| j != idx).collect();
        let row_off = idx * n;
        order.sort_by(|&a, &b| {
            dists_rad[row_off + a]
                .partial_cmp(&dists_rad[row_off + b])
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let neighbors = order
            .into_iter()
            .take(6)
            .map(|nb| {
                let is_1hop = one_hop[idx].contains(&nb);
                let is_2hop = !is_1hop
                    && scen.adj[idx]
                        .iter()
                        .any(|&mid| one_hop[mid].contains(&nb));
                NeighborEntry {
                    idx: nb,
                    title: scen.nodes[nb].title.clone(),
                    field_name: scen.nodes[nb].field_name.clone(),
                    dist_deg: dists_rad[row_off + nb].to_degrees(),
                    same_field: u.field_idx[nb] == u.field_idx[idx],
                    is_direct_citation: is_1hop,
                    is_two_hop: is_2hop,
                }
            })
            .collect();

        let (lat, lon) = xyz_to_lat_lon(u.sx[idx], u.sy[idx], u.sz[idx]);
        inspections.push(CoordinateInspection {
            idx,
            id: scen.nodes[idx].id.clone(),
            title: scen.nodes[idx].title.clone(),
            field_name: scen.nodes[idx].field_name.clone(),
            citations: scen.nodes[idx].citations,
            degree: scen.adj[idx].len(),
            role,
            sx: u.sx[idx],
            sy: u.sy[idx],
            sz: u.sz[idx],
            lat_deg: lat,
            lon_deg: lon,
            neighbors,
        });
    }

    LayoutDiagnosticReport {
        node_count: n,
        edge_count: m,
        final_temperature: u.temperature,
        profile,
        knn_field_purity_pct: (total_same_field_ratio * 100.0) / (n.max(1) as f32),
        internal_node_purity_pct: if internal_count > 0 {
            (internal_purity_sum * 100.0) / (internal_count as f32)
        } else {
            0.0
        },
        bridge_node_purity_pct: if bridge_count > 0 {
            (bridge_purity_sum * 100.0) / (bridge_count as f32)
        } else {
            0.0
        },
        mean_connected_angle_deg,
        mean_random_angle_deg,
        citations_within_25deg_pct: if m > 0 {
            (within_25deg_cnt as f32) * 100.0 / (m as f32)
        } else {
            0.0
        },
        knn_citation_1hop_or_2hop_pct: if knn_total_pairs > 0 {
            (knn_citation_hits as f32) * 100.0 / (knn_total_pairs as f32)
        } else {
            0.0
        },
        trapped_count,
        trapped_pct: (trapped_count as f32) * 100.0 / (n.max(1) as f32),
        trapped_examples,
        physical_overlapping_pairs,
        mean_overlap_px: if physical_overlapping_pairs > 0 {
            overlap_sum_px / (physical_overlapping_pairs as f32)
        } else {
            0.0
        },
        max_overlap_px,
        screen_foreshortened_overlaps,
        discipline_continents,
        inspections,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IslandPaperSummary {
    pub idx: usize,
    pub title: String,
    pub year: i32,
    pub citations: f32,
    pub internal_deg: usize,
    pub total_deg: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct IslandBorderNeighbor {
    pub foreign_field: String,
    pub foreign_island_rank: usize,
    pub min_border_gap_deg: f32,
    pub citation_bridges: usize,
    pub sample_bridge_pair: Option<(usize, String, usize, String)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IslandDossier {
    pub field_name: String,
    pub island_rank: usize,
    pub node_count: usize,
    pub center_lat_deg: f32,
    pub center_lon_deg: f32,
    pub radius_deg: f32,
    pub internal_edges: usize,
    pub external_same_field_edges: usize,
    pub external_cross_field_edges: usize,
    pub internal_retention_pct: f32,
    pub isolated_nodes: usize,
    pub top_foreign_partner: String,
    pub keywords_tfidf: Vec<String>,
    pub core_papers: Vec<IslandPaperSummary>,
    pub closest_foreign_neighbors: Vec<IslandBorderNeighbor>,
}

fn tokenize_title(title: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "the", "of", "and", "in", "for", "to", "a", "with", "on", "by", "from", "an", "as", "at",
        "is", "are", "or", "be", "into", "that", "this", "its", "their", "between", "through",
        "under", "over", "after", "before", "during", "without", "within", "towards", "toward",
        "method", "methods", "approach", "approaches", "analysis", "study", "studies", "theory",
        "model", "models", "modeling", "modelling", "using", "based", "new", "review", "overview",
        "introduction", "principles", "application", "applications", "system", "systems", "effect",
        "effects", "role", "properties", "structure", "structures", "general", "simple", "fast",
        "high", "low", "large", "small", "scale", "data", "research", "science", "scientific",
        "handbook", "guide", "manual", "edition", "vol", "volume", "part", "ii", "iii", "one",
        "two", "three", "first", "second", "some", "modern", "applied", "practical", "foundations",
        "concepts", "perspectives", "advances", "progress", "evaluation", "assessment",
    ];
    let stop: HashSet<&str> = STOP_WORDS.iter().copied().collect();

    title
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .map(|w| w.trim_matches('-').to_lowercase())
        .filter(|w| w.len() >= 3 && !w.chars().all(|c| c.is_ascii_digit()) && !stop.contains(w.as_str()))
        .collect()
}

/// Discovers and profiles individual spatial islands per discipline on the settled sphere.
pub fn analyze_islands(scen: &LoadedScenario, min_island_size: usize) -> Vec<IslandDossier> {
    let u = &scen.universe;
    let n = u.sx.len();

    // Global document frequency for TF-IDF keyword extraction
    let mut node_tokens: Vec<Vec<String>> = Vec::with_capacity(n);
    let mut doc_freq: HashMap<String, usize> = HashMap::new();
    for i in 0..n {
        let toks = tokenize_title(&scen.nodes[i].title);
        let uniq: HashSet<String> = toks.iter().cloned().collect();
        for w in uniq {
            *doc_freq.entry(w).or_insert(0) += 1;
        }
        node_tokens.push(toks);
    }

    let mut dossiers = Vec::new();
    let mut island_members: Vec<Vec<usize>> = Vec::new();

    for (z_idx, zone) in scen.zones.iter().enumerate() {
        let f_nodes: Vec<usize> = (0..n)
            .filter(|&i| u.field_idx[i] as usize == z_idx)
            .collect();
        if f_nodes.is_empty() {
            continue;
        }

        let mut visited: HashSet<usize> = HashSet::new();
        let mut components: Vec<Vec<usize>> = Vec::new();

        for &start in &f_nodes {
            if visited.contains(&start) {
                continue;
            }
            let mut comp = Vec::new();
            let mut q = vec![start];
            visited.insert(start);
            while let Some(curr) = q.pop() {
                comp.push(curr);
                let ax = u.sx[curr];
                let ay = u.sy[curr];
                let az = u.sz[curr];
                for &cand in &f_nodes {
                    if !visited.contains(&cand) {
                        let dot = (ax * u.sx[cand] + ay * u.sy[cand] + az * u.sz[cand]).clamp(-1.0, 1.0);
                        let theta = dot.acos();
                        // Tight coastal threshold: touching or separated by narrow strait (<= 2.6x sum of radii or ~6.5 deg)
                        let thresh_rad =
                            ((u.r[curr] + u.r[cand]) * 2.6 / u.globe_radius).max(0.115);
                        if theta <= thresh_rad {
                            visited.insert(cand);
                            q.push(cand);
                        }
                    }
                }
            }
            components.push(comp);
        }

        components.sort_by(|a, b| b.len().cmp(&a.len()));

        for (rank, comp) in components.into_iter().enumerate() {
            if comp.len() < min_island_size {
                continue;
            }
            let comp_set: HashSet<usize> = comp.iter().copied().collect();

            // Spherical centroid & angular radius
            let mut cx = 0.0f32;
            let mut cy = 0.0f32;
            let mut cz = 0.0f32;
            for &idx in &comp {
                cx += u.sx[idx];
                cy += u.sy[idx];
                cz += u.sz[idx];
            }
            let c_len = (cx * cx + cy * cy + cz * cz).sqrt().max(1e-5);
            cx /= c_len;
            cy /= c_len;
            cz /= c_len;
            let (lat_deg, lon_deg) = xyz_to_lat_lon(cx, cy, cz);

            let mut max_rad_deg = 0.0f32;
            for &idx in &comp {
                let dot = (cx * u.sx[idx] + cy * u.sy[idx] + cz * u.sz[idx]).clamp(-1.0, 1.0);
                let ang = dot.acos().to_degrees();
                if ang > max_rad_deg {
                    max_rad_deg = ang;
                }
            }

            // Edge accounting
            let mut internal_edges_double = 0usize;
            let mut ext_same_field = 0usize;
            let mut ext_cross_field = 0usize;
            let mut isolated_nodes = 0usize;
            let mut foreign_counts: HashMap<u16, usize> = HashMap::new();
            let mut per_node_internal_deg: HashMap<usize, usize> = HashMap::new();

            for &idx in &comp {
                if scen.adj[idx].is_empty() {
                    isolated_nodes += 1;
                }
                let mut ideg = 0usize;
                for &nb in &scen.adj[idx] {
                    if comp_set.contains(&nb) {
                        internal_edges_double += 1;
                        ideg += 1;
                    } else if u.field_idx[nb] as usize == z_idx {
                        ext_same_field += 1;
                    } else {
                        ext_cross_field += 1;
                        *foreign_counts.entry(u.field_idx[nb]).or_insert(0) += 1;
                    }
                }
                per_node_internal_deg.insert(idx, ideg);
            }
            let internal_edges = internal_edges_double / 2;
            let total_same_stubs = internal_edges_double + ext_same_field;
            let internal_retention_pct = if total_same_stubs > 0 {
                (internal_edges_double as f32) * 100.0 / (total_same_stubs as f32)
            } else {
                0.0
            };

            let top_foreign_partner = if let Some((&f_id, &cnt)) =
                foreign_counts.iter().max_by_key(|&(_, c)| c)
            {
                let fname = scen
                    .zones
                    .get(f_id as usize)
                    .map(|z| z.name.as_str())
                    .unwrap_or("Other");
                format!("{} ({} edges)", fname, cnt)
            } else {
                "None".to_string()
            };

            // TF-IDF keywords for this island
            let mut island_tf: HashMap<String, usize> = HashMap::new();
            for &idx in &comp {
                for w in &node_tokens[idx] {
                    *island_tf.entry(w.clone()).or_insert(0) += 1;
                }
            }
            let mut scored_words: Vec<(String, f32)> = island_tf
                .into_iter()
                .filter(|(_, tf)| *tf >= 2 || comp.len() <= 5)
                .map(|(w, tf)| {
                    let df = (*doc_freq.get(&w).unwrap_or(&1)).max(1) as f32;
                    let idf = ((n as f32) / df).ln() + 1.0;
                    (w, (tf as f32) * idf)
                })
                .collect();
            scored_words.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let keywords_tfidf: Vec<String> =
                scored_words.into_iter().take(6).map(|(w, _)| w).collect();

            // Core papers on this island sorted by internal connectivity & citations
            let mut sorted_members = comp.clone();
            sorted_members.sort_by(|&a, &b| {
                let ia = per_node_internal_deg.get(&a).copied().unwrap_or(0);
                let ib = per_node_internal_deg.get(&b).copied().unwrap_or(0);
                let score_a = (ia as f32) * 100000.0 + scen.nodes[a].citations;
                let score_b = (ib as f32) * 100000.0 + scen.nodes[b].citations;
                score_b
                    .partial_cmp(&score_a)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            let core_papers = sorted_members
                .into_iter()
                .take(5)
                .map(|idx| IslandPaperSummary {
                    idx,
                    title: scen.nodes[idx].title.clone(),
                    year: scen.nodes[idx].year,
                    citations: scen.nodes[idx].citations,
                    internal_deg: per_node_internal_deg.get(&idx).copied().unwrap_or(0),
                    total_deg: scen.adj[idx].len(),
                })
                .collect();

            island_members.push(comp);
            dossiers.push(IslandDossier {
                field_name: zone.name.clone(),
                island_rank: rank + 1,
                node_count: island_members.last().unwrap().len(),
                center_lat_deg: lat_deg,
                center_lon_deg: lon_deg,
                radius_deg: max_rad_deg,
                internal_edges,
                external_same_field_edges: ext_same_field,
                external_cross_field_edges: ext_cross_field,
                internal_retention_pct,
                isolated_nodes,
                top_foreign_partner,
                keywords_tfidf,
                core_papers,
                closest_foreign_neighbors: Vec::new(),
            });
        }
    }

    // Compute closest foreign bordering islands and concrete cross-field bridge paper pairs
    let num_islands = dossiers.len();
    let mut node_to_island: Vec<Option<usize>> = vec![None; n];
    for (isl_idx, members) in island_members.iter().enumerate() {
        for &node_idx in members {
            node_to_island[node_idx] = Some(isl_idx);
        }
    }

    for a in 0..num_islands {
        let mut neighbors: Vec<IslandBorderNeighbor> = Vec::new();
        for b in 0..num_islands {
            if a == b || dossiers[a].field_name == dossiers[b].field_name {
                continue;
            }
            let mut min_angle_rad = f32::MAX;
            let mut closest_pair: Option<(usize, usize)> = None;
            let mut bridge_count = 0usize;
            let mut best_bridge_pair: Option<(usize, usize, f32)> = None;

            for &na in &island_members[a] {
                let ax = u.sx[na];
                let ay = u.sy[na];
                let az = u.sz[na];
                for &nb in &island_members[b] {
                    let dot = (ax * u.sx[nb] + ay * u.sy[nb] + az * u.sz[nb]).clamp(-1.0, 1.0);
                    let ang = dot.acos();
                    if ang < min_angle_rad {
                        min_angle_rad = ang;
                        closest_pair = Some((na, nb));
                    }
                }
                for &adj_nb in &scen.adj[na] {
                    if node_to_island[adj_nb] == Some(b) {
                        bridge_count += 1;
                        let score = scen.nodes[na].citations + scen.nodes[adj_nb].citations;
                        if best_bridge_pair.map_or(true, |(_, _, s)| score > s) {
                            best_bridge_pair = Some((na, adj_nb, score));
                        }
                    }
                }
            }

            let min_deg = min_angle_rad.to_degrees();
            if min_deg <= 22.0 || bridge_count > 0 {
                let sample_pair = best_bridge_pair
                    .map(|(na, nb, _)| {
                        (
                            na,
                            scen.nodes[na].title.clone(),
                            nb,
                            scen.nodes[nb].title.clone(),
                        )
                    })
                    .or_else(|| {
                        closest_pair.map(|(na, nb)| {
                            (
                                na,
                                scen.nodes[na].title.clone(),
                                nb,
                                scen.nodes[nb].title.clone(),
                            )
                        })
                    });
                neighbors.push(IslandBorderNeighbor {
                    foreign_field: dossiers[b].field_name.clone(),
                    foreign_island_rank: dossiers[b].island_rank,
                    min_border_gap_deg: min_deg,
                    citation_bridges: bridge_count,
                    sample_bridge_pair: sample_pair,
                });
            }
        }
        neighbors.sort_by(|x, y| {
            x.min_border_gap_deg
                .partial_cmp(&y.min_border_gap_deg)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        neighbors.truncate(3);
        dossiers[a].closest_foreign_neighbors = neighbors;
    }

    dossiers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_so3_scramble_unbiasedness() {
        let mut scen = load_scenario_from_file(
            "public/global_data.json",
            500,
            1337,
            true,
            true,
            SimParams::default(),
        )
        .expect("Failed to load global_data.json");

        // Average field 0 centroid over 20 scrambles; should be near (0,0,0) with no polar bias
        let mut sum_x = 0.0f32;
        let mut sum_y = 0.0f32;
        let mut sum_z = 0.0f32;
        let trials = 20;
        for seed in 1..=trials {
            scen.universe.scramble(seed * 7919, true);
            let mut fx = 0.0f32;
            let mut fy = 0.0f32;
            let mut fz = 0.0f32;
            for i in 0..scen.universe.sx.len() {
                if scen.universe.field_idx[i] == 0 {
                    fx += scen.universe.sx[i];
                    fy += scen.universe.sy[i];
                    fz += scen.universe.sz[i];
                }
            }
            let len = (fx * fx + fy * fy + fz * fz).sqrt().max(1e-5);
            sum_x += (fx / len) / (trials as f32);
            sum_y += (fy / len) / (trials as f32);
            sum_z += (fz / len) / (trials as f32);
        }
        let bias_norm = (sum_x * sum_x + sum_y * sum_y + sum_z * sum_z).sqrt();
        assert!(
            bias_norm < 0.45,
            "SO(3) scramble should not lock field 0 to a fixed pole (bias_norm = {})",
            bias_norm
        );
    }

    #[test]
    fn test_pure_bottom_up_convergence_and_clustering() {
        let mut params = SimParams::default();
        apply_preset(&mut params, "cohesion");

        let mut scen = load_scenario_from_file(
            "public/global_data.json",
            600,
            1337,
            true,
            true,
            params,
        )
        .expect("Failed to load global_data.json");

        scen.universe.scramble(424242, true);
        let prof = run_profiled_simulation(&mut scen.universe, 1000);
        let report = analyze_layout(&scen, prof, 2);

        // Connected papers must be pulled much closer than random pairs (~65-90 deg)
        assert!(
            report.mean_connected_angle_deg < 25.0,
            "Connected papers should cluster closely on the sphere, got {} deg",
            report.mean_connected_angle_deg
        );
        // k-NN field purity should be high (> 60% from cold random scramble with 0 anchors)
        assert!(
            report.knn_field_purity_pct > 60.0,
            "Spatial k-NN purity should exceed 60%, got {}%",
            report.knn_field_purity_pct
        );
    }
}

