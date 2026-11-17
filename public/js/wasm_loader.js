// Zero-Copy WebAssembly Loader & State Manager for sci_globe

import init, { WasmUniverse } from '../pkg/sci_globe.js';

// Deterministic Mulberry32 PRNG for dataset sampling
export function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function extractXYZ(val) {
  if (Array.isArray(val) && val.length >= 3) {
    const x = Number(val[0]);
    const y = Number(val[1]);
    const z = Number(val[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  } else if (val && typeof val === 'object') {
    const x = Number(val.sx ?? val.x);
    const y = Number(val.sy ?? val.y);
    const z = Number(val.sz ?? val.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }
  return null;
}

/**
 * Parses snapshot JSON in any supported shape:
 * - { positions: { id: [x,y,z] | {x,y,z} | {sx,sy,sz} }, dataset?, globeRadius?, params?, name? }
 * - { nodes: [{ id, sx/x, sy/y, sz/z }, ...], ... }
 * - Flat object { "W123": [x, y, z], "W456": { x, y, z }, ... }
 */
export function parseSnapshotPayload(raw) {
  const positionsMap = new Map();
  const meta = {
    dataset: undefined,
    globeRadius: undefined,
    onlyConnected: undefined,
    params: undefined,
    name: undefined,
  };

  if (!raw || typeof raw !== 'object') {
    return { positionsMap, meta };
  }

  if (typeof raw.dataset === 'string') meta.dataset = raw.dataset;
  if (typeof raw.globeRadius === 'number') meta.globeRadius = raw.globeRadius;
  if (typeof raw.onlyConnected === 'boolean') meta.onlyConnected = raw.onlyConnected;
  if (raw.params && typeof raw.params === 'object') meta.params = raw.params;
  if (typeof raw.name === 'string') meta.name = raw.name;

  if (raw.positions && typeof raw.positions === 'object' && !Array.isArray(raw.positions)) {
    for (const [id, val] of Object.entries(raw.positions)) {
      const xyz = extractXYZ(val);
      if (xyz) positionsMap.set(String(id), xyz);
    }
  } else if (Array.isArray(raw.nodes)) {
    for (const item of raw.nodes) {
      if (!item || item.id === undefined) continue;
      const xyz = extractXYZ(item);
      if (xyz) positionsMap.set(String(item.id), xyz);
    }
  } else if (!Array.isArray(raw)) {
    for (const [id, val] of Object.entries(raw)) {
      const xyz = extractXYZ(val);
      if (xyz) positionsMap.set(String(id), xyz);
    }
  }

  return { positionsMap, meta };
}

const PARAM_KEYS = [
  'radiusScale',
  'anchorStrength',
  'subfieldCohesion',
  'ghostAnnealing',
  'nebulaRepulsion',
  'nebulaCutoff',
  'centerGravity',
  'giantGravity',
  'springStiffness',
  'degreeNorm',
  'bridgeMult',
  'springGap',
  'sizeExponent',
  'massExponent',
  'collisionMargin',
  'globeRadius',
];

function emptyViews() {
  return {
    count: 0,
    x: new Float32Array(0),
    y: new Float32Array(0),
    sx: new Float32Array(0),
    sy: new Float32Array(0),
    sz: new Float32Array(0),
    r: new Float32Array(0),
  };
}

export class SimBridge {
  constructor() {
    this.wasm = null;
    this.universe = null;
    this.worker = null;
    this.useWorker = false;

    this.views = emptyViews();
    this._recycledBuffers = null;
    this.stepInFlight = false;
    this.lastTemp = 1.0;
    this.hasStepResult = false;

    this._cachedDirectViews = null;
    this._cachedDirectBuf = null;
    this._cachedDirectPtrs = null;

    this.fullRawData = null;
    this.zones = [];
    this.allAvailableNodes = [];
    this.allAvailableEdges = [];

    // Active subset metadata (titles, colors, connection IDs)
    this.nodes = [];
    this.edges = []; // Array of { uIdx, vIdx, weight }
    this.nodeMap = new Map(); // id -> node object (with .idx)
  }

  async initialize(options = {}) {
    const allowWorker = options.useWorker !== false && typeof Worker !== 'undefined';
    if (allowWorker) {
      try {
        await this._initWorker();
        return;
      } catch (err) {
        console.warn('SimBridge worker init failed, falling back to main-thread WASM:', err);
        this.terminate();
      }
    }

    this.useWorker = false;
    this.wasm = await init();
    this.universe = new WasmUniverse();
  }

  _initWorker() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(new URL('./sim_worker.js', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;

      const onInitError = (err) => {
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err?.message || err || 'Worker init error')));
        }
      };

      worker.onerror = onInitError;
      worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg || !msg.type) return;

        if (!settled) {
          if (msg.type === 'ready') {
            settled = true;
            this.useWorker = true;
            worker.onerror = (err) => {
              console.error('SimBridge worker error:', err);
            };
            resolve();
            return;
          }
          if (msg.type === 'init_error') {
            onInitError(msg.error);
            return;
          }
        }

        this._handleWorkerMessage(msg);
      };

      worker.postMessage({ type: 'init' });
    });
  }

  _handleWorkerMessage(msg) {
    if (msg.type !== 'frame') return;

    if (msg.fromStep) {
      this.stepInFlight = false;
      this.hasStepResult = true;
    }
    if (typeof msg.temp === 'number') {
      this.lastTemp = msg.temp;
    }

    const prev = this.views;
    if (
      prev &&
      prev.count === msg.count &&
      prev.count > 0 &&
      prev.x &&
      prev.x.buffer.byteLength > 0
    ) {
      this._recycledBuffers = {
        x: prev.x,
        y: prev.y,
        sx: prev.sx,
        sy: prev.sy,
        sz: prev.sz,
        r: prev.r,
      };
    }

    this.views = {
      count: msg.count,
      x: msg.x,
      y: msg.y,
      sx: msg.sx,
      sy: msg.sy,
      sz: msg.sz,
      r: msg.r,
    };
  }

  _takeRecycledBuffers(expectedCount) {
    const buf = this._recycledBuffers;
    if (
      buf &&
      buf.x instanceof Float32Array &&
      buf.x.length === expectedCount &&
      buf.x.buffer.byteLength > 0
    ) {
      this._recycledBuffers = null;
      return buf;
    }
    return null;
  }

  _transferList(buffers) {
    return [
      buffers.x.buffer,
      buffers.y.buffer,
      buffers.sx.buffer,
      buffers.sy.buffer,
      buffers.sz.buffer,
      buffers.r.buffer,
    ];
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.useWorker = false;
    this.stepInFlight = false;
  }

  async loadDatasetFile(datasetName) {
    const file = datasetName === 'math' ? 'live_data.json' : 'global_data.json';
    const resp = await fetch(file);
    this.fullRawData = await resp.json();
    this.zones = this.fullRawData.zones || [];
    this.allAvailableNodes = this.fullRawData.nodes || [];
    this.allAvailableEdges = this.fullRawData.edges || [];
  }

  rebuildSubset(params, isGlobe) {
    const rng = mulberry32(params.datasetSeed);

    let candidatePool = this.allAvailableNodes;
    if (params.onlyConnected) {
      candidatePool = this.allAvailableNodes.filter(
        (n) => n.connections && n.connections.length > 0
      );
    }

    const targetCount = Math.min(params.sampleCount, candidatePool.length);
    const shuffled = [...candidatePool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    let activeList = shuffled.slice(0, targetCount);

    if (params.onlyConnected) {
      const subIds = new Set(activeList.map((n) => n.id));
      const connectedSubIds = new Set();
      for (let i = 0; i < this.allAvailableEdges.length; i++) {
        const e = this.allAvailableEdges[i];
        if (subIds.has(e.source) && subIds.has(e.target)) {
          connectedSubIds.add(e.source);
          connectedSubIds.add(e.target);
        }
      }

      if (connectedSubIds.size < targetCount && shuffled.length > targetCount) {
        for (
          let i = targetCount;
          i < shuffled.length && connectedSubIds.size < targetCount;
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
    }

    this._uploadActiveListToWasm(activeList, params, isGlobe, null, rng);
    const scSeed = parseInt(params.scrambleSeed, 10) || 42;
    this.scramble(scSeed >>> 0, isGlobe);
  }

  /**
   * Loads an exact precomputed subset and its 3D spherical coordinates without scrambling or re-simulating.
   */
  loadPrecomputedSubset(params, positionsMap, isGlobe) {
    const activeList = this.allAvailableNodes.filter((n) => positionsMap.has(String(n.id)));
    this._uploadActiveListToWasm(activeList, params, isGlobe, positionsMap, null);
    this.freeze();
    return {
      loadedCount: activeList.length,
      requestedCount: positionsMap.size,
    };
  }

  _uploadActiveListToWasm(activeList, params, isGlobe, positionLookup = null, rng = null) {
    const rand = rng || mulberry32(params.datasetSeed || 1337);
    this.nodeMap.clear();
    const fieldMap = new Map();
    this.zones.forEach((z, idx) => fieldMap.set(z.id, idx));

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

    this.nodes = activeList.map((raw, idx) => {
      const fid = raw.field_id || raw.subfield_id;
      const zIdx = fieldMap.has(fid) ? fieldMap.get(fid) : 0;
      const zone = this.zones[zIdx] || { cx: 0, cy: 0, sx: 0, sy: 1, sz: 0 };

      const x0 =
        raw.initX !== undefined && Math.abs(raw.initX) < 1000
          ? raw.initX
          : (rand() - 0.5) * 300;
      const y0 =
        raw.initY !== undefined && Math.abs(raw.initY) < 1000
          ? raw.initY
          : (rand() - 0.5) * 300;

      const pre = positionLookup ? positionLookup.get(String(raw.id)) : null;
      let sx0 = pre ? pre[0] : raw.sx !== undefined ? raw.sx : (rand() - 0.5) * 2;
      let sy0 = pre ? pre[1] : raw.sy !== undefined ? raw.sy : (rand() - 0.5) * 2;
      let sz0 = pre ? pre[2] : raw.sz !== undefined ? raw.sz : (rand() - 0.5) * 2;
      const len = Math.hypot(sx0, sy0, sz0) || 1;
      sx0 /= len;
      sy0 /= len;
      sz0 /= len;

      initX[idx] = x0;
      initY[idx] = y0;
      initSx[idx] = sx0;
      initSy[idx] = sy0;
      initSz[idx] = sz0;

      anchorX[idx] = raw.anchorX !== undefined ? raw.anchorX : zone.cx || 0;
      anchorY[idx] = raw.anchorY !== undefined ? raw.anchorY : zone.cy || 0;
      anchorSx[idx] = raw.anchor_sx !== undefined ? raw.anchor_sx : zone.sx || sx0;
      anchorSy[idx] = raw.anchor_sy !== undefined ? raw.anchor_sy : zone.sy || sy0;
      anchorSz[idx] = raw.anchor_sz !== undefined ? raw.anchor_sz : zone.sz || sz0;

      citations[idx] = raw.citations || 1;
      fieldIdx[idx] = zIdx;

      const nodeObj = {
        idx,
        id: raw.id,
        title: raw.title,
        citations: raw.citations || 0,
        year: raw.year,
        color: raw.color,
        field_id: fid,
        field_name: raw.field_name || raw.subfield_name || 'Science',
        connections: raw.connections || [],
      };
      this.nodeMap.set(nodeObj.id, nodeObj);
      return nodeObj;
    });

    const validEdges = [];
    for (let i = 0; i < this.allAvailableEdges.length; i++) {
      const e = this.allAvailableEdges[i];
      const u = this.nodeMap.get(e.source);
      const v = this.nodeMap.get(e.target);
      if (u && v) {
        validEdges.push({ uIdx: u.idx, vIdx: v.idx, weight: e.weight || 1.0 });
      }
    }
    this.edges = validEdges;

    const m = validEdges.length;
    const edgeU = new Uint32Array(m);
    const edgeV = new Uint32Array(m);
    const edgeW = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      edgeU[i] = validEdges[i].uIdx;
      edgeV[i] = validEdges[i].vIdx;
      edgeW[i] = validEdges[i].weight;
    }

    if (this.useWorker && this.worker) {
      this.views = emptyViews();
      this._recycledBuffers = null;
      this.stepInFlight = false;
      this.hasStepResult = false;
      this.lastTemp = 1.0;

      const filteredParams = {};
      if (params) {
        for (const k of PARAM_KEYS) {
          if (params[k] !== undefined) filteredParams[k] = params[k];
        }
      }

      const transfers = [
        initX.buffer,
        initY.buffer,
        initSx.buffer,
        initSy.buffer,
        initSz.buffer,
        anchorX.buffer,
        anchorY.buffer,
        anchorSx.buffer,
        anchorSy.buffer,
        anchorSz.buffer,
        citations.buffer,
        fieldIdx.buffer,
        edgeU.buffer,
        edgeV.buffer,
        edgeW.buffer,
      ];

      this.worker.postMessage(
        {
          type: 'load_graph',
          isGlobe,
          params: filteredParams,
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
        },
        transfers
      );
      return;
    }

    this.universe.set_view_mode(isGlobe);
    this.syncAllParams(params);
    this.universe.load_graph(
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
      edgeW
    );
  }

  exportPositionsObject() {
    const views = this.getViews();
    const out = {};
    const round6 = (v) => Math.round(v * 1e6) / 1e6;
    const len = Math.min(this.nodes.length, views.count);
    for (let i = 0; i < len; i++) {
      const id = this.nodes[i].id;
      out[id] = [round6(views.sx[i]), round6(views.sy[i]), round6(views.sz[i])];
    }
    return out;
  }

  setViewMode(isGlobe) {
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'set_view_mode', isGlobe: !!isGlobe });
      return;
    }
    if (this.universe) this.universe.set_view_mode(!!isGlobe);
  }

  setParam(k, v) {
    this.hasStepResult = false;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'set_param', key: k, val: v });
      return;
    }
    if (this.universe) this.universe.set_param(k, v);
  }

  syncAllParams(params) {
    if (!params) return;
    if (this.useWorker && this.worker) {
      const filtered = {};
      for (const k of PARAM_KEYS) {
        if (params[k] !== undefined) filtered[k] = params[k];
      }
      this.worker.postMessage({ type: 'sync_all_params', params: filtered });
      return;
    }
    if (!this.universe) return;
    for (const k of PARAM_KEYS) {
      if (params[k] !== undefined) {
        this.universe.set_param(k, params[k]);
      }
    }
  }

  reheat() {
    this.hasStepResult = false;
    this.lastTemp = 1.0;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'reheat' });
      return;
    }
    if (this.universe) this.universe.reheat();
  }

  scramble(seed, isGlobe) {
    this.hasStepResult = false;
    this.lastTemp = 1.0;
    const s = seed >>> 0;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'scramble', seed: s, isGlobe: !!isGlobe });
      return;
    }
    if (this.universe) this.universe.scramble(s, !!isGlobe);
  }

  setDraggedNode(idx) {
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'set_dragged_node', idx });
      return;
    }
    if (this.universe) this.universe.set_dragged_node(idx);
  }

  moveNode3d(idx, sx, sy, sz) {
    // Immediate main-thread update for 0-latency visual feedback during dragging
    if (this.views && idx >= 0 && idx < this.views.count) {
      this.views.sx[idx] = sx;
      this.views.sy[idx] = sy;
      this.views.sz[idx] = sz;
    }
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'move_node_3d', idx, sx, sy, sz });
      return;
    }
    if (this.universe) this.universe.move_node_3d(idx, sx, sy, sz);
  }

  applyPositions(positions) {
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'apply_positions', positions });
      return;
    }
    if (this.universe && Array.isArray(positions)) {
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (Array.isArray(p)) {
          this.universe.move_node_3d(p[0], p[1], p[2], p[3]);
        } else if (p && typeof p === 'object') {
          this.universe.move_node_3d(p.idx, p.sx, p.sy, p.sz);
        }
      }
    }
  }

  freeze() {
    this.hasStepResult = false;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ type: 'freeze' });
      return;
    }
    if (this.universe) this.universe.freeze();
  }

  requestStep(simSpeed) {
    if (this.useWorker && this.worker) {
      if (this.stepInFlight) return false;
      this.stepInFlight = true;
      const buffers = this._takeRecycledBuffers(this.views.count);
      if (buffers) {
        this.worker.postMessage(
          { type: 'step', simSpeed, buffers },
          this._transferList(buffers)
        );
      } else {
        this.worker.postMessage({ type: 'step', simSpeed });
      }
      return true;
    }
    if (!this.universe) return false;
    this.lastTemp = this.universe.step(simSpeed);
    this.hasStepResult = true;
    return true;
  }

  /**
   * Returns latest Float32Array views (from worker ping-pong buffers or zero-copy WASM memory).
   */
  getViews() {
    if (this.useWorker) {
      return this.views;
    }
    const count = this.universe.node_count();
    const buf = this.wasm.memory.buffer;
    const xPtr = this.universe.x_ptr();
    const yPtr = this.universe.y_ptr();
    const sxPtr = this.universe.sx_ptr();
    const syPtr = this.universe.sy_ptr();
    const szPtr = this.universe.sz_ptr();
    const rPtr = this.universe.r_ptr();

    const p = this._cachedDirectPtrs;
    if (
      this._cachedDirectViews &&
      this._cachedDirectViews.count === count &&
      this._cachedDirectBuf === buf &&
      p &&
      p[0] === xPtr &&
      p[1] === yPtr &&
      p[2] === sxPtr &&
      p[3] === syPtr &&
      p[4] === szPtr &&
      p[5] === rPtr
    ) {
      return this._cachedDirectViews;
    }

    this._cachedDirectBuf = buf;
    this._cachedDirectPtrs = [xPtr, yPtr, sxPtr, syPtr, szPtr, rPtr];
    this._cachedDirectViews = {
      count,
      x: new Float32Array(buf, xPtr, count),
      y: new Float32Array(buf, yPtr, count),
      sx: new Float32Array(buf, sxPtr, count),
      sy: new Float32Array(buf, syPtr, count),
      sz: new Float32Array(buf, szPtr, count),
      r: new Float32Array(buf, rPtr, count),
    };
    return this._cachedDirectViews;
  }
}

