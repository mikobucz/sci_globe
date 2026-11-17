import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { initSync, WasmUniverse } from '../public/pkg/sci_globe.js';
import { mulberry32, SimBridge } from '../public/js/wasm_loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const WASM_PATH = path.join(ROOT_DIR, 'public/pkg/sci_globe_bg.wasm');
const DATA_PATH = path.join(ROOT_DIR, 'public/global_data.json');

function initWasmSync() {
  const wasmBytes = readFileSync(WASM_PATH);
  return initSync({ module: wasmBytes });
}

function getViews(wasm, universe) {
  const n = universe.node_count();
  const buf = wasm.memory.buffer;
  return {
    n,
    x: new Float32Array(buf, universe.x_ptr(), n),
    y: new Float32Array(buf, universe.y_ptr(), n),
    sx: new Float32Array(buf, universe.sx_ptr(), n),
    sy: new Float32Array(buf, universe.sy_ptr(), n),
    sz: new Float32Array(buf, universe.sz_ptr(), n),
    r: new Float32Array(buf, universe.r_ptr(), n),
  };
}

function buildConnectedSubset(rawData, targetCount = 1000, seed = 42) {
  const rng = mulberry32(seed);
  const zones = rawData.zones || [];
  const allNodes = rawData.nodes || [];
  const allEdges = rawData.edges || [];

  const candidatePool = allNodes.filter(
    (n) => n.connections && n.connections.length > 0
  );
  const shuffled = [...candidatePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const count = Math.min(targetCount, shuffled.length);
  let activeList = shuffled.slice(0, count);
  const subIds = new Set(activeList.map((n) => n.id));
  const connectedSubIds = new Set();

  for (let i = 0; i < allEdges.length; i++) {
    const e = allEdges[i];
    if (subIds.has(e.source) && subIds.has(e.target)) {
      connectedSubIds.add(e.source);
      connectedSubIds.add(e.target);
    }
  }

  if (connectedSubIds.size < count && shuffled.length > count) {
    for (
      let i = count;
      i < shuffled.length && connectedSubIds.size < count;
      i++
    ) {
      const cand = shuffled[i];
      if (cand.connections && cand.connections.some((id) => subIds.has(id))) {
        subIds.add(cand.id);
        activeList.push(cand);
        for (let k = 0; k < cand.connections.length; k++) {
          const cid = cand.connections[k];
          if (subIds.has(cid)) {
            connectedSubIds.add(cand.id);
            connectedSubIds.add(cid);
          }
        }
      }
    }
  }

  activeList = activeList.filter((n) => connectedSubIds.has(n.id));

  const fieldMap = new Map();
  zones.forEach((z, idx) => fieldMap.set(z.id, idx));

  const n = activeList.length;
  const initX = new Float32Array(n);
  const initY = new Float32Array(n);
  const initSx = new Float32Array(n);
  const initSy = new Float32Array(n);
  const initSz = new Float32Array(n);
  const anchorX = new Float32Array(n);
  const anchorY = new Float32Array(n);
  const anchorSx = new Float32Array(n);
  const anchorSy = new Float32Array(n);
  const anchorSz = new Float32Array(n);
  const citations = new Float32Array(n);
  const fieldIdx = new Uint16Array(n);
  const idToIdx = new Map();

  for (let idx = 0; idx < n; idx++) {
    const raw = activeList[idx];
    idToIdx.set(raw.id, idx);
    const fid = raw.field_id || raw.subfield_id;
    const zIdx = fieldMap.has(fid) ? fieldMap.get(fid) : 0;
    const zone = zones[zIdx] || { cx: 0, cy: 0, sx: 0, sy: 1, sz: 0 };

    initX[idx] =
      raw.initX !== undefined && Math.abs(raw.initX) < 1000
        ? raw.initX
        : (rng() - 0.5) * 300;
    initY[idx] =
      raw.initY !== undefined && Math.abs(raw.initY) < 1000
        ? raw.initY
        : (rng() - 0.5) * 300;

    let sx0 = raw.sx !== undefined ? raw.sx : (rng() - 0.5) * 2;
    let sy0 = raw.sy !== undefined ? raw.sy : (rng() - 0.5) * 2;
    let sz0 = raw.sz !== undefined ? raw.sz : (rng() - 0.5) * 2;
    const len = Math.hypot(sx0, sy0, sz0) || 1;
    initSx[idx] = sx0 / len;
    initSy[idx] = sy0 / len;
    initSz[idx] = sz0 / len;

    anchorX[idx] = raw.anchorX !== undefined ? raw.anchorX : zone.cx || 0;
    anchorY[idx] = raw.anchorY !== undefined ? raw.anchorY : zone.cy || 0;
    anchorSx[idx] = raw.anchor_sx !== undefined ? raw.anchor_sx : zone.sx || initSx[idx];
    anchorSy[idx] = raw.anchor_sy !== undefined ? raw.anchor_sy : zone.sy || initSy[idx];
    anchorSz[idx] = raw.anchor_sz !== undefined ? raw.anchor_sz : zone.sz || initSz[idx];

    citations[idx] = raw.citations || 1;
    fieldIdx[idx] = zIdx;
  }

  const validEdges = [];
  for (let i = 0; i < allEdges.length; i++) {
    const e = allEdges[i];
    const u = idToIdx.get(e.source);
    const v = idToIdx.get(e.target);
    if (u !== undefined && v !== undefined) {
      validEdges.push({ u, v, w: e.weight || 1.0 });
    }
  }

  const m = validEdges.length;
  const edgeU = new Uint32Array(m);
  const edgeV = new Uint32Array(m);
  const edgeW = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    edgeU[i] = validEdges[i].u;
    edgeV[i] = validEdges[i].v;
    edgeW[i] = validEdges[i].w;
  }

  return {
    n,
    m,
    initX,
    initY,
    initSx,
    initSy,
    initSz,
    anchorX,
    anchorY,
    anchorSx,
    anchorSy,
    anchorSz,
    citations,
    fieldIdx,
    edgeU,
    edgeV,
    edgeW,
  };
}

function loadSubsetIntoUniverse(universe, subset, isGlobe = true) {
  universe.set_view_mode(isGlobe);
  universe.load_graph(
    subset.initX,
    subset.initY,
    subset.initSx,
    subset.initSy,
    subset.initSz,
    subset.anchorX,
    subset.anchorY,
    subset.anchorSx,
    subset.anchorSy,
    subset.anchorSz,
    subset.citations,
    subset.fieldIdx,
    subset.edgeU,
    subset.edgeV,
    subset.edgeW
  );
}

const wasm = initWasmSync();
const rawData = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const subset = buildConnectedSubset(rawData, 1000, 42);

test('WASM E2E: 3D Globe mode simulates real connected subset on unit sphere and cools', () => {
  assert.ok(subset.n >= 500, `expected substantial connected subset, got ${subset.n}`);
  assert.ok(subset.m > 0, 'expected non-empty edges in connected subset');

  const universe = new WasmUniverse();
  try {
    loadSubsetIntoUniverse(universe, subset, true);
    assert.equal(universe.node_count(), subset.n);

    let temp = universe.temperature();
    for (let i = 0; i < 5; i++) {
      temp = universe.step(10);
    }

    assert.ok(Number.isFinite(temp), `expected finite temperature, got ${temp}`);
    assert.ok(temp < 1.0, `expected temperature to cool below 1.0, got ${temp}`);

    const { sx, sy, sz, r } = getViews(wasm, universe);
    for (let i = 0; i < subset.n; i++) {
      assert.ok(Number.isFinite(sx[i]) && !Number.isNaN(sx[i]), `sx[${i}] invalid: ${sx[i]}`);
      assert.ok(Number.isFinite(sy[i]) && !Number.isNaN(sy[i]), `sy[${i}] invalid: ${sy[i]}`);
      assert.ok(Number.isFinite(sz[i]) && !Number.isNaN(sz[i]), `sz[${i}] invalid: ${sz[i]}`);
      assert.ok(Number.isFinite(r[i]) && r[i] > 0, `r[${i}] invalid: ${r[i]}`);

      const norm = Math.hypot(sx[i], sy[i], sz[i]);
      assert.ok(
        Math.abs(norm - 1.0) < 1e-4,
        `node ${i} not on unit sphere: norm=${norm}`
      );
    }
  } finally {
    universe.free();
  }
});

test('WASM E2E: 2D Planar mode simulates with nebulaRepulsion and produces finite coordinates', () => {
  const universe = new WasmUniverse();
  try {
    loadSubsetIntoUniverse(universe, subset, false);
    universe.set_view_mode(false);
    universe.set_param('nebulaRepulsion', 0.4);

    const temp = universe.step(10);
    assert.ok(Number.isFinite(temp) && temp < 1.0, `unexpected 2D temp: ${temp}`);

    const { x, y, r } = getViews(wasm, universe);
    for (let i = 0; i < subset.n; i++) {
      assert.ok(Number.isFinite(x[i]) && !Number.isNaN(x[i]), `x[${i}] invalid: ${x[i]}`);
      assert.ok(Number.isFinite(y[i]) && !Number.isNaN(y[i]), `y[${i}] invalid: ${y[i]}`);
      assert.ok(Number.isFinite(r[i]) && !Number.isNaN(r[i]) && r[i] > 0, `r[${i}] invalid: ${r[i]}`);
    }
  } finally {
    universe.free();
  }
});

test('WASM E2E: scramble, reheat, freeze, drag, and applyPositions controls', () => {
  const universe = new WasmUniverse();
  try {
    loadSubsetIntoUniverse(universe, subset, true);
    universe.step(10);

    // scramble(123, true)
    universe.scramble(123, true);
    let views = getViews(wasm, universe);
    for (let i = 0; i < subset.n; i++) {
      const norm = Math.hypot(views.sx[i], views.sy[i], views.sz[i]);
      assert.ok(Math.abs(norm - 1.0) < 1e-4, `scrambled node ${i} off S^2: ${norm}`);
    }

    // Cool then reheat() -> temperature() === 1.0
    universe.step(10);
    assert.ok(universe.temperature() < 1.0);
    universe.reheat();
    assert.equal(universe.temperature(), 1.0);

    // freeze() -> positions stay identical across step(5)
    universe.freeze();
    views = getViews(wasm, universe);
    const sxBefore = new Float32Array(views.sx);
    const syBefore = new Float32Array(views.sy);
    const szBefore = new Float32Array(views.sz);

    universe.step(5);
    views = getViews(wasm, universe);
    for (let i = 0; i < subset.n; i++) {
      assert.equal(views.sx[i], sxBefore[i], `sx[${i}] moved while frozen`);
      assert.equal(views.sy[i], syBefore[i], `sy[${i}] moved while frozen`);
      assert.equal(views.sz[i], szBefore[i], `sz[${i}] moved while frozen`);
    }

    // set_dragged_node + move_node_3d -> updates dragged node and keeps it on S^2
    universe.set_dragged_node(0);
    universe.move_node_3d(0, 2.0, -1.0, 0.5);
    views = getViews(wasm, universe);
    const invLen = 1.0 / Math.hypot(2.0, -1.0, 0.5);
    assert.ok(Math.abs(views.sx[0] - 2.0 * invLen) < 1e-5);
    assert.ok(Math.abs(views.sy[0] - -1.0 * invLen) < 1e-5);
    assert.ok(Math.abs(views.sz[0] - 0.5 * invLen) < 1e-5);
    assert.ok(Math.abs(Math.hypot(views.sx[0], views.sy[0], views.sz[0]) - 1.0) < 1e-4);
    universe.set_dragged_node(-1);

    // applyPositions via SimBridge -> moves specified nodes to target coordinates
    const bridge = new SimBridge();
    bridge.wasm = wasm;
    bridge.universe = universe;
    bridge.applyPositions([
      [1, 0, 1, 0],
      { idx: 2, sx: 0, sy: 0, sz: 1 },
    ]);

    views = getViews(wasm, universe);
    assert.ok(Math.abs(views.sx[1] - 0) < 1e-5);
    assert.ok(Math.abs(views.sy[1] - 1) < 1e-5);
    assert.ok(Math.abs(views.sz[1] - 0) < 1e-5);

    assert.ok(Math.abs(views.sx[2] - 0) < 1e-5);
    assert.ok(Math.abs(views.sy[2] - 0) < 1e-5);
    assert.ok(Math.abs(views.sz[2] - 1) < 1e-5);
  } finally {
    universe.free();
  }
});
