//! O(N) Spatial Hash Grids for 2D Plane and 3D Spherical Cube [-1.05, 1.05]^3.
//! Uses flat cell-linked lists (`head` + `next`) with zero heap allocations per frame.

pub struct SpatialGrid2D {
    pub cell_size: f32,
    pub inv_cell_size: f32,
    pub min_coord: f32,
    pub cols: usize,
    pub rows: usize,
    pub head: Vec<i32>,
    pub next: Vec<i32>,
}

impl SpatialGrid2D {
    pub fn new(cols: usize, rows: usize, min_coord: f32, cell_size: f32) -> Self {
        Self {
            cell_size,
            inv_cell_size: 1.0 / cell_size,
            min_coord,
            cols,
            rows,
            head: vec![-1; cols * rows],
            next: Vec::new(),
        }
    }

    #[inline]
    pub fn rebuild(&mut self, x: &[f32], y: &[f32], max_r: f32) {
        let n = x.len();
        if self.next.len() < n {
            self.next.resize(n, -1);
        }
        // Adapt cell size to at least 2 * max_r so a 3x3 neighborhood covers all overlaps
        let target_cell = (max_r * 2.05).max(24.0);
        self.cell_size = target_cell;
        self.inv_cell_size = 1.0 / target_cell;
        let half_span = (self.cols as f32) * 0.5 * target_cell;
        self.min_coord = -half_span;

        self.head.fill(-1);

        let cols_i = self.cols as i32;
        let rows_i = self.rows as i32;

        for i in 0..n {
            let xi = x[i];
            let yi = y[i];
            if xi > 50000.0 || yi > 50000.0 {
                self.next[i] = -1;
                continue;
            }
            let cx = (((xi - self.min_coord) * self.inv_cell_size) as i32).clamp(0, cols_i - 1) as usize;
            let cy = (((yi - self.min_coord) * self.inv_cell_size) as i32).clamp(0, rows_i - 1) as usize;
            let cell_idx = cy * self.cols + cx;
            self.next[i] = self.head[cell_idx];
            self.head[cell_idx] = i as i32;
        }
    }

    #[inline]
    pub fn cell_coords(&self, xi: f32, yi: f32) -> (usize, usize) {
        let cols_i = self.cols as i32;
        let rows_i = self.rows as i32;
        let cx = (((xi - self.min_coord) * self.inv_cell_size) as i32).clamp(0, cols_i - 1) as usize;
        let cy = (((yi - self.min_coord) * self.inv_cell_size) as i32).clamp(0, rows_i - 1) as usize;
        (cx, cy)
    }
}

pub struct SpatialGrid3D {
    pub dim: usize,
    pub min_coord: f32,
    pub inv_cell_size: f32,
    pub head: Vec<i32>,
    pub next: Vec<i32>,
}

impl SpatialGrid3D {
    pub fn new(dim: usize) -> Self {
        let min_coord = -1.08;
        let span = 2.16;
        let cell_size = span / (dim as f32);
        Self {
            dim,
            min_coord,
            inv_cell_size: 1.0 / cell_size,
            head: vec![-1; dim * dim * dim],
            next: Vec::new(),
        }
    }

    #[inline]
    pub fn rebuild(&mut self, sx: &[f32], sy: &[f32], sz: &[f32]) {
        let n = sx.len();
        if self.next.len() < n {
            self.next.resize(n, -1);
        }
        self.head.fill(-1);

        let dim_i = self.dim as i32;
        let dim = self.dim;
        let dim_sq = dim * dim;

        for i in 0..n {
            let cx = (((sx[i] - self.min_coord) * self.inv_cell_size) as i32).clamp(0, dim_i - 1) as usize;
            let cy = (((sy[i] - self.min_coord) * self.inv_cell_size) as i32).clamp(0, dim_i - 1) as usize;
            let cz = (((sz[i] - self.min_coord) * self.inv_cell_size) as i32).clamp(0, dim_i - 1) as usize;
            let cell_idx = cz * dim_sq + cy * dim + cx;
            self.next[i] = self.head[cell_idx];
            self.head[cell_idx] = i as i32;
        }
    }

    #[inline]
    pub fn cell_coords(&self, x: f32, y: f32, z: f32) -> (usize, usize, usize) {
        let dim_i = self.dim as i32;
        let cx = (((x - self.min_coord) * self.inv_cell_size) as i32).clamp(0, dim_i - 1) as usize;
        let cy = (((y - self.min_coord) * self.inv_cell_size) as i32).clamp(0, dim_i - 1) as usize;
        let cz = (((z - self.min_coord) * self.inv_cell_size) as i32).clamp(0, dim_i - 1) as usize;
        (cx, cy, cz)
    }

    #[inline]
    pub fn cell_size(&self) -> f32 {
        1.0 / self.inv_cell_size
    }
}

