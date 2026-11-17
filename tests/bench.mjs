import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { initSync, WasmUniverse } from '../public/pkg/sci_globe.js';
import { AtlasRenderer, GLOBE_RADIUS } from '../public/js/renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const WASM_PATH = path.join(ROOT_DIR, 'public/pkg/sci_globe_bg.wasm');
const DATA_PATH = path.join(ROOT_DIR, 'public/global_data.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoopMockCanvas() {
  const noopGrad = { addColorStop() {} };
  const ctx = {
    globalAlpha: 1.0,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1.0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    createRadialGradient() {
      return noopGrad;
    },
    clearRect() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    fill() {},
    stroke() {},
    strokeText() {},
    fillText() {},
  };

  return {
    width: 1440,
    height: 900,
    getContext() {
      return ctx;
    },
  };
}

function makeRendererScene(n, seed = 42) {
  const rng = mulberry32(seed);
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const r = new Float32Array(n);
  const nodes = new Array(n);
  const nodeMap = new Map();

  for (let i = 0; i < n; i++) {
    // Distribute points across the unit sphere
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    sx[i] = s * Math.cos(theta);
    sy[i] = u;
    sz[i] = s * Math.sin(theta);
    // ~2% giant nodes to exercise label rendering path
    r[i] = i % 50 === 0 ? 24 : 5 + rng() * 6;

    const node = {
      idx: i,
      id: `n${i}`,
      title: `Paper Title ${i} on Mathematical Topology`,
      color: '#58a6ff',
      field_id: `f${i % 8}`,
      connections: [],
    };
    nodes[i] = node;
    nodeMap.set(node.id, node);
  }

  return {
    bridge: { nodes, nodeMap, edges: [] },
    views: { count: n, sx, sy, sz, r },
    state: {
      camera: { x: 720, y: 450, scale: 1.0 },
      globeRotation: { x: 0.25, y: 0.6 },
      params: { globeRadius: GLOBE_RADIUS, showAllLines: false },
      hoveredNode: null,
      selectedNode: null,
      activeFieldId: null,
    },
  };
}

function buildConnectedSubset(rawData, targetCount, seed = 42) {
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
  if (activeList.length > targetCount) {
    activeList = activeList.slice(0, targetCount);
  }

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

    const sx0 = raw.sx !== undefined ? raw.sx : (rng() - 0.5) * 2;
    const sy0 = raw.sy !== undefined ? raw.sy : (rng() - 0.5) * 2;
    const sz0 = raw.sz !== undefined ? raw.sz : (rng() - 0.5) * 2;
    const len = Math.hypot(sx0, sy0, sz0) || 1;
    initSx[idx] = sx0 / len;
    initSy[idx] = sy0 / len;
    initSz[idx] = sz0 / len;

    anchorX[idx] = raw.anchorX !== undefined ? raw.anchorX : zone.cx || 0;
    anchorY[idx] = raw.anchorY !== undefined ? raw.anchorY : zone.cy || 0;
    anchorSx[idx] =
      raw.anchor_sx !== undefined ? raw.anchor_sx : zone.sx || initSx[idx];
    anchorSy[idx] =
      raw.anchor_sy !== undefined ? raw.anchor_sy : zone.sy || initSy[idx];
    anchorSz[idx] =
      raw.anchor_sz !== undefined ? raw.anchor_sz : zone.sz || initSz[idx];

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

function loadSubsetIntoUniverse(universe, subset, isGlobe, nebulaRepulsion) {
  universe.set_view_mode(isGlobe);
  universe.set_param('nebulaRepulsion', nebulaRepulsion);
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

function benchRenderer(n, warmupFrames = 10, measureFrames = 50) {
  const canvas = createNoopMockCanvas();
  const renderer = new AtlasRenderer(canvas);
  const { bridge, views, state } = makeRendererScene(n);

  for (let i = 0; i < warmupFrames; i++) {
    state.globeRotation.y += 0.01;
    renderer.renderGlobe(bridge, views, state);
  }

  const t0 = performance.now();
  for (let i = 0; i < measureFrames; i++) {
    state.globeRotation.y += 0.01;
    renderer.renderGlobe(bridge, views, state);
  }
  const elapsedMs = performance.now() - t0;
  const msPerFrame = elapsedMs / measureFrames;
  const fps = 1000 / msPerFrame;
  return { n, warmupFrames, measureFrames, elapsedMs, msPerFrame, fps };
}

function benchWasmStep(subset, isGlobe, nebulaRepulsion, warmupSteps, measureSteps) {
  const universe = new WasmUniverse();
  try {
    loadSubsetIntoUniverse(universe, subset, isGlobe, nebulaRepulsion);

    for (let i = 0; i < warmupSteps; i++) {
      universe.step(1);
    }

    const t0 = performance.now();
    for (let i = 0; i < measureSteps; i++) {
      universe.step(1);
    }
    const elapsedMs = performance.now() - t0;
    const usPerStep = (elapsedMs * 1000) / measureSteps;
    return {
      n: subset.n,
      m: subset.m,
      isGlobe,
      nebulaRepulsion,
      warmupSteps,
      measureSteps,
      elapsedMs,
      usPerStep,
    };
  } finally {
    universe.free();
  }
}

function pad(str, width, alignRight = false) {
  const s = String(str);
  if (s.length >= width) return s;
  const spaces = ' '.repeat(width - s.length);
  return alignRight ? spaces + s : s + spaces;
}

function main() {
  const wasmBytes = readFileSync(WASM_PATH);
  initSync({ module: wasmBytes });
  const rawData = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

  const wasmSizes = [1000, 2000, 5000];
  const subsets = new Map();
  for (const target of wasmSizes) {
    subsets.set(target, buildConnectedSubset(rawData, target, 42));
  }

  // 1. Canvas 2D Renderer
  const rendererResults = [
    benchRenderer(2000, 10, 50),
    benchRenderer(5000, 10, 50),
  ];

  // 2. WASM 3D Globe
  const globeResults = [];
  for (const nebula of [0.0, 0.4]) {
    for (const target of wasmSizes) {
      globeResults.push(
        benchWasmStep(subsets.get(target), true, nebula, 5, 50)
      );
    }
  }

  // 3. WASM 2D Planar
  const planarResults = [];
  for (const target of wasmSizes) {
    planarResults.push(
      benchWasmStep(subsets.get(target), false, 0.4, 3, 20)
    );
  }

  console.log('');
  console.log('=== MathMap (sci_globe) Performance Benchmark ===');
  console.log(`Node ${process.version} | ${process.platform} ${process.arch}`);
  console.log('');

  console.log('1) Canvas 2D Renderer (AtlasRenderer.renderGlobe, 10 warmup / 50 frames)');
  console.log('   Nodes    ms/frame    FPS       Total (50 frames)');
  console.log('   -------  ----------  --------  -----------------');
  for (const r of rendererResults) {
    console.log(
      `   ${pad(r.n, 7, true)}  ${pad(r.msPerFrame.toFixed(3), 10, true)}  ${pad(r.fps.toFixed(1), 8, true)}  ${pad(r.elapsedMs.toFixed(2) + ' ms', 17, true)}`
    );
  }
  console.log('');

  console.log('2) WASM 3D Globe (WasmUniverse.step, 5 warmup / 50 steps)');
  console.log('   Nodes (Edges)     nebula    us/step     Total (50 steps)');
  console.log('   ----------------  --------  ----------  ----------------');
  for (const r of globeResults) {
    const ne = `${r.n} (${r.m})`;
    console.log(
      `   ${pad(ne, 16)}  ${pad(r.nebulaRepulsion.toFixed(1), 8, true)}  ${pad(r.usPerStep.toFixed(1), 10, true)}  ${pad(r.elapsedMs.toFixed(2) + ' ms', 16, true)}`
    );
  }
  console.log('');

  console.log('3) WASM 2D Planar (WasmUniverse.step, set_view_mode(false), 3 warmup / 20 steps)');
  console.log('   Nodes (Edges)     nebula    us/step     Total (20 steps)');
  console.log('   ----------------  --------  ----------  ----------------');
  for (const r of planarResults) {
    const ne = `${r.n} (${r.m})`;
    console.log(
      `   ${pad(ne, 16)}  ${pad(r.nebulaRepulsion.toFixed(1), 8, true)}  ${pad(r.usPerStep.toFixed(1), 10, true)}  ${pad(r.elapsedMs.toFixed(2) + ' ms', 16, true)}`
    );
  }
  console.log('');
}

main();
