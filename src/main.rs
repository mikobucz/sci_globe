//! Native Desktop CLI / Benchmark Runner for the MathMap Rust Engine.
//! Runs 4,000 nodes + 10,000 edges in both 2D Planar and 3D Spherical Globe modes
//! and prints deterministic frame-time telemetry.

use mathmap::engine::{Mulberry32, Universe};
use std::time::Instant;

fn main() {
    println!("==============================================================");
    println!(" MathMap Native Rust Simulation Benchmark (SoA + SpatialGrid) ");
    println!("==============================================================");

    let n = 4000usize;
    let m = 10000usize;
    let mut rng = Mulberry32::new(1337);

    let mut init_x = Vec::with_capacity(n);
    let mut init_y = Vec::with_capacity(n);
    let mut init_sx = Vec::with_capacity(n);
    let mut init_sy = Vec::with_capacity(n);
    let mut init_sz = Vec::with_capacity(n);
    let mut citations = Vec::with_capacity(n);
    let mut field_idx = Vec::with_capacity(n);

    for i in 0..n {
        init_x.push((rng.next_f32() - 0.5) * 800.0);
        init_y.push((rng.next_f32() - 0.5) * 800.0);
        let u = rng.next_f32() * 2.0 - 1.0;
        let theta = rng.next_f32() * std::f32::consts::TAU;
        let rad = (1.0 - u * u).max(0.0).sqrt();
        init_sx.push(rad * theta.cos());
        init_sy.push(u);
        init_sz.push(rad * theta.sin());
        citations.push(50.0 + (rng.next_f32().powf(3.0) * 25000.0));
        field_idx.push((i % 8) as u16);
    }

    let mut edge_u = Vec::with_capacity(m);
    let mut edge_v = Vec::with_capacity(m);
    let mut edge_weight = Vec::with_capacity(m);
    for _ in 0..m {
        let u = (rng.next_f32() * (n as f32)) as u32 % (n as u32);
        let mut v = (rng.next_f32() * (n as f32)) as u32 % (n as u32);
        if u == v {
            v = (u + 1) % (n as u32);
        }
        edge_u.push(u);
        edge_v.push(v);
        edge_weight.push(1.0);
    }

    let mut universe = Universe::new();
    universe.load_graph(
        &init_x,
        &init_y,
        &init_sx,
        &init_sy,
        &init_sz,
        &init_x,
        &init_y,
        &init_sx,
        &init_sy,
        &init_sz,
        &citations,
        &field_idx,
        &edge_u,
        &edge_v,
        &edge_weight,
    );

    // Benchmark 3D Spherical Globe
    universe.set_is_globe_bench(true);
    let t0 = Instant::now();
    let steps = 200;
    universe.step(steps);
    let elapsed_3d = t0.elapsed();
    println!(
        "[3D Globe S^2] {} nodes, {} edges | {} steps in {:.2?} ({:.1} us/step -> {:.0} FPS capacity)",
        n,
        m,
        steps,
        elapsed_3d,
        elapsed_3d.as_secs_f64() * 1e6 / (steps as f64),
        1.0 / (elapsed_3d.as_secs_f64() / (steps as f64))
    );

    // Benchmark 2D Planar
    universe.set_is_globe_bench(false);
    let t1 = Instant::now();
    universe.step(steps);
    let elapsed_2d = t1.elapsed();
    println!(
        "[2D Planar   ] {} nodes, {} edges | {} steps in {:.2?} ({:.1} us/step -> {:.0} FPS capacity)",
        n,
        m,
        steps,
        elapsed_2d,
        elapsed_2d.as_secs_f64() * 1e6 / (steps as f64),
        1.0 / (elapsed_2d.as_secs_f64() / (steps as f64))
    );
}

