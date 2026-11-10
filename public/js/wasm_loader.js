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

export class SimBridge {
  constructor() {
    this.wasm = null;
    this.universe = null;

    this.fullRawData = null;
    this.zones = [];
    this.allAvailableNodes = [];
    this.allAvailableEdges = [];

    // Active subset metadata (titles, colors, connection IDs)
    this.nodes = [];
    this.edges = []; // Array of { uIdx, vIdx, weight }
    this.nodeMap = new Map(); // id -> node object (with .idx)
  }

  async initialize() {
    this.wasm = await init();
    this.universe = new WasmUniverse();
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
    this.universe.scramble(scSeed >>> 0, isGlobe);
  }

  /**
   * Loads an exact precomputed subset and its 3D spherical coordinates without scrambling or re-simulating.
   */
  loadPrecomputedSubset(params, positionsMap, isGlobe) {
    const activeList = this.allAvailableNodes.filter((n) => positionsMap.has(String(n.id)));
    this._uploadActiveListToWasm(activeList, params, isGlobe, positionsMap, null);
    this.universe.freeze();
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
    for (let i = 0; i < this.nodes.length; i++) {
      const id = this.nodes[i].id;
      out[id] = [round6(views.sx[i]), round6(views.sy[i]), round6(views.sz[i])];
    }
    return out;
  }

  syncAllParams(params) {
    if (!this.universe) return;
    const keys = [
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
    for (const k of keys) {
      if (params[k] !== undefined) {
        this.universe.set_param(k, params[k]);
      }
    }
  }

  /**
   * Returns Zero-Copy Float32Array views directly over WebAssembly linear memory.
   */
  getViews() {
    const count = this.universe.node_count();
    const buf = this.wasm.memory.buffer;
    return {
      count,
      x: new Float32Array(buf, this.universe.x_ptr(), count),
      y: new Float32Array(buf, this.universe.y_ptr(), count),
      sx: new Float32Array(buf, this.universe.sx_ptr(), count),
      sy: new Float32Array(buf, this.universe.sy_ptr(), count),
      sz: new Float32Array(buf, this.universe.sz_ptr(), count),
      r: new Float32Array(buf, this.universe.r_ptr(), count),
    };
  }
}

