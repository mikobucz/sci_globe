import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AtlasRenderer,
  GLOBE_RADIUS,
  projectSphere,
  unprojectScreenToSphere,
} from '../public/js/renderer.js';

function createMockCanvas() {
  const ctx = {
    globalAlpha: 1.0,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1.0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    saveCount: 0,
    restoreCount: 0,
    nodeCircles: [],
    labels: [],
    _lastArc: null,
    _stack: [],

    save() {
      this.saveCount++;
      this._stack.push({
        globalAlpha: this.globalAlpha,
        fillStyle: this.fillStyle,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
      });
    },
    restore() {
      this.restoreCount++;
      const prev = this._stack.pop();
      if (prev) {
        this.globalAlpha = prev.globalAlpha;
        this.fillStyle = prev.fillStyle;
        this.strokeStyle = prev.strokeStyle;
        this.lineWidth = prev.lineWidth;
      }
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
    clearRect() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc(x, y, r) {
      this._lastArc = { x, y, r };
    },
    fill() {
      if (this._lastArc && typeof this.fillStyle === 'string' && this.fillStyle.startsWith('#node-')) {
        this.nodeCircles.push({
          id: this.fillStyle,
          x: this._lastArc.x,
          y: this._lastArc.y,
          r: this._lastArc.r,
          alpha: this.globalAlpha,
        });
      }
    },
    stroke() {},
    strokeText(text, x, y) {
      this.labels.push({ kind: 'stroke', text, x, y, alpha: this.globalAlpha, lineWidth: this.lineWidth });
    },
    fillText(text, x, y) {
      this.labels.push({ kind: 'fill', text, x, y, alpha: this.globalAlpha, fillStyle: this.fillStyle });
    },
  };

  return {
    width: 1200,
    height: 800,
    getContext(type) {
      assert.equal(type, '2d');
      return ctx;
    },
    _ctx: ctx,
  };
}

function makeScene(nodesSpec, { hoveredIdx = -1, selectedIdx = -1, activeFieldId = null, showAllLines = false } = {}) {
  const n = nodesSpec.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const r = new Float32Array(n);
  const nodes = [];
  const nodeMap = new Map();

  for (let i = 0; i < n; i++) {
    const spec = nodesSpec[i];
    sx[i] = spec.sx;
    sy[i] = spec.sy;
    sz[i] = spec.sz;
    r[i] = spec.r ?? 8;
    const node = {
      idx: i,
      id: `n${i}`,
      title: spec.title ?? `Node ${i}`,
      color: spec.color ?? `#node-${i}`,
      field_id: spec.field_id ?? 'math',
      connections: spec.connections ?? [],
    };
    nodes.push(node);
    nodeMap.set(node.id, node);
  }

  return {
    bridge: { nodes, nodeMap, edges: [] },
    views: { count: n, sx, sy, sz, r },
    state: {
      camera: { x: 600, y: 400, scale: 1.0 },
      globeRotation: { x: 0, y: 0 },
      params: { globeRadius: GLOBE_RADIUS, showAllLines },
      hoveredNode: hoveredIdx >= 0 ? nodes[hoveredIdx] : null,
      selectedNode: selectedIdx >= 0 ? nodes[selectedIdx] : null,
      activeFieldId,
    },
  };
}

test('unprojectScreenToSphere round-trips projectSphere on front hemisphere', () => {
  const camera = { x: 640, y: 360, scale: 1.2 };
  const rotations = [
    { x: 0, y: 0 },
    { x: 0.35, y: -0.7 },
    { x: -0.5, y: 1.1 },
  ];
  const points = [
    { sx: 0, sy: 0, sz: 1 },
    { sx: 0.3, sy: 0.4, sz: Math.sqrt(1 - 0.09 - 0.16) },
    { sx: -0.5, sy: 0.2, sz: Math.sqrt(1 - 0.25 - 0.04) },
  ];

  for (const rot of rotations) {
    for (const pt of points) {
      const proj = projectSphere(pt.sx, pt.sy, pt.sz, rot, camera, GLOBE_RADIUS);
      if (proj.depth > 0.01) {
        const inv = unprojectScreenToSphere(proj.x, proj.y, rot, camera, GLOBE_RADIUS);
        assert.ok(Math.abs(inv.sx - pt.sx) < 1e-6, `sx mismatch: ${inv.sx} vs ${pt.sx}`);
        assert.ok(Math.abs(inv.sy - pt.sy) < 1e-6, `sy mismatch: ${inv.sy} vs ${pt.sy}`);
        assert.ok(Math.abs(inv.sz - pt.sz) < 1e-6, `sz mismatch: ${inv.sz} vs ${pt.sz}`);
      }
    }
  }
});

test('renderGlobe handles 0 nodes and 1 node without per-node save/restore', () => {
  const canvas = createMockCanvas();
  const renderer = new AtlasRenderer(canvas);
  const ctx = canvas._ctx;

  // 0 nodes
  const empty = makeScene([]);
  renderer.renderGlobe(empty.bridge, empty.views, empty.state);
  assert.equal(renderer.lastRenderedCount, 0);
  assert.equal(ctx.saveCount, 1);
  assert.equal(ctx.restoreCount, 1);
  assert.equal(ctx.nodeCircles.length, 0);
  assert.equal(ctx.globalAlpha, 1.0);

  // 1 back-hemisphere node (tests globalAlpha reset to 1.0 after loop)
  ctx.saveCount = 0;
  ctx.restoreCount = 0;
  ctx.nodeCircles = [];
  const one = makeScene([{ sx: 0, sy: 0, sz: -1 }]);
  renderer.renderGlobe(one.bridge, one.views, one.state);
  assert.equal(renderer.lastRenderedCount, 1);
  assert.equal(ctx.saveCount, 1);
  assert.equal(ctx.restoreCount, 1);
  assert.equal(ctx.nodeCircles.length, 1);
  assert.ok(Math.abs(ctx.nodeCircles[0].alpha - 0.12) < 1e-6);
  assert.equal(ctx.globalAlpha, 1.0);
});

test('renderGlobe draws nodes in back-to-front depth order', () => {
  const canvas = createMockCanvas();
  const renderer = new AtlasRenderer(canvas);
  const ctx = canvas._ctx;

  // Deliberately unsorted depths: front, back, middle, far-back, far-front
  const specs = [
    { sx: 0, sy: 0, sz: 0.6 },
    { sx: 0, sy: 0, sz: -0.4 },
    { sx: 0, sy: 0, sz: 0.0 },
    { sx: 0, sy: 0, sz: -0.95 },
    { sx: 0, sy: 0, sz: 0.95 },
  ];
  const scene = makeScene(specs);
  renderer.renderGlobe(scene.bridge, scene.views, scene.state);

  assert.equal(ctx.nodeCircles.length, 5);
  assert.deepEqual(
    ctx.nodeCircles.map((c) => c.id),
    ['#node-3', '#node-1', '#node-2', '#node-0', '#node-4']
  );
  assert.equal(ctx.globalAlpha, 1.0);
});

test('sortNodesByDepth clamps out-of-range and NaN depths cleanly', () => {
  const canvas = createMockCanvas();
  const renderer = new AtlasRenderer(canvas);
  const depths = [-5.0, 5.0, 0.0, -1.0, 1.0, Number.NaN];
  renderer.ensureCapacity(depths.length);
  for (let i = 0; i < depths.length; i++) {
    renderer.projDepth[i] = depths[i];
  }
  renderer.sortNodesByDepth(depths.length);

  const ord = Array.from(renderer.order.subarray(0, depths.length));
  assert.equal(new Set(ord).size, depths.length);
  // Bucket 0 has indices 0 (-5.0), 3 (-1.0), 5 (NaN -> 0)
  // Middle has index 2 (0.0)
  // Last bucket has indices 1 (5.0), 4 (1.0)
  assert.ok(ord.indexOf(2) > ord.indexOf(0));
  assert.ok(ord.indexOf(2) > ord.indexOf(3));
  assert.ok(ord.indexOf(1) > ord.indexOf(2));
  assert.ok(ord.indexOf(4) > ord.indexOf(2));
});

test('renderGlobe handles 5000 nodes with O(N) bucket sort and zero per-node save/restore', () => {
  const canvas = createMockCanvas();
  const renderer = new AtlasRenderer(canvas);
  const ctx = canvas._ctx;

  const specs = [];
  for (let i = 0; i < 5000; i++) {
    // Deterministic pseudo-random points on sphere
    const t = ((i * 2654435761) >>> 0) / 4294967296;
    const z = t * 2 - 1;
    const phi = i * 2.399963229728653;
    const rad = Math.sqrt(Math.max(0, 1 - z * z));
    specs.push({
      sx: rad * Math.cos(phi),
      sy: rad * Math.sin(phi),
      sz: z,
      r: i % 250 === 0 ? 24 : 6,
    });
  }

  const scene = makeScene(specs);
  renderer.renderGlobe(scene.bridge, scene.views, scene.state);

  assert.equal(renderer.lastRenderedCount, 5000);
  assert.equal(ctx.saveCount, 1);
  assert.equal(ctx.restoreCount, 1);
  assert.equal(ctx.nodeCircles.length, 5000);
  assert.equal(ctx.globalAlpha, 1.0);

  // Verify bucketed back-to-front ordering (within bucket width 2/1024)
  const bucketWidth = 2.0 / 1024;
  for (let i = 1; i < ctx.nodeCircles.length; i++) {
    const prevIdx = Number(ctx.nodeCircles[i - 1].id.slice(6));
    const currIdx = Number(ctx.nodeCircles[i].id.slice(6));
    assert.ok(
      renderer.projDepth[currIdx] >= renderer.projDepth[prevIdx] - bucketWidth,
      `out-of-order at ${i}: ${renderer.projDepth[prevIdx]} -> ${renderer.projDepth[currIdx]}`
    );
  }
});

test('renderGlobe handles hovered, selected, connected, filtered nodes and reuses connectedSet', () => {
  const canvas = createMockCanvas();
  const renderer = new AtlasRenderer(canvas);
  const ctx = canvas._ctx;

  const specs = [
    { sx: 0, sy: 0, sz: 0.9, title: 'Selected Very Long Title That Must Truncate', field_id: 'algebra', connections: ['n1'] },
    { sx: 0.2, sy: 0.1, sz: 0.8, title: 'Connected', field_id: 'topology' },
    { sx: -0.2, sy: 0.1, sz: 0.7, title: 'Unconnected', field_id: 'algebra' },
    { sx: 0.1, sy: -0.2, sz: 0.6, title: 'Giant', field_id: 'algebra', r: 25 },
  ];

  // Frame 1: selected node 0, activeFieldId 'algebra'
  const scene1 = makeScene(specs, { selectedIdx: 0, activeFieldId: 'algebra' });
  renderer.renderGlobe(scene1.bridge, scene1.views, scene1.state);

  assert.equal(renderer.connectedSet.size, 1);
  assert.ok(renderer.connectedSet.has(1));

  const alphaById = Object.fromEntries(ctx.nodeCircles.map((c) => [c.id, c.alpha]));
  assert.equal(alphaById['#node-0'], 1.0);
  assert.ok(Math.abs(alphaById['#node-1'] - 0.14) < 1e-6);
  assert.ok(Math.abs(alphaById['#node-2'] - 0.25) < 1e-6);

  const labelTexts = ctx.labels.filter((l) => l.kind === 'fill').map((l) => l.text);
  assert.ok(labelTexts.includes('Selected Very Long Title...'));
  assert.ok(labelTexts.includes('Connected'));
  assert.ok(labelTexts.includes('Giant'));
  assert.ok(!labelTexts.includes('Unconnected'));

  // Frame 2: no active node, hovered node cleared -> connectedSet must be cleared
  ctx.nodeCircles = [];
  ctx.labels = [];
  const scene2 = makeScene(specs, { activeFieldId: 'algebra' });
  renderer.renderGlobe(scene2.bridge, scene2.views, scene2.state);
  assert.equal(renderer.connectedSet.size, 0);

  const alphaById2 = Object.fromEntries(ctx.nodeCircles.map((c) => [c.id, c.alpha]));
  assert.ok(Math.abs(alphaById2['#node-1'] - 0.14) < 1e-6);
  assert.equal(ctx.globalAlpha, 1.0);
});
