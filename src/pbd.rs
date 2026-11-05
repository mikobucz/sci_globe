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

    for _pass in 0..2 {
        grid.rebuild(sx, sy, sz);
        let dim = grid.dim;
        let dim_sq = dim * dim;

        for i in 0..n {
            let ax = sx[i];
            let ay = sy[i];
            let az = sz[i];
            let ar = r[i];
            let inv_a = inv_mass[i];
            let fa = field_idx[i];

            let (cx, cy, cz) = grid.cell_coords(ax, ay, az);
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
                        while j_idx >= 0 {
                            let j = j_idx as usize;
                            j_idx = grid.next[j];
                            if j <= i {
                                continue;
                            }

                            let dx = sx[j] - ax;
                            let dy = sy[j] - ay;
                            let dz = sz[j] - az;
                            let chord_sq = dx * dx + dy * dy + dz * dz;

                            let min_ang = (ar + r[j] + collision_margin) * inv_globe;
                            let min_chord = 2.0 * (min_ang * 0.5).sin();

                            if chord_sq < min_chord * min_chord {
                                let chord_dist = chord_sq.max(1e-6).sqrt();
                                let overlap = min_chord - chord_dist;
                                let nx = dx / chord_dist;
                                let ny = dy / chord_dist;
                                let nz = dz / chord_dist;

                                let hardness = if fa == field_idx[j] {
                                    same_hardness
                                } else {
                                    cross_hardness
                                };
                                let pbd_stiff = 0.38 * hardness;

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
                    }
                }
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
