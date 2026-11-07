//! Spherical 3D Riemann Tangent Dynamics on Unit Sphere S^2 (R = 1.0).
//! Implements true Great-Circle Geodesic tangent forces (eliminating antipodal dead-zones),
//! dynamic SO(3)-invariant field cohesion, tangent plane velocity projection,
//! angular speed clamping (<= 0.02 rad/step), momentum damping (0.85), and XPBD circle packing.

use crate::engine::SimParams;
use crate::pbd::resolve_collisions_3d;
use crate::spatial_grid::SpatialGrid3D;

/// Computes unit tangent vector on T_p S^2 pointing along the shortest great-circle arc from `p` to `q`,
/// together with the geodesic angle theta in [0, pi].
#[inline]
fn geodesic_tangent(px: f32, py: f32, pz: f32, qx: f32, qy: f32, qz: f32) -> (f32, f32, f32, f32) {
    let dot = (px * qx + py * qy + pz * qz).clamp(-1.0, 1.0);
    let theta = dot.acos();
    // Project q onto tangent plane at p: t = q - p * (p . q)
    let mut tx = qx - px * dot;
    let mut ty = qy - py * dot;
    let mut tz = qz - pz * dot;
    let t_len = (tx * tx + ty * ty + tz * tz).sqrt();
    if t_len > 1e-5 {
        let inv = 1.0 / t_len;
        tx *= inv;
        ty *= inv;
        tz *= inv;
    } else {
        tx = 0.0;
        ty = 0.0;
        tz = 0.0;
    }
    (tx, ty, tz, theta)
}

#[allow(clippy::too_many_arguments)]
pub fn step_3d(
    sx: &mut [f32],
    sy: &mut [f32],
    sz: &mut [f32],
    svx: &mut [f32],
    svy: &mut [f32],
    svz: &mut [f32],
    r: &[f32],
    mass: &[f32],
    inv_mass: &[f32],
    deg_factor: &[f32],
    anchor_sx: &[f32],
    anchor_sy: &[f32],
    anchor_sz: &[f32],
    field_idx: &[u16],
    edge_u: &[u32],
    edge_v: &[u32],
    edge_weight: &[f32],
    edge_is_cross: &[u8],
    grid: &mut SpatialGrid3D,
    nebula_grid: &mut SpatialGrid3D,
    params: &SimParams,
    globe_radius: f32,
    temperature: f32,
    dragged_idx: i32,
) {
    let n = sx.len();
    if n == 0 {
        return;
    }

    // Compute dynamic spherical centroids per field (SO(3) rotationally invariant!)
    const MAX_FIELDS: usize = 32;
    let mut cx_sum = [0.0f32; MAX_FIELDS];
    let mut cy_sum = [0.0f32; MAX_FIELDS];
    let mut cz_sum = [0.0f32; MAX_FIELDS];
    let mut c_count = [0u32; MAX_FIELDS];

    if params.subfield_cohesion > 0.0 {
        for i in 0..n {
            let f = (field_idx[i] as usize) & (MAX_FIELDS - 1);
            cx_sum[f] += sx[i];
            cy_sum[f] += sy[i];
            cz_sum[f] += sz[i];
            c_count[f] += 1;
        }
        for f in 0..MAX_FIELDS {
            if c_count[f] > 0 {
                let len = (cx_sum[f] * cx_sum[f] + cy_sum[f] * cy_sum[f] + cz_sum[f] * cz_sum[f])
                    .sqrt()
                    .max(1e-5);
                cx_sum[f] /= len;
                cy_sum[f] /= len;
                cz_sum[f] /= len;
            }
        }
    }

    // 1. Geodesic Territorial Anchors & Geodesic Dynamic Spherical Cohesion
    let k_anchor = 0.0035 * params.anchor_strength * temperature;
    let k_cohesion = 0.0028 * params.subfield_cohesion * temperature;

    for i in 0..n {
        if (i as i32) == dragged_idx {
            continue;
        }
        let px = sx[i];
        let py = sy[i];
        let pz = sz[i];

        if params.anchor_strength > 0.0 {
            let (tx, ty, tz, theta) =
                geodesic_tangent(px, py, pz, anchor_sx[i], anchor_sy[i], anchor_sz[i]);
            let f_mag = theta * k_anchor;
            svx[i] += tx * f_mag;
            svy[i] += ty * f_mag;
            svz[i] += tz * f_mag;
        }

        if params.subfield_cohesion > 0.0 {
            let f = (field_idx[i] as usize) & (MAX_FIELDS - 1);
            if c_count[f] > 1 {
                let (tx, ty, tz, theta) =
                    geodesic_tangent(px, py, pz, cx_sum[f], cy_sum[f], cz_sum[f]);
                let f_mag = theta * k_cohesion;
                svx[i] += tx * f_mag;
                svy[i] += ty * f_mag;
                svz[i] += tz * f_mag;
            }
        }
    }

    // 2. Isotropic C1-Smooth Inter-field Spherical Nebula Repulsion using coarse spatial grid (zero voxel-grid artifacts, O(N))
    if params.nebula_repulsion > 0.0 {
        let rep_scale = params.nebula_repulsion * 0.00035 * temperature;
        let r_cut = params.nebula_cutoff.clamp(0.05, 1.2);
        let r_cut_sq = r_cut * r_cut;
        let inv_r_cut = 1.0 / r_cut;

        nebula_grid.rebuild(sx, sy, sz);

        let cell_size = nebula_grid.cell_size();
        let search_radius = (r_cut / cell_size).ceil() as i32;
        let dim = nebula_grid.dim;
        let dim_i = dim as i32;
        let dim_sq = dim * dim;

        for i in 0..n {
            let ax = sx[i];
            let ay = sy[i];
            let az = sz[i];
            let fa = field_idx[i];

            let (cx, cy, cz) = nebula_grid.cell_coords(ax, ay, az);
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
                        let mut curr = nebula_grid.head[c_idx];
                        while curr >= 0 {
                            let j = curr as usize;
                            if j > i && field_idx[j] != fa {
                                let dx = sx[j] - ax;
                                let dy = sy[j] - ay;
                                let dz = sz[j] - az;
                                let chord_sq = dx * dx + dy * dy + dz * dz;
                                if chord_sq < r_cut_sq && chord_sq > 1e-6 {
                                    let dist = chord_sq.sqrt();
                                    // Smooth C1 falloff: (1 - d/r_cut)^2 / (d + 0.05) -> exactly 0 smoothly at r_cut
                                    let q = 1.0 - dist * inv_r_cut;
                                    let push = rep_scale * (q * q) / (dist + 0.05);
                                    let nx_dir = dx / dist;
                                    let ny_dir = dy / dist;
                                    let nz_dir = dz / dist;
                                    if (i as i32) != dragged_idx {
                                        svx[i] -= nx_dir * push;
                                        svy[i] -= ny_dir * push;
                                        svz[i] -= nz_dir * push;
                                    }
                                    if (j as i32) != dragged_idx {
                                        svx[j] += nx_dir * push;
                                        svy[j] += ny_dir * push;
                                        svz[j] += nz_dir * push;
                                    }
                                }
                            }
                            curr = nebula_grid.next[j];
                        }
                    }
                }
            }
        }
    }

    // 3. True Great-Circle Geodesic Hooke Citation Springs (with Degree Normalization)
    let inv_globe = 1.0 / globe_radius;
    let k_spring = params.spring_stiffness * temperature * 0.38;
    let m = edge_u.len();

    for e in 0..m {
        let u = edge_u[e] as usize;
        let v = edge_v[e] as usize;

        let ux = sx[u];
        let uy = sy[u];
        let uz = sz[u];
        let vx_pos = sx[v];
        let vy_pos = sy[v];
        let vz_pos = sz[v];

        let dot = (ux * vx_pos + uy * vy_pos + uz * vz_pos).clamp(-1.0, 1.0);
        let ang_dist = dot.acos();
        let target_ang = (r[u] + r[v] + params.spring_gap) * inv_globe;

        if ang_dist > target_ang {
            let stretch = ang_dist - target_ang;
            let w = if edge_is_cross[e] != 0 {
                edge_weight[e] * params.bridge_mult
            } else {
                edge_weight[e]
            };
            let force = stretch * k_spring * w;

            let inv_u = deg_factor[u] / (mass[u] * 0.1 + 1.0);
            let inv_v = deg_factor[v] / (mass[v] * 0.1 + 1.0);

            // Tangent direction at u toward v: t_u = v - u * dot
            let tux = vx_pos - ux * dot;
            let tuy = vy_pos - uy * dot;
            let tuz = vz_pos - uz * dot;
            let tu_len = (tux * tux + tuy * tuy + tuz * tuz).sqrt();

            if tu_len > 1e-5 {
                let inv_tu = 1.0 / tu_len;
                if (u as i32) != dragged_idx {
                    let fu = force * inv_u * inv_tu;
                    svx[u] += tux * fu;
                    svy[u] += tuy * fu;
                    svz[u] += tuz * fu;
                }
                if (v as i32) != dragged_idx {
                    // Tangent direction at v toward u: t_v = u - v * dot
                    let tvx = ux - vx_pos * dot;
                    let tvy = uy - vy_pos * dot;
                    let tvz = uz - vz_pos * dot;
                    let fv = force * inv_v * inv_tu; // |t_v| == |t_u| = sin(theta)
                    svx[v] += tvx * fv;
                    svy[v] += tvy * fv;
                    svz[v] += tvz * fv;
                }
            }
        }
    }

    // 4. Riemann Tangent Projection, Speed Clamping (<= 0.02 rad/step), Damping (0.85), Normalization
    for i in 0..n {
        if (i as i32) == dragged_idx {
            continue;
        }

        let px = sx[i];
        let py = sy[i];
        let pz = sz[i];

        // Project velocity onto tangent plane T_x S^2: v_tangent = v - x * (v . x)
        let v_dot_x = svx[i] * px + svy[i] * py + svz[i] * pz;
        let mut vx = svx[i] - px * v_dot_x;
        let mut vy = svy[i] - py * v_dot_x;
        let mut vz = svz[i] - pz * v_dot_x;

        // Angular velocity limit <= 0.02 rad/step
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

        // Momentum damping 0.85
        svx[i] = vx * 0.85;
        svy[i] = vy * 0.85;
        svz[i] = vz * 0.85;

        // Normalize back to unit sphere S^2
        let len = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-6);
        sx[i] = nx / len;
        sy[i] = ny / len;
        sz[i] = nz / len;
    }

    // 5. O(N) 3D Voxel Grid XPBD Circle Packing
    resolve_collisions_3d(
        sx,
        sy,
        sz,
        svx,
        svy,
        svz,
        r,
        inv_mass,
        field_idx,
        grid,
        globe_radius,
        params.collision_margin,
        params.ghost_annealing,
        temperature,
        dragged_idx,
    );
}
