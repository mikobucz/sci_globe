// High-Performance Zero-Copy Canvas Renderer for sci_globe (3D Globe & 2D Planar)

export const GLOBE_RADIUS = 660;

export function getGlobeRadius(state) {
  return (state && state.params && state.params.globeRadius) ? state.params.globeRadius : GLOBE_RADIUS;
}

export function projectSphere(sx, sy, sz, globeRotation, camera, globeRadius = GLOBE_RADIUS) {
  const cosY = Math.cos(globeRotation.y);
  const sinY = Math.sin(globeRotation.y);
  const x1 = sx * cosY - sz * sinY;
  const z1 = sx * sinY + sz * cosY;

  const cosX = Math.cos(globeRotation.x);
  const sinX = Math.sin(globeRotation.x);
  const y2 = sy * cosX - z1 * sinX;
  const z2 = sy * sinX + z1 * cosX;

  const r = globeRadius * camera.scale;
  return {
    x: camera.x + x1 * r,
    y: camera.y - y2 * r,
    depth: z2,
    rPx: r,
  };
}

/**
 * Inverse projection from 2D screen point onto front hemisphere of S^2
 */
export function unprojectScreenToSphere(clientX, clientY, globeRotation, camera, globeRadius = GLOBE_RADIUS) {
  const r = globeRadius * camera.scale;
  let x1 = (clientX - camera.x) / r;
  let y2 = -(clientY - camera.y) / r;
  const sq = x1 * x1 + y2 * y2;
  let z2 = 0;
  if (sq > 1.0) {
    const inv = 1.0 / Math.sqrt(sq);
    x1 *= inv;
    y2 *= inv;
  } else {
    z2 = Math.sqrt(1.0 - sq);
  }

  const cosX = Math.cos(globeRotation.x);
  const sinX = Math.sin(globeRotation.x);
  const sy = y2 * cosX + z2 * sinX;
  const z1 = -y2 * sinX + z2 * cosX;

  const cosY = Math.cos(globeRotation.y);
  const sinY = Math.sin(globeRotation.y);
  const sx = x1 * cosY + z1 * sinY;
  const sz = -x1 * sinY + z1 * cosY;

  return { sx, sy, sz };
}

export class AtlasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.projX = new Float32Array(0);
    this.projY = new Float32Array(0);
    this.projDepth = new Float32Array(0);
    this.order = new Int32Array(0);
    this.lastRenderedCount = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ensureCapacity(n) {
    if (this.projX.length < n) {
      this.projX = new Float32Array(n);
      this.projY = new Float32Array(n);
      this.projDepth = new Float32Array(n);
      this.order = new Int32Array(n);
    }
  }

  render(bridge, views, state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.renderGlobe(bridge, views, state);
  }

  renderGlobe(bridge, views, state) {
    const ctx = this.ctx;
    const { camera, globeRotation, params, hoveredNode, selectedNode } = state;
    const cx = camera.x;
    const cy = camera.y;
    const globeRadius = params.globeRadius || GLOBE_RADIUS;
    const r = globeRadius * camera.scale;
    const n = views.count;
    this.ensureCapacity(n);

    // 1. Planet body & cartographic graticule
    ctx.save();
    const globeGrad = ctx.createRadialGradient(
      cx - r * 0.3,
      cy - r * 0.3,
      r * 0.1,
      cx,
      cy,
      r
    );
    globeGrad.addColorStop(0, '#151922');
    globeGrad.addColorStop(0.85, '#0d1015');
    globeGrad.addColorStop(1, '#080a0d');

    ctx.fillStyle = globeGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1d222d';
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      const radLat = (lat * Math.PI) / 180;
      const cosLat = Math.cos(radLat);
      const sinLat = Math.sin(radLat);
      let penDown = false;
      for (let lon = 0; lon <= 360; lon += 6) {
        const radLon = (lon * Math.PI) / 180;
        const p = projectSphere(
          cosLat * Math.sin(radLon),
          sinLat,
          cosLat * Math.cos(radLon),
          globeRotation,
          camera,
          globeRadius
        );
        if (p.depth > 0) {
          if (!penDown) {
            ctx.moveTo(p.x, p.y);
            penDown = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        } else {
          penDown = false;
        }
      }
      ctx.stroke();
    }

    ctx.strokeStyle = '#2d3342';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Project all nodes from Wasm SoA buffers
    const cosY = Math.cos(globeRotation.y);
    const sinY = Math.sin(globeRotation.y);
    const cosX = Math.cos(globeRotation.x);
    const sinX = Math.sin(globeRotation.x);
    const sxArr = views.sx;
    const syArr = views.sy;
    const szArr = views.sz;
    const rArr = views.r;

    for (let i = 0; i < n; i++) {
      const sx = sxArr[i];
      const sy = syArr[i];
      const sz = szArr[i];
      const x1 = sx * cosY - sz * sinY;
      const z1 = sx * sinY + sz * cosY;
      const y2 = sy * cosX - z1 * sinX;
      const z2 = sy * sinX + z1 * cosX;

      this.projX[i] = cx + x1 * r;
      this.projY[i] = cy - y2 * r;
      this.projDepth[i] = z2;
      this.order[i] = i;
    }

    // 2. Citation edges on sphere
    const active = selectedNode || hoveredNode;
    if (params.showAllLines) {
      ctx.strokeStyle = '#1c212c';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      const edges = bridge.edges;
      for (let i = 0; i < edges.length; i++) {
        const u = edges[i].uIdx;
        const v = edges[i].vIdx;
        if (this.projDepth[u] > 0 && this.projDepth[v] > 0) {
          ctx.moveTo(this.projX[u], this.projY[u]);
          ctx.lineTo(this.projX[v], this.projY[v]);
        }
      }
      ctx.stroke();
    }

    const connectedSet = new Set();
    if (active) {
      const aIdx = active.idx;
      const ax = this.projX[aIdx];
      const ay = this.projY[aIdx];
      const aDepth = this.projDepth[aIdx];

      ctx.strokeStyle = active.color;
      ctx.lineWidth = 2.0;
      for (let k = 0; k < active.connections.length; k++) {
        const cid = active.connections[k];
        const t = bridge.nodeMap.get(cid);
        if (!t) continue;
        connectedSet.add(t.idx);
        const tIdx = t.idx;
        if (aDepth > -0.2 || this.projDepth[tIdx] > -0.2) {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          const mx = (ax + this.projX[tIdx]) * 0.5;
          const my = (ay + this.projY[tIdx]) * 0.5;
          ctx.quadraticCurveTo(mx, my, this.projX[tIdx], this.projY[tIdx]);
          ctx.stroke();
        }
      }
    }

    // 3. Depth-sorted nodes
    this.lastRenderedCount = n;
    const ord = this.order.subarray(0, n);
    const depths = this.projDepth;
    ord.sort((a, b) => depths[a] - depths[b]);

    const activeFieldId = state.activeFieldId || null;
    const nodes = bridge.nodes;
    for (let k = 0; k < n; k++) {
      const idx = ord[k];
      const node = nodes[idx];
      const px = this.projX[idx];
      const py = this.projY[idx];
      const depth = depths[idx];
      const nr = rArr[idx];

      const isHovered = hoveredNode === node;
      const isSelected = selectedNode === node;
      const isConnected = connectedSet.has(idx);
      const matchesField = !activeFieldId || node.field_id === activeFieldId;

      const isVisibleFront = depth > -0.05;
      let alpha = isVisibleFront ? 1.0 : 0.12;
      if (active && !isHovered && !isSelected && !isConnected) {
        alpha *= 0.25;
      } else if (activeFieldId && !matchesField) {
        alpha *= 0.14;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      const rad = Math.max(3.0, nr * camera.scale);
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      ctx.lineWidth = 1.0;
      ctx.strokeStyle = isSelected
        ? '#ffffff'
        : isHovered
        ? '#58a6ff'
        : '#080a0d';
      ctx.stroke();

      const isGiant = nr >= 22.0 && matchesField;
      if (isVisibleFront && (isGiant || isHovered || isSelected || isConnected)) {
        const fontSize = isGiant
          ? Math.max(10, Math.min(14, rad * 0.45))
          : 11;
        ctx.font = `${fontSize}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0e1013';
        ctx.lineWidth = 2.5;

        const title =
          node.title.length > 26
            ? node.title.substring(0, 24) + '...'
            : node.title;
        ctx.strokeText(title, px, py + rad + 3);
        ctx.fillText(title, px, py + rad + 3);
      }

      ctx.restore();
    }
  }
}

