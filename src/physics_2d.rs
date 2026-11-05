//! Planar 2D Force-Directed + Position-Based Dynamics Simulation Step.

use crate::engine::SimParams;
use crate::pbd::resolve_collisions_2d;
use crate::spatial_grid::SpatialGrid2D;

#[allow(clippy::too_many_arguments)]
pub fn step_2d(
    x: &mut [f32],
    y: &mut [f32],
    vx: &mut [f32],
    vy: &mut [f32],
    r: &[f32],
    mass: &[f32],
    inv_mass: &[f32],
    deg_factor: &[f32],
    anchor_x: &[f32],
    anchor_y: &[f32],
    field_idx: &[u16],
    edge_u: &[u32],
    edge_v: &[u32],
    edge_weight: &[f32],
    edge_is_cross: &[u8],
    grid: &mut SpatialGrid2D,
    params: &SimParams,
    temperature: f32,
    dragged_idx: i32,
) {
    let n = x.len();
    if n == 0 {
        return;
    }

    // Dynamic field centroids for bottom-up subfield cohesion
    const MAX_FIELDS: usize = 32;
    let mut cx_sum = [0.0f32; MAX_FIELDS];
    let mut cy_sum = [0.0f32; MAX_FIELDS];
    let mut c_count = [0u32; MAX_FIELDS];

    if params.subfield_cohesion > 0.0 {
        for i in 0..n {
            if x[i] > 50000.0 {
                continue;
            }
            let f = (field_idx[i] as usize) & (MAX_FIELDS - 1);
            cx_sum[f] += x[i];
            cy_sum[f] += y[i];
            c_count[f] += 1;
        }
        for f in 0..MAX_FIELDS {
            if c_count[f] > 0 {
                let inv = 1.0 / (c_count[f] as f32);
                cx_sum[f] *= inv;
                cy_sum[f] *= inv;
            }
        }
    }

    // 1. Anchors, Central Gravity, Subfield Cohesion, and Giant Hub Gravity
    let k_anchor = 0.016 * params.anchor_strength * temperature;
    let k_center = params.center_gravity * temperature;
    let k_cohesion = 0.018 * params.subfield_cohesion * temperature;

    for i in 0..n {
        if (i as i32) == dragged_idx || x[i] > 50000.0 {
            continue;
        }

        if params.anchor_strength > 0.0 {
            vx[i] += (anchor_x[i] - x[i]) * k_anchor;
            vy[i] += (anchor_y[i] - y[i]) * k_anchor;
        } else {
            vx[i] -= x[i] * k_center;
            vy[i] -= y[i] * k_center;
        }

        if params.subfield_cohesion > 0.0 {
            let f = (field_idx[i] as usize) & (MAX_FIELDS - 1);
            if c_count[f] > 1 {
                vx[i] += (cx_sum[f] - x[i]) * k_cohesion;
                vy[i] += (cy_sum[f] - y[i]) * k_cohesion;
            }
        }

        if params.giant_gravity > 0.0 && r[i] > 28.0 {
            // Massive hubs gently gravitate toward the origin core
            let k_giant = params.giant_gravity * 0.0025 * temperature;
            vx[i] -= x[i] * k_giant;
            vy[i] -= y[i] * k_giant;
        }
    }

    // 2. Isotropic C1-Smooth Inter-field Nebula Repulsion
    if params.nebula_repulsion > 0.0 {
        let rep_scale = params.nebula_repulsion * 45.0 * temperature;
        let r_cut: f32 = 300.0;
        let r_cut_sq: f32 = r_cut * r_cut;
        let inv_r_cut: f32 = 1.0 / r_cut;

        for i in 0..n {
            let ax = x[i];
            let ay = y[i];
            if ax > 50000.0 {
                continue;
            }
            let fa = field_idx[i];
            for j in (i + 1)..n {
                if field_idx[j] != fa && x[j] <= 50000.0 {
                    let dx = x[j] - ax;
                    let dy = y[j] - ay;
                    let dist_sq = dx * dx + dy * dy;
                    if dist_sq < r_cut_sq && dist_sq > 25.0 {
                        let dist = dist_sq.sqrt();
                        let q = 1.0 - dist * inv_r_cut;
                        let push = rep_scale * (q * q) / (dist + 20.0);
                        let nx = dx / dist;
                        let ny = dy / dist;
                        if (i as i32) != dragged_idx {
                            vx[i] -= nx * push;
                            vy[i] -= ny * push;
                        }
                        if (j as i32) != dragged_idx {
                            vx[j] += nx * push;
                            vy[j] += ny * push;
                        }
                    }
                }
            }
        }
    }

    // 3. Hooke Citation Springs
    let m = edge_u.len();
    let k_spring = params.spring_stiffness * temperature;
    for e in 0..m {
        let u = edge_u[e] as usize;
        let v = edge_v[e] as usize;
        if x[u] > 50000.0 || x[v] > 50000.0 {
            continue;
        }

        let dx = x[v] - x[u];
        let dy = y[v] - y[u];
        let dist = (dx * dx + dy * dy).sqrt() + 1e-4;
        let target_dist = r[u] + r[v] + params.spring_gap;

        if dist > target_dist {
            let stretch = dist - target_dist;
            let w = if edge_is_cross[e] != 0 {
                edge_weight[e] * params.bridge_mult
            } else {
                edge_weight[e]
            };
            let force = stretch * k_spring * w;
            let fx = (dx / dist) * force;
            let fy = (dy / dist) * force;

            let inv_u = deg_factor[u] / (mass[u] * 0.1 + 1.0);
            let inv_v = deg_factor[v] / (mass[v] * 0.1 + 1.0);

            if (u as i32) != dragged_idx {
                vx[u] += fx * inv_u;
                vy[u] += fy * inv_u;
            }
            if (v as i32) != dragged_idx {
                vx[v] -= fx * inv_v;
                vy[v] -= fy * inv_v;
            }
        }
    }

    // 4. Euler Velocity Integration & Damping
    for i in 0..n {
        if (i as i32) == dragged_idx || x[i] > 50000.0 {
            continue;
        }
        x[i] += vx[i];
        y[i] += vy[i];
        vx[i] *= 0.86;
        vy[i] *= 0.86;
    }

    // 5. O(N) Spatial Grid PBD Non-Overlap Resolution
    resolve_collisions_2d(
        x,
        y,
        vx,
        vy,
        r,
        inv_mass,
        field_idx,
        grid,
        params.collision_margin,
        params.ghost_annealing,
        temperature,
        dragged_idx,
    );
}

