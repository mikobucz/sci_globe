// Dedicated Web Worker for sci_globe WASM physics simulation
// Uses transferable Float32Array ping-ponging (no SharedArrayBuffer / COOP/COEP required).

import init, { WasmUniverse } from '../pkg/sci_globe.js';

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

let wasm = null;
let universe = null;

function syncAllParams(params) {
  if (!universe || !params) return;
  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const k = PARAM_KEYS[i];
    if (params[k] !== undefined) {
      universe.set_param(k, params[k]);
    }
  }
}

function getOrAllocBuffer(recycled, key, count) {
  const candidate = recycled && recycled[key];
  if (candidate instanceof Float32Array && candidate.length === count) {
    return candidate;
  }
  return new Float32Array(count);
}

function sendFrame(recycled, tempOverride, fromStep = false) {
  if (!universe || !wasm) return;
  const count = universe.node_count();
  const buf = wasm.memory.buffer;
  const temp = tempOverride !== undefined ? tempOverride : universe.temperature();

  const x = getOrAllocBuffer(recycled, 'x', count);
  const y = getOrAllocBuffer(recycled, 'y', count);
  const sx = getOrAllocBuffer(recycled, 'sx', count);
  const sy = getOrAllocBuffer(recycled, 'sy', count);
  const sz = getOrAllocBuffer(recycled, 'sz', count);
  const r = getOrAllocBuffer(recycled, 'r', count);

  if (count > 0) {
    x.set(new Float32Array(buf, universe.x_ptr(), count));
    y.set(new Float32Array(buf, universe.y_ptr(), count));
    sx.set(new Float32Array(buf, universe.sx_ptr(), count));
    sy.set(new Float32Array(buf, universe.sy_ptr(), count));
    sz.set(new Float32Array(buf, universe.sz_ptr(), count));
    r.set(new Float32Array(buf, universe.r_ptr(), count));
  }

  self.postMessage(
    { type: 'frame', temp, count, fromStep, x, y, sx, sy, sz, r },
    [x.buffer, y.buffer, sx.buffer, sy.buffer, sz.buffer, r.buffer]
  );
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'init': {
      try {
        wasm = await init();
        universe = new WasmUniverse();
        self.postMessage({ type: 'ready' });
      } catch (err) {
        self.postMessage({
          type: 'init_error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'load_graph': {
      if (!universe) return;
      universe.set_view_mode(!!msg.isGlobe);
      if (msg.params) {
        syncAllParams(msg.params);
      }
      universe.load_graph(
        msg.initX,
        msg.initY,
        msg.initSx,
        msg.initSy,
        msg.initSz,
        msg.anchorX,
        msg.anchorY,
        msg.anchorSx,
        msg.anchorSy,
        msg.anchorSz,
        msg.citations,
        msg.fieldIdx,
        msg.edgeU,
        msg.edgeV,
        msg.edgeW
      );
      sendFrame(msg.buffers);
      break;
    }

    case 'set_view_mode': {
      if (!universe) return;
      universe.set_view_mode(!!msg.isGlobe);
      break;
    }

    case 'set_param': {
      if (!universe) return;
      universe.set_param(msg.key, msg.val);
      break;
    }

    case 'sync_all_params': {
      syncAllParams(msg.params);
      break;
    }

    case 'reheat': {
      if (!universe) return;
      universe.reheat();
      break;
    }

    case 'scramble': {
      if (!universe) return;
      universe.scramble(msg.seed >>> 0, !!msg.isGlobe);
      sendFrame(msg.buffers);
      break;
    }

    case 'set_dragged_node': {
      if (!universe) return;
      universe.set_dragged_node(msg.idx);
      break;
    }

    case 'move_node_3d': {
      if (!universe) return;
      universe.move_node_3d(msg.idx, msg.sx, msg.sy, msg.sz);
      sendFrame(msg.buffers);
      break;
    }

    case 'apply_positions': {
      if (!universe) return;
      if (Array.isArray(msg.positions)) {
        for (let i = 0; i < msg.positions.length; i++) {
          const p = msg.positions[i];
          if (Array.isArray(p)) {
            universe.move_node_3d(p[0], p[1], p[2], p[3]);
          } else if (p && typeof p === 'object') {
            universe.move_node_3d(p.idx, p.sx, p.sy, p.sz);
          }
        }
      }
      sendFrame(msg.buffers);
      break;
    }

    case 'freeze': {
      if (!universe) return;
      universe.freeze();
      break;
    }

    case 'step': {
      if (!universe) return;
      const temp = universe.step(msg.simSpeed);
      sendFrame(msg.buffers, temp, true);
      break;
    }
  }
};
