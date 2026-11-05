//! Core Structure-of-Arrays (SoA) Simulation State (`Universe`).

use crate::physics_2d::step_2d;
use crate::physics_3d::step_3d;
use crate::spatial_grid::{SpatialGrid2D, SpatialGrid3D};

#[derive(Clone, Copy, Debug)]
pub struct SimParams {
    pub radius_scale: f32,
    pub anchor_strength: f32,
    pub subfield_cohesion: f32,
    pub ghost_annealing: f32,
    pub nebula_repulsion: f32,
    pub center_gravity: f32,
    pub giant_gravity: f32,
    pub spring_stiffness: f32,
    pub degree_norm: f32,
    pub bridge_mult: f32,
    pub spring_gap: f32,
    pub size_exponent: f32,
    pub mass_exponent: f32,
    pub collision_margin: f32,
}

impl Default for SimParams {
    fn default() -> Self {
        Self {
            radius_scale: 0.75,
            anchor_strength: 0.35,
            subfield_cohesion: 0.0,
            ghost_annealing: 0.35,
            nebula_repulsion: 0.0,
            center_gravity: 0.0012,
            giant_gravity: 0.0,
            spring_stiffness: 0.035,
            degree_norm: 0.55,
            bridge_mult: 2.0,
            spring_gap: 6.0,
            size_exponent: 0.36,
            mass_exponent: 1.8,
            collision_margin: 2.0,
        }
    }
}

/// Deterministic Mulberry32 PRNG
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    #[inline]
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    #[inline]
    pub fn next_f32(&mut self) -> f32 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f32) / 4294967296.0
    }
}

pub struct Universe {
    // SoA Node Buffers
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    pub vx: Vec<f32>,
    pub vy: Vec<f32>,
    pub sx: Vec<f32>,
    pub sy: Vec<f32>,
    pub sz: Vec<f32>,
    pub svx: Vec<f32>,
    pub svy: Vec<f32>,
    pub svz: Vec<f32>,
    pub r: Vec<f32>,
    pub mass: Vec<f32>,
    pub inv_mass: Vec<f32>,
    pub citations: Vec<f32>,
    pub anchor_x: Vec<f32>,
    pub anchor_y: Vec<f32>,
    pub anchor_sx: Vec<f32>,
    pub anchor_sy: Vec<f32>,
    pub anchor_sz: Vec<f32>,
    pub field_idx: Vec<u16>,
    pub node_deg: Vec<u16>,
    pub deg_factor: Vec<f32>,

    // SoA Edge Buffers
    pub edge_u: Vec<u32>,
    pub edge_v: Vec<u32>,
    pub edge_weight: Vec<f32>,
    pub edge_is_cross: Vec<u8>,

    // Spatial Acceleration Structures
    pub grid_2d: SpatialGrid2D,
    pub grid_3d: SpatialGrid3D,

    // Simulation Control
    pub params: SimParams,
    pub temperature: f32,
    pub globe_radius: f32,
    pub is_globe: bool,
    pub dragged_idx: i32,
}

impl Universe {
    pub fn new() -> Self {
        Self {
            x: Vec::new(),
            y: Vec::new(),
            vx: Vec::new(),
            vy: Vec::new(),
            sx: Vec::new(),
            sy: Vec::new(),
            sz: Vec::new(),
            svx: Vec::new(),
            svy: Vec::new(),
            svz: Vec::new(),
            r: Vec::new(),
            mass: Vec::new(),
            inv_mass: Vec::new(),
            citations: Vec::new(),
            anchor_x: Vec::new(),
            anchor_y: Vec::new(),
            anchor_sx: Vec::new(),
            anchor_sy: Vec::new(),
            anchor_sz: Vec::new(),
            field_idx: Vec::new(),
            node_deg: Vec::new(),
            deg_factor: Vec::new(),
            edge_u: Vec::new(),
            edge_v: Vec::new(),
            edge_weight: Vec::new(),
            edge_is_cross: Vec::new(),
            grid_2d: SpatialGrid2D::new(96, 96, -2400.0, 50.0),
            grid_3d: SpatialGrid3D::new(14),
            params: SimParams::default(),
            temperature: 1.0,
            globe_radius: 660.0,
            is_globe: true,
            dragged_idx: -1,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn load_graph(
        &mut self,
        init_x: &[f32],
        init_y: &[f32],
        init_sx: &[f32],
        init_sy: &[f32],
        init_sz: &[f32],
        anchor_x: &[f32],
        anchor_y: &[f32],
        anchor_sx: &[f32],
        anchor_sy: &[f32],
        anchor_sz: &[f32],
        citations: &[f32],
        field_idx: &[u16],
        edge_u: &[u32],
        edge_v: &[u32],
        edge_weight: &[f32],
    ) {
        let n = init_x.len();
        self.x = init_x.to_vec();
        self.y = init_y.to_vec();
        self.vx = vec![0.0; n];
        self.vy = vec![0.0; n];

        self.sx = init_sx.to_vec();
        self.sy = init_sy.to_vec();
        self.sz = init_sz.to_vec();
        for i in 0..n {
            let len = (self.sx[i] * self.sx[i] + self.sy[i] * self.sy[i] + self.sz[i] * self.sz[i])
                .sqrt()
                .max(1e-6);
            self.sx[i] /= len;
            self.sy[i] /= len;
            self.sz[i] /= len;
        }
        self.svx = vec![0.0; n];
        self.svy = vec![0.0; n];
        self.svz = vec![0.0; n];

        self.anchor_x = anchor_x.to_vec();
        self.anchor_y = anchor_y.to_vec();
        self.anchor_sx = anchor_sx.to_vec();
        self.anchor_sy = anchor_sy.to_vec();
        self.anchor_sz = anchor_sz.to_vec();

        self.citations = citations.to_vec();
        self.field_idx = field_idx.to_vec();
        self.r = vec![4.0; n];
        self.mass = vec![1.0; n];
        self.inv_mass = vec![1.0; n];

        let m = edge_u.len();
        self.edge_u = edge_u.to_vec();
        self.edge_v = edge_v.to_vec();
        self.edge_weight = edge_weight.to_vec();
        self.edge_is_cross = Vec::with_capacity(m);
        self.node_deg = vec![0; n];
        self.deg_factor = vec![1.0; n];

        for e in 0..m {
            let u = edge_u[e] as usize;
            let v = edge_v[e] as usize;
            self.node_deg[u] = self.node_deg[u].saturating_add(1);
            self.node_deg[v] = self.node_deg[v].saturating_add(1);
            let cross = if self.field_idx[u] != self.field_idx[v] { 1 } else { 0 };
            self.edge_is_cross.push(cross);
        }

        self.recalc_radii();
        self.temperature = 1.0;
    }

    pub fn recalc_radii(&mut self) {
        let n = self.citations.len();
        let u_scale = self.params.radius_scale;
        let base_min = (if self.is_globe { 2.2 } else { 4.0 }) * u_scale;
        let max_cap = (if self.is_globe { 26.0 } else { 65.0 }) * u_scale;
        let mult = (if self.is_globe { 0.36 } else { 0.85 }) * u_scale;
        let deg_alpha = self.params.degree_norm.clamp(0.0, 1.0);

        for i in 0..n {
            let raw_r = base_min + mult * self.citations[i].powf(self.params.size_exponent);
            let ri = raw_r.clamp(base_min, max_cap);
            let mi = ri.powf(self.params.mass_exponent) + 1.0;
            self.r[i] = ri;
            self.mass[i] = mi;
            self.inv_mass[i] = 1.0 / mi;

            let d = (self.node_deg[i] as f32).max(1.0);
            self.deg_factor[i] = (4.0 / d).powf(deg_alpha);
        }
    }

    pub fn scramble(&mut self, seed: u32, is_globe: bool) {
        let n = self.x.len();
        let mut rng = Mulberry32::new(seed);

        if is_globe {
            // Generate a random 3D Euler rotation matrix in SO(3) from the seed
            let alpha = rng.next_f32() * std::f32::consts::TAU;
            let beta = rng.next_f32() * std::f32::consts::TAU;
            let gamma = rng.next_f32() * std::f32::consts::TAU;
            let (sa, ca) = alpha.sin_cos();
            let (sb, cb) = beta.sin_cos();
            let (sg, cg) = gamma.sin_cos();

            for i in 0..n {
                // Mix per-node hash with seed to break any sequential discipline correlation
                let mut node_rng = Mulberry32::new(seed.wrapping_add((i as u32).wrapping_mul(0x9E3779B9)));
                let u = node_rng.next_f32() * 2.0 - 1.0;
                let theta = node_rng.next_f32() * std::f32::consts::TAU;
                let rad = (1.0 - u * u).max(0.0).sqrt();

                let px = rad * theta.cos();
                let py = u;
                let pz = rad * theta.sin();

                // Rotate by random SO(3) matrix
                let x1 = px * ca - pz * sa;
                let z1 = px * sa + pz * ca;
                let y2 = py * cb - z1 * sb;
                let z2 = py * sb + z1 * cb;
                let x3 = x1 * cg - y2 * sg;
                let y3 = x1 * sg + y2 * cg;

                self.sx[i] = x3;
                self.sy[i] = y3;
                self.sz[i] = z2;
                self.svx[i] = 0.0;
                self.svy[i] = 0.0;
                self.svz[i] = 0.0;
            }
        } else {
            for i in 0..n {
                let mut node_rng = Mulberry32::new(seed.wrapping_add((i as u32).wrapping_mul(0x9E3779B9)));
                let a = node_rng.next_f32() * std::f32::consts::TAU;
                let d = node_rng.next_f32().sqrt() * 220.0;
                self.x[i] = a.cos() * d;
                self.y[i] = a.sin() * d;
                self.vx[i] = (node_rng.next_f32() - 0.5) * 6.0;
                self.vy[i] = (node_rng.next_f32() - 0.5) * 6.0;
            }
        }

        self.temperature = 1.0;
    }

    pub fn set_is_globe_bench(&mut self, is_globe: bool) {
        self.is_globe = is_globe;
        self.recalc_radii();
        self.temperature = 1.0;
    }

    pub fn step(&mut self, steps: u32) -> f32 {
        for _ in 0..steps {
            if self.temperature < 0.004 {
                break;
            }
            if self.is_globe {
                step_3d(
                    &mut self.sx,
                    &mut self.sy,
                    &mut self.sz,
                    &mut self.svx,
                    &mut self.svy,
                    &mut self.svz,
                    &self.r,
                    &self.mass,
                    &self.inv_mass,
                    &self.deg_factor,
                    &self.anchor_sx,
                    &self.anchor_sy,
                    &self.anchor_sz,
                    &self.field_idx,
                    &self.edge_u,
                    &self.edge_v,
                    &self.edge_weight,
                    &self.edge_is_cross,
                    &mut self.grid_3d,
                    &self.params,
                    self.globe_radius,
                    self.temperature,
                    self.dragged_idx,
                );
            } else {
                step_2d(
                    &mut self.x,
                    &mut self.y,
                    &mut self.vx,
                    &mut self.vy,
                    &self.r,
                    &self.mass,
                    &self.inv_mass,
                    &self.deg_factor,
                    &self.anchor_x,
                    &self.anchor_y,
                    &self.field_idx,
                    &self.edge_u,
                    &self.edge_v,
                    &self.edge_weight,
                    &self.edge_is_cross,
                    &mut self.grid_2d,
                    &self.params,
                    self.temperature,
                    self.dragged_idx,
                );
            }
            self.temperature *= 0.994;
        }
        self.temperature
    }
}

impl Default for Universe {
    fn default() -> Self {
        Self::new()
    }
}
