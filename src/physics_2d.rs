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

    // 2. O(N) Spatial Grid Isotropic C1-Smooth Inter-field Nebula Repulsion
    if params.nebula_repulsion > 0.0 {
        let rep_scale = params.nebula_repulsion * 45.0 * temperature;
        let r_cut: f32 = 300.0;
        let r_cut_sq: f32 = r_cut * r_cut;
        let inv_r_cut: f32 = 1.0 / r_cut;

        // cell_size = (r_cut * 0.5 * 2.05) = 307.5 > r_cut (300.0)
        grid.rebuild(x, y, r_cut * 0.5);
        let cols = grid.cols;
        let rows = grid.rows;

        for i in 0..n {
            let ax = x[i];
            let ay = y[i];
            if ax > 50000.0 || ay > 50000.0 {
                continue;
            }
            let fa = field_idx[i];
            let (cx, cy) = grid.cell_coords(ax, ay);

            let y_start = cy.saturating_sub(1);
            let y_end = (cy + 1).min(rows - 1);
            let x_start = cx.saturating_sub(1);
            let x_end = (cx + 1).min(cols - 1);

            for ny_cell in y_start..=y_end {
                let row_offset = ny_cell * cols;
                for nx_cell in x_start..=x_end {
                    let mut j_idx = grid.head[row_offset + nx_cell];
                    while j_idx >= 0 {
                        let j = j_idx as usize;
                        j_idx = grid.next[j];
                        if j <= i {
                            continue;
                        }
                        if field_idx[j] != fa {
                            let dx = x[j] - ax;
                            let dy = y[j] - ay;
                            if dx.abs() < r_cut && dy.abs() < r_cut {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    fn step_2d_o_n2_reference(
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
                let k_giant = params.giant_gravity * 0.0025 * temperature;
                vx[i] -= x[i] * k_giant;
                vy[i] -= y[i] * k_giant;
            }
        }

        // Reference O(N^2) inter-field nebula repulsion
        if params.nebula_repulsion > 0.0 {
            let rep_scale = params.nebula_repulsion * 45.0 * temperature;
            let r_cut: f32 = 300.0;
            let r_cut_sq: f32 = r_cut * r_cut;
            let inv_r_cut: f32 = 1.0 / r_cut;

            for i in 0..n {
                let ax = x[i];
                let ay = y[i];
                if ax > 50000.0 || ay > 50000.0 {
                    continue;
                }
                let fa = field_idx[i];
                for j in (i + 1)..n {
                    if field_idx[j] != fa && x[j] <= 50000.0 && y[j] <= 50000.0 {
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

        for i in 0..n {
            if (i as i32) == dragged_idx || x[i] > 50000.0 {
                continue;
            }
            x[i] += vx[i];
            y[i] += vy[i];
            vx[i] *= 0.86;
            vy[i] *= 0.86;
        }

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

    #[test]
    fn step_2d_nebula_repulsion_matches_o_n2_reference() {
        // Multi-field graph with:
        // - close cross-field nodes (< 300 apart, including across cell boundaries)
        // - same-field nodes (< 300 apart)
        // - far-apart cross-field nodes (> 300 apart)
        // - near-coincident cross-field nodes (dist_sq <= 25)
        // - dragged_idx participating in cross-field repulsion
        let x_init = vec![
            0.0, 80.0, -120.0, 190.0, 192.0, -250.0, 600.0, -900.0, 140.0, -140.0, 305.0, -305.0,
        ];
        let y_init = vec![
            0.0, 40.0, -50.0, 100.0, 102.0, 180.0, 600.0, -900.0, 290.0, -290.0, 15.0, -15.0,
        ];
        let n = x_init.len();
        let vx_init = vec![0.1; n];
        let vy_init = vec![-0.05; n];
        let r = vec![10.0, 12.0, 14.0, 8.0, 8.0, 11.0, 15.0, 30.0, 9.0, 10.0, 11.0, 12.0];
        let mass: Vec<f32> = r.iter().map(|ri| ri * ri).collect();
        let inv_mass: Vec<f32> = mass.iter().map(|m| 1.0 / m).collect();
        let deg_factor = vec![1.0; n];
        let anchor_x: Vec<f32> = x_init.iter().map(|xi| xi * 1.05).collect();
        let anchor_y: Vec<f32> = y_init.iter().map(|yi| yi * 1.05).collect();
        let field_idx = vec![0, 1, 0, 2, 3, 1, 2, 3, 1, 2, 0, 3];

        let edge_u = vec![0, 2, 5];
        let edge_v = vec![2, 1, 8];
        let edge_weight = vec![1.0, 0.8, 1.2];
        let edge_is_cross = vec![0, 1, 0];

        let params = SimParams {
            nebula_repulsion: 1.2,
            subfield_cohesion: 0.4,
            giant_gravity: 0.5,
            ..SimParams::default()
        };
        let temperature = 0.85;
        let dragged_idx = 3;

        let mut x_grid = x_init.clone();
        let mut y_grid = y_init.clone();
        let mut vx_grid = vx_init.clone();
        let mut vy_grid = vy_init.clone();
        let mut grid_a = SpatialGrid2D::new(96, 96, -2400.0, 50.0);

        step_2d(
            &mut x_grid,
            &mut y_grid,
            &mut vx_grid,
            &mut vy_grid,
            &r,
            &mass,
            &inv_mass,
            &deg_factor,
            &anchor_x,
            &anchor_y,
            &field_idx,
            &edge_u,
            &edge_v,
            &edge_weight,
            &edge_is_cross,
            &mut grid_a,
            &params,
            temperature,
            dragged_idx,
        );

        let mut x_ref = x_init.clone();
        let mut y_ref = y_init.clone();
        let mut vx_ref = vx_init.clone();
        let mut vy_ref = vy_init.clone();
        let mut grid_b = SpatialGrid2D::new(96, 96, -2400.0, 50.0);

        step_2d_o_n2_reference(
            &mut x_ref,
            &mut y_ref,
            &mut vx_ref,
            &mut vy_ref,
            &r,
            &mass,
            &inv_mass,
            &deg_factor,
            &anchor_x,
            &anchor_y,
            &field_idx,
            &edge_u,
            &edge_v,
            &edge_weight,
            &edge_is_cross,
            &mut grid_b,
            &params,
            temperature,
            dragged_idx,
        );

        let mut max_diff = 0.0f32;
        for i in 0..n {
            max_diff = max_diff
                .max((x_grid[i] - x_ref[i]).abs())
                .max((y_grid[i] - y_ref[i]).abs())
                .max((vx_grid[i] - vx_ref[i]).abs())
                .max((vy_grid[i] - vy_ref[i]).abs());
            assert!(
                (x_grid[i] - x_ref[i]).abs() < 1e-5,
                "x mismatch at {}: {} vs {}",
                i,
                x_grid[i],
                x_ref[i]
            );
            assert!(
                (y_grid[i] - y_ref[i]).abs() < 1e-5,
                "y mismatch at {}: {} vs {}",
                i,
                y_grid[i],
                y_ref[i]
            );
            assert!(
                (vx_grid[i] - vx_ref[i]).abs() < 1e-5,
                "vx mismatch at {}: {} vs {}",
                i,
                vx_grid[i],
                vx_ref[i]
            );
            assert!(
                (vy_grid[i] - vy_ref[i]).abs() < 1e-5,
                "vy mismatch at {}: {} vs {}",
                i,
                vy_grid[i],
                vy_ref[i]
            );
        }
        assert!(max_diff < 1e-5);
        // Ensure dragged node did not move
        assert_eq!(x_grid[dragged_idx as usize], x_init[dragged_idx as usize]);
        assert_eq!(y_grid[dragged_idx as usize], y_init[dragged_idx as usize]);
    }

    #[test]
    fn step_2d_skips_sentinel_nodes_and_respects_dragged_idx() {
        let mut x = vec![0.0, 80.0, 100000.0, 10.0];
        let mut y = vec![0.0, 0.0, 0.0, 100000.0];
        let mut vx = vec![0.0; 4];
        let mut vy = vec![0.0; 4];
        let r = vec![10.0; 4];
        let mass = vec![100.0; 4];
        let inv_mass = vec![0.01; 4];
        let deg_factor = vec![1.0; 4];
        let anchor_x = vec![0.0; 4];
        let anchor_y = vec![0.0; 4];
        let field_idx = vec![0, 1, 2, 3];

        let params = SimParams {
            nebula_repulsion: 1.5,
            anchor_strength: 0.0,
            center_gravity: 0.0,
            subfield_cohesion: 0.0,
            giant_gravity: 0.0,
            spring_stiffness: 0.0,
            ..SimParams::default()
        };
        let mut grid = SpatialGrid2D::new(96, 96, -2400.0, 50.0);

        // Node 0 is dragged; node 1 is free and within r_cut of node 0; nodes 2 and 3 are sentinels.
        step_2d(
            &mut x,
            &mut y,
            &mut vx,
            &mut vy,
            &r,
            &mass,
            &inv_mass,
            &deg_factor,
            &anchor_x,
            &anchor_y,
            &field_idx,
            &[],
            &[],
            &[],
            &[],
            &mut grid,
            &params,
            1.0,
            0,
        );

        // Dragged node 0 must not move or gain velocity
        assert_eq!(x[0], 0.0);
        assert_eq!(y[0], 0.0);
        assert_eq!(vx[0], 0.0);
        assert_eq!(vy[0], 0.0);

        // Node 1 must be repelled away from dragged node 0 (+x direction)
        assert!(x[1] > 80.0, "expected node 1 to be repelled in +x, got {}", x[1]);
        assert!(vx[1] > 0.0, "expected node 1 vx > 0, got {}", vx[1]);

        // Sentinel nodes (x > 50000.0 or y > 50000.0) must remain completely untouched
        assert_eq!(x[2], 100000.0);
        assert_eq!(y[2], 0.0);
        assert_eq!(vx[2], 0.0);
        assert_eq!(vy[2], 0.0);

        assert_eq!(x[3], 10.0);
        assert_eq!(y[3], 100000.0);
        assert_eq!(vx[3], 0.0);
        assert_eq!(vy[3], 0.0);
    }
}

