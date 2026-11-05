//! WebAssembly (`wasm-bindgen`) Bridge and Zero-Copy Memory Pointers for MathMap.

pub mod engine;
pub mod pbd;
pub mod physics_2d;
pub mod physics_3d;
pub mod spatial_grid;

use engine::Universe;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmUniverse {
    inner: Universe,
}

#[wasm_bindgen]
impl WasmUniverse {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Universe::new(),
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
        self.inner.load_graph(
            init_x,
            init_y,
            init_sx,
            init_sy,
            init_sz,
            anchor_x,
            anchor_y,
            anchor_sx,
            anchor_sy,
            anchor_sz,
            citations,
            field_idx,
            edge_u,
            edge_v,
            edge_weight,
        );
    }

    pub fn step(&mut self, steps: u32) -> f32 {
        self.inner.step(steps)
    }

    pub fn scramble(&mut self, seed: u32, is_globe: bool) {
        self.inner.scramble(seed, is_globe);
    }

    pub fn reheat(&mut self) {
        self.inner.temperature = 1.0;
    }

    pub fn temperature(&self) -> f32 {
        self.inner.temperature
    }

    pub fn set_view_mode(&mut self, is_globe: bool) {
        self.inner.is_globe = is_globe;
        self.inner.recalc_radii();
        self.inner.temperature = 1.0;
    }

    pub fn set_param(&mut self, key: &str, val: f32) {
        let p = &mut self.inner.params;
        let mut needs_radii = false;
        match key {
            "radiusScale" => {
                p.radius_scale = val;
                needs_radii = true;
            }
            "anchorStrength" => p.anchor_strength = val,
            "subfieldCohesion" => p.subfield_cohesion = val,
            "ghostAnnealing" => p.ghost_annealing = val,
            "nebulaRepulsion" => p.nebula_repulsion = val,
            "centerGravity" => p.center_gravity = val,
            "giantGravity" => p.giant_gravity = val,
            "springStiffness" => p.spring_stiffness = val,
            "degreeNorm" => {
                p.degree_norm = val;
                needs_radii = true;
            }
            "bridgeMult" => p.bridge_mult = val,
            "springGap" => p.spring_gap = val,
            "sizeExponent" => {
                p.size_exponent = val;
                needs_radii = true;
            }
            "massExponent" => {
                p.mass_exponent = val;
                needs_radii = true;
            }
            "collisionMargin" => p.collision_margin = val,
            _ => {}
        }
        if needs_radii {
            self.inner.recalc_radii();
        }
        self.inner.temperature = 1.0;
    }

    pub fn set_dragged_node(&mut self, idx: i32) {
        self.inner.dragged_idx = idx;
        if idx >= 0 {
            self.inner.temperature = 1.0;
        }
    }

    pub fn move_node_2d(&mut self, idx: usize, x: f32, y: f32) {
        if idx < self.inner.x.len() {
            self.inner.x[idx] = x;
            self.inner.y[idx] = y;
            self.inner.vx[idx] = 0.0;
            self.inner.vy[idx] = 0.0;
        }
    }

    pub fn move_node_3d(&mut self, idx: usize, sx: f32, sy: f32, sz: f32) {
        if idx < self.inner.sx.len() {
            let len = (sx * sx + sy * sy + sz * sz).sqrt().max(1e-6);
            self.inner.sx[idx] = sx / len;
            self.inner.sy[idx] = sy / len;
            self.inner.sz[idx] = sz / len;
            self.inner.svx[idx] = 0.0;
            self.inner.svy[idx] = 0.0;
            self.inner.svz[idx] = 0.0;
        }
    }

    // Zero-Copy Wasm Linear Memory Pointers
    pub fn node_count(&self) -> usize {
        self.inner.x.len()
    }

    pub fn x_ptr(&self) -> *const f32 {
        self.inner.x.as_ptr()
    }

    pub fn y_ptr(&self) -> *const f32 {
        self.inner.y.as_ptr()
    }

    pub fn sx_ptr(&self) -> *const f32 {
        self.inner.sx.as_ptr()
    }

    pub fn sy_ptr(&self) -> *const f32 {
        self.inner.sy.as_ptr()
    }

    pub fn sz_ptr(&self) -> *const f32 {
        self.inner.sz.as_ptr()
    }

    pub fn r_ptr(&self) -> *const f32 {
        self.inner.r.as_ptr()
    }
}

impl Default for WasmUniverse {
    fn default() -> Self {
        Self::new()
    }
}

