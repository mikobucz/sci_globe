//! Position-Based Dynamics (PBD / XPBD) Circle Packing in 2D and Spherical 3D.
//! Uses O(N) Spatial Hash Grids, inverse-mass weighting, two-phase Ghost Annealing
//! (inter-discipline tunneling during high temperature), and velocity projection.

use crate::spatial_grid::{SpatialGrid2D, SpatialGrid3D};

#[allow(clippy::too_many_arguments)]
pub fn resolve_collisions_2d(
    x: &mut [f32],
    y: &mut [f32],
    vx: &mut [f32],
    vy: &mut [f32],
    r: &[f32],
    inv_mass: &[f32],
    field_idx: &[u16],
    grid: &mut SpatialGrid2D,
    collision_margin: f32,
    ghost_annealing: f32,
    temperature: f32,
    dragged_idx: i32,
) {
    let n = x.len();
    if n < 2 {
        return;
    }

    let mut max_r = 4.0f32;
    for &ri in r.iter() {
        if ri > max_r {
            max_r = ri;
        }
    }
    max_r += collision_margin;

    // Two-phase crystallization:
    // Same-field nodes pack gently; cross-field nodes can tunnel through foreign walls when hot
    let t_norm = temperature.clamp(0.0, 1.0);
    let ghost_factor = ghost_annealing.clamp(0.0, 1.0);
    let same_hardness = 1.0 - (ghost_factor * 0.75 * t_norm * t_norm);
    let cross_hardness = 1.0 - (ghost_factor * 0.98 * t_norm.powf(0.65));

    for _pass in 0..2 {
        grid.rebuild(x, y, max_r);
        let cols = grid.cols;
        let rows = grid.rows;

        for i in 0..n {
            let ax = x[i];
            let ay = y[i];
            if ax > 50000.0 || ay > 50000.0 {
                continue;
            }
            let ar = r[i];
            let inv_a = inv_mass[i];
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

                        let bx = x[j];
                        let by = y[j];
                        let dx = bx - ax;
                        let dy = by - ay;
                        let min_dist = ar + r[j] + collision_margin;

                        if dx.abs() < min_dist && dy.abs() < min_dist {
                            let dist_sq = dx * dx + dy * dy;
                            if dist_sq < min_dist * min_dist {
                                let dist = dist_sq.max(1e-4).sqrt();
                                let overlap = min_dist - dist;
                                let nx = dx / dist;
                                let ny = dy / dist;

                                let hardness = if fa == field_idx[j] {
                                    same_hardness
                                } else {
                                    cross_hardness
                                };
                                let pbd_stiff = 0.65 * hardness;

                                let inv_b = inv_mass[j];
                                let total_inv = inv_a + inv_b;
                                if total_inv > 0.0 {
                                    let shift = overlap * pbd_stiff / total_inv;
                                    if (i as i32) != dragged_idx {
                                        x[i] -= nx * shift * inv_a;
                                        y[i] -= ny * shift * inv_a;
                                    }
                                    if (j as i32) != dragged_idx {
                                        x[j] += nx * shift * inv_b;
                                        y[j] += ny * shift * inv_b;
                                    }

                                    // XPBD: remove inward normal velocity component so circles slide smoothly around walls
                                    let rvx = vx[j] - vx[i];
                                    let rvy = vy[j] - vy[i];
                                    let vn = rvx * nx + rvy * ny;
                                    if vn < 0.0 {
                                        let impulse = vn * hardness * 0.5 / total_inv;
                                        if (i as i32) != dragged_idx {
                                            vx[i] += nx * impulse * inv_a;
                                            vy[i] += ny * impulse * inv_a;
                                        }
                                        if (j as i32) != dragged_idx {
                                            vx[j] -= nx * impulse * inv_b;
                                            vy[j] -= ny * impulse * inv_b;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[inline(always)]
#[allow(clippy::too_many_arguments)]
fn resolve_pair_3d(
    i: usize,
    j: usize,
    sx: &mut [f32],
    sy: &mut [f32],
    sz: &mut [f32],
    svx: &mut [f32],
    svy: &mut [f32],
    svz: &mut [f32],
    r: &[f32],
    inv_mass: &[f32],
    field_idx: &[u16],
    inv_globe: f32,
    collision_margin: f32,
    same_hardness: f32,
    cross_hardness: f32,
    dragged_idx: i32,
) {
    let ax = sx[i];
    let ay = sy[i];
    let az = sz[i];
    // Since 2 * sin(a / 2) <= a for all a >= 0, max_chord is a strict upper bound on min_chord.
    let max_chord = (r[i] + r[j] + collision_margin) * inv_globe;
    let dx = sx[j] - ax;
    if dx.abs() >= max_chord {
        return;
    }
    let dy = sy[j] - ay;
    if dy.abs() >= max_chord {
        return;
    }
    let dz = sz[j] - az;
    if dz.abs() >= max_chord {
        return;
    }
    let chord_sq = dx * dx + dy * dy + dz * dz;
    if chord_sq >= max_chord * max_chord {
        return;
    }

    let min_chord = 2.0 * (max_chord * 0.5).sin();
    if chord_sq < min_chord * min_chord {
        let chord_dist = chord_sq.max(1e-6).sqrt();
        let overlap = min_chord - chord_dist;
        let nx = dx / chord_dist;
        let ny = dy / chord_dist;
        let nz = dz / chord_dist;

        let hardness = if field_idx[i] == field_idx[j] {
            same_hardness
        } else {
            cross_hardness
        };
        let pbd_stiff = 0.38 * hardness;

        let inv_a = inv_mass[i];
        let inv_b = inv_mass[j];
        let total_inv = inv_a + inv_b;
        if total_inv > 0.0 {
            let shift = overlap * pbd_stiff / total_inv;
            if (i as i32) != dragged_idx {
                sx[i] -= nx * shift * inv_a;
                sy[i] -= ny * shift * inv_a;
                sz[i] -= nz * shift * inv_a;
            }
            if (j as i32) != dragged_idx {
                sx[j] += nx * shift * inv_b;
                sy[j] += ny * shift * inv_b;
                sz[j] += nz * shift * inv_b;
            }

            // XPBD tangent velocity sliding
            let rvx = svx[j] - svx[i];
            let rvy = svy[j] - svy[i];
            let rvz = svz[j] - svz[i];
            let vn = rvx * nx + rvy * ny + rvz * nz;
            if vn < 0.0 {
                let impulse = vn * hardness * 0.5 / total_inv;
                if (i as i32) != dragged_idx {
                    svx[i] += nx * impulse * inv_a;
                    svy[i] += ny * impulse * inv_a;
                    svz[i] += nz * impulse * inv_a;
                }
                if (j as i32) != dragged_idx {
                    svx[j] -= nx * impulse * inv_b;
                    svy[j] -= ny * impulse * inv_b;
                    svz[j] -= nz * impulse * inv_b;
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn resolve_collisions_3d(
    sx: &mut [f32],
    sy: &mut [f32],
    sz: &mut [f32],
    svx: &mut [f32],
    svy: &mut [f32],
    svz: &mut [f32],
    r: &[f32],
    inv_mass: &[f32],
    field_idx: &[u16],
    grid: &mut SpatialGrid3D,
    globe_radius: f32,
    collision_margin: f32,
    ghost_annealing: f32,
    temperature: f32,
    dragged_idx: i32,
) {
    let n = sx.len();
    if n < 2 {
        return;
    }

    let t_norm = temperature.clamp(0.0, 1.0);
    let ghost_factor = ghost_annealing.clamp(0.0, 1.0);
    let same_hardness = 1.0 - (ghost_factor * 0.75 * t_norm * t_norm);
    let cross_hardness = 1.0 - (ghost_factor * 0.98 * t_norm.powf(0.65));
    let inv_globe = 1.0 / globe_radius;

    let mut max_r = 4.0f32;
    for &ri in r.iter() {
        if ri > max_r {
            max_r = ri;
        }
    }

    let mut hubs: Vec<usize> = Vec::new();
    let mut normal_limit = max_r;
    let mut normal_max_r = max_r;

    if max_r > 12.0 && n >= 64 {
        let limit = (max_r * 0.45).max(8.0);
        let mut n_max_r = 4.0f32;
        for (i, &ri) in r.iter().enumerate() {
            if ri > limit {
                hubs.push(i);
            } else if ri > n_max_r {
                n_max_r = ri;
            }
        }
        if !hubs.is_empty() && hubs.len() * 8 < n {
            normal_limit = limit;
            normal_max_r = n_max_r;
        } else {
            hubs.clear();
        }
    }

    let max_chord_bound = (2.0 * normal_max_r + collision_margin) * inv_globe * 1.02;

    for _pass in 0..2 {
        if hubs.is_empty() {
            grid.rebuild_adaptive(sx, sy, sz, max_chord_bound, 48);
        } else {
            grid.rebuild_adaptive_filtered(sx, sy, sz, r, normal_limit, max_chord_bound, 48);
        }
        let dim = grid.dim;
        let dim_sq = dim * dim;

        for i in 0..n {
            if !hubs.is_empty() && r[i] > normal_limit {
                continue;
            }

            let (cx, cy, cz) = grid.cell_coords(sx[i], sy[i], sz[i]);
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
                        let mut j_idx = grid.head[yz_off + nx_cell];
                        if j_idx < 0 {
                            continue;
                        }
                        while j_idx >= 0 {
                            let j = j_idx as usize;
                            j_idx = grid.next[j];
                            if j <= i {
                                continue;
                            }

                            resolve_pair_3d(
                                i,
                                j,
                                sx,
                                sy,
                                sz,
                                svx,
                                svy,
                                svz,
                                r,
                                inv_mass,
                                field_idx,
                                inv_globe,
                                collision_margin,
                                same_hardness,
                                cross_hardness,
                                dragged_idx,
                            );
                        }
                    }
                }
            }
        }

        // Dedicated hub-vs-all loop (hubs are excluded from the spatial grid)
        for &h in &hubs {
            for j in 0..n {
                if j == h {
                    continue;
                }
                if r[j] > normal_limit && j <= h {
                    continue;
                }
                resolve_pair_3d(
                    h,
                    j,
                    sx,
                    sy,
                    sz,
                    svx,
                    svy,
                    svz,
                    r,
                    inv_mass,
                    field_idx,
                    inv_globe,
                    collision_margin,
                    same_hardness,
                    cross_hardness,
                    dragged_idx,
                );
            }
        }

        // Re-project onto unit sphere S^2 after each PBD pass
        for i in 0..n {
            let len = (sx[i] * sx[i] + sy[i] * sy[i] + sz[i] * sz[i]).sqrt().max(1e-6);
            sx[i] /= len;
            sy[i] /= len;
            sz[i] /= len;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chord_dist(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> f32 {
        let dx = bx - ax;
        let dy = by - ay;
        let dz = bz - az;
        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    #[test]
    fn resolve_collisions_3d_separates_overlapping_nodes_on_s2() {
        let globe_radius = 660.0;
        let r = [20.0_f32, 20.0_f32];
        let collision_margin = 4.0_f32;
        let min_ang = (r[0] + r[1] + collision_margin) / globe_radius;
        let min_chord = 2.0 * (min_ang * 0.5).sin();

        // Place two nodes very close on the equator of S^2
        let theta = 0.01_f32;
        let mut sx = [1.0_f32, theta.cos()];
        let mut sy = [0.0_f32, theta.sin()];
        let mut sz = [0.0_f32, 0.0_f32];
        let mut svx = [0.0_f32; 2];
        let mut svy = [0.0_f32; 2];
        let mut svz = [0.0_f32; 2];
        let inv_mass = [1.0_f32; 2];
        let field_idx = [0_u16; 2];
        let mut grid = SpatialGrid3D::new(14);

        let initial_chord = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);
        assert!(initial_chord < min_chord);

        resolve_collisions_3d(
            &mut sx,
            &mut sy,
            &mut sz,
            &mut svx,
            &mut svy,
            &mut svz,
            &r,
            &inv_mass,
            &field_idx,
            &mut grid,
            globe_radius,
            collision_margin,
            0.0,
            0.0,
            -1,
        );

        let after_one_chord = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);
        assert!(
            after_one_chord > initial_chord,
            "expected nodes to separate after one call: {after_one_chord} <= {initial_chord}"
        );

        // Iterate to convergence (2 PBD passes per call with stiffness 0.38)
        for _ in 0..25 {
            resolve_collisions_3d(
                &mut sx,
                &mut sy,
                &mut sz,
                &mut svx,
                &mut svy,
                &mut svz,
                &r,
                &inv_mass,
                &field_idx,
                &mut grid,
                globe_radius,
                collision_margin,
                0.0,
                0.0,
                -1,
            );
        }

        let final_chord = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);
        assert!(
            final_chord >= min_chord - 1e-4,
            "expected final chord {final_chord} >= min_chord {min_chord}"
        );

        for i in 0..2 {
            let norm = (sx[i] * sx[i] + sy[i] * sy[i] + sz[i] * sz[i]).sqrt();
            assert!(
                (norm - 1.0).abs() < 1e-5,
                "node {i} drifted off S^2: norm = {norm}"
            );
        }
    }

    #[test]
    fn resolve_collisions_3d_skips_distant_and_respects_dragged_idx() {
        let globe_radius = 660.0;
        let r = [15.0_f32, 15.0_f32, 15.0_f32];
        let collision_margin = 2.0_f32;

        // Nodes 0 and 1 overlap near (1, 0, 0); node 2 is distant at (-1, 0, 0)
        let theta = 0.005_f32;
        let mut sx = [1.0_f32, theta.cos(), -1.0_f32];
        let mut sy = [0.0_f32, theta.sin(), 0.0_f32];
        let mut sz = [0.0_f32, 0.0_f32, 0.0_f32];
        let mut svx = [0.0_f32; 3];
        let mut svy = [0.0_f32; 3];
        let mut svz = [0.0_f32; 3];
        let inv_mass = [1.0_f32; 3];
        let field_idx = [0_u16; 3];
        let mut grid = SpatialGrid3D::new(14);

        let initial_01 = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);

        resolve_collisions_3d(
            &mut sx,
            &mut sy,
            &mut sz,
            &mut svx,
            &mut svy,
            &mut svz,
            &r,
            &inv_mass,
            &field_idx,
            &mut grid,
            globe_radius,
            collision_margin,
            0.0,
            0.0,
            0, // node 0 is dragged and must not move
        );

        // Dragged node 0 must stay at (1, 0, 0)
        assert!((sx[0] - 1.0).abs() < 1e-6);
        assert!(sy[0].abs() < 1e-6);
        assert!(sz[0].abs() < 1e-6);

        // Distant node 2 must stay at (-1, 0, 0)
        assert!((sx[2] + 1.0).abs() < 1e-6);
        assert!(sy[2].abs() < 1e-6);
        assert!(sz[2].abs() < 1e-6);

        // Non-dragged overlapping node 1 must have been pushed away from node 0
        let after_01 = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);
        assert!(
            after_01 > initial_01,
            "expected node 1 to move away from dragged node 0: {after_01} <= {initial_01}"
        );

        for i in 0..3 {
            let norm = (sx[i] * sx[i] + sy[i] * sy[i] + sz[i] * sz[i]).sqrt();
            assert!(
                (norm - 1.0).abs() < 1e-5,
                "node {i} drifted off S^2: norm = {norm}"
            );
        }
    }

    #[test]
    fn resolve_collisions_3d_adaptive_grid_scales_dim_and_separates_pairs() {
        let globe_radius = 660.0;
        let collision_margin = 2.0_f32;

        // Case 1: Small node radii -> finer grid (dim = 36)
        let r_small = [6.0_f32, 6.0_f32];
        let min_ang_small = (r_small[0] + r_small[1] + collision_margin) / globe_radius;
        let min_chord_small = 2.0 * (min_ang_small * 0.5).sin();
        let theta_small = 0.005_f32;
        let mut sx = [1.0_f32, theta_small.cos()];
        let mut sy = [0.0_f32, theta_small.sin()];
        let mut sz = [0.0_f32, 0.0_f32];
        let mut svx = [0.0_f32; 2];
        let mut svy = [0.0_f32; 2];
        let mut svz = [0.0_f32; 2];
        let inv_mass = [1.0_f32; 2];
        let field_idx = [0_u16; 2];
        let mut grid = SpatialGrid3D::new(14);

        for _ in 0..25 {
            resolve_collisions_3d(
                &mut sx,
                &mut sy,
                &mut sz,
                &mut svx,
                &mut svy,
                &mut svz,
                &r_small,
                &inv_mass,
                &field_idx,
                &mut grid,
                globe_radius,
                collision_margin,
                0.0,
                0.0,
                -1,
            );
        }
        let small_dim = grid.dim;
        assert_eq!(small_dim, 48, "expected max_dim=48 for small radii, got {small_dim}");
        let final_chord_small = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);
        assert!(
            final_chord_small >= min_chord_small - 1e-4,
            "small radii: expected final chord {final_chord_small} >= {min_chord_small}"
        );

        // Case 2: Large node radii -> coarser grid (dim < 14) so 3x3x3 still covers overlaps
        let r_large = [80.0_f32, 80.0_f32];
        let min_ang_large = (r_large[0] + r_large[1] + collision_margin) / globe_radius;
        let min_chord_large = 2.0 * (min_ang_large * 0.5).sin();
        let theta_large = 0.15_f32;
        let mut lx = [1.0_f32, theta_large.cos()];
        let mut ly = [0.0_f32, theta_large.sin()];
        let mut lz = [0.0_f32, 0.0_f32];
        let mut lvx = [0.0_f32; 2];
        let mut lvy = [0.0_f32; 2];
        let mut lvz = [0.0_f32; 2];

        for _ in 0..35 {
            resolve_collisions_3d(
                &mut lx,
                &mut ly,
                &mut lz,
                &mut lvx,
                &mut lvy,
                &mut lvz,
                &r_large,
                &inv_mass,
                &field_idx,
                &mut grid,
                globe_radius,
                collision_margin,
                0.0,
                0.0,
                -1,
            );
        }
        let large_dim = grid.dim;
        assert!(
            large_dim < small_dim && large_dim < 14,
            "expected coarser dim < 14 for large radii, got {large_dim} (small was {small_dim})"
        );
        let final_chord_large = chord_dist(lx[0], ly[0], lz[0], lx[1], ly[1], lz[1]);
        assert!(
            final_chord_large >= min_chord_large - 1e-4,
            "large radii: expected final chord {final_chord_large} >= {min_chord_large}"
        );
    }

    #[test]
    fn resolve_collisions_3d_hub_split_separates_hub_normal_and_hub_hub_pairs() {
        let globe_radius = 660.0;
        let collision_margin = 2.0_f32;
        let n = 72; // >= 64 so hub-splitting activates

        // 2 giant hubs (indices 0, 1) with r=60, and 70 normal nodes (indices 2..72) with r=6
        let mut r = vec![6.0_f32; n];
        r[0] = 60.0;
        r[1] = 60.0;

        let mut sx = vec![0.0_f32; n];
        let mut sy = vec![0.0_f32; n];
        let mut sz = vec![0.0_f32; n];

        // Place hubs 0 and 1 overlapping near +X on S^2
        let th_hh = 0.05_f32;
        sx[0] = 1.0;
        sy[0] = 0.0;
        sz[0] = 0.0;
        sx[1] = th_hh.cos();
        sy[1] = th_hh.sin();
        sz[1] = 0.0;

        // Place normal node 2 overlapping hub 0 near +X (in +Z direction)
        let th_hn = 0.02_f32;
        sx[2] = th_hn.cos();
        sy[2] = 0.0;
        sz[2] = th_hn.sin();

        // Distribute remaining normal nodes on the opposite hemisphere (-X) so they don't interfere
        for i in 3..n {
            let t = (i as f32) * 0.61803399;
            let z = -0.8 + 1.6 * ((i - 3) as f32) / ((n - 3) as f32);
            let rho = (1.0 - z * z).max(0.0).sqrt();
            sx[i] = -(0.5 + 0.5 * rho.abs()).min(1.0);
            sy[i] = rho * t.sin();
            sz[i] = z;
            let len = (sx[i] * sx[i] + sy[i] * sy[i] + sz[i] * sz[i]).sqrt();
            sx[i] /= len;
            sy[i] /= len;
            sz[i] /= len;
        }

        let mut svx = vec![0.0_f32; n];
        let mut svy = vec![0.0_f32; n];
        let mut svz = vec![0.0_f32; n];
        let inv_mass = vec![1.0_f32; n];
        let field_idx = vec![0_u16; n];
        let mut grid = SpatialGrid3D::new(14);

        for _ in 0..40 {
            resolve_collisions_3d(
                &mut sx,
                &mut sy,
                &mut sz,
                &mut svx,
                &mut svy,
                &mut svz,
                &r,
                &inv_mass,
                &field_idx,
                &mut grid,
                globe_radius,
                collision_margin,
                0.0,
                0.0,
                -1,
            );
        }

        // Grid should use fine resolution based on normal nodes (r=6 -> dim=48)
        assert_eq!(
            grid.dim, 48,
            "expected fine grid dim=48 from normal_max_r=6.0, got {}",
            grid.dim
        );

        let min_ang_hh = (r[0] + r[1] + collision_margin) / globe_radius;
        let min_chord_hh = 2.0 * (min_ang_hh * 0.5).sin();
        let final_hh = chord_dist(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1]);
        assert!(
            final_hh >= min_chord_hh - 1e-4,
            "hub-hub pair should separate: {final_hh} < {min_chord_hh}"
        );

        let min_ang_hn = (r[0] + r[2] + collision_margin) / globe_radius;
        let min_chord_hn = 2.0 * (min_ang_hn * 0.5).sin();
        let final_hn = chord_dist(sx[0], sy[0], sz[0], sx[2], sy[2], sz[2]);
        assert!(
            final_hn >= min_chord_hn - 1e-4,
            "hub-normal pair should separate: {final_hn} < {min_chord_hn}"
        );

        for i in 0..n {
            let norm = (sx[i] * sx[i] + sy[i] * sy[i] + sz[i] * sz[i]).sqrt();
            assert!(
                (norm - 1.0).abs() < 1e-5,
                "node {i} drifted off S^2: norm = {norm}"
            );
        }
    }
}
