// User Interface, Kittens Game Controls, Camera, and Main Simulation Loop

import { SimBridge, mulberry32 } from './wasm_loader.js';
import {
  AtlasRenderer,
  projectSphere,
  unprojectScreenToSphere,
} from './renderer.js';

const canvas = document.getElementById('atlas-canvas');
const tooltip = document.getElementById('tooltip');
const inspector = document.getElementById('inspector');
const sidebar = document.getElementById('sidebar');

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const nodeCountEl = document.getElementById('node-count');
const btnViewToggle = document.getElementById('btn-view-toggle');
const btnToggleOptions = document.getElementById('btn-toggle-options');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');

const bridge = new SimBridge();
const renderer = new AtlasRenderer(canvas);

const state = {
  viewMode: 'GLOBE',
  globeRotation: { x: 0.35, y: -0.2 },
  camera: {
    x: 0,
    y: 0,
    scale: 0.75,
    targetX: 0,
    targetY: 0,
    targetScale: 0.75,
  },
  params: {
    dataset: 'global',
    sampleCount: 1000,
    datasetSeed: 1337,
    onlyConnected: false,
    scrambleSeed: 42,
    simSpeed: 2,
    radiusScale: 0.75,
    anchorStrength: 0.35,
    subfieldCohesion: 0.0,
    ghostAnnealing: 0.1,
    nebulaRepulsion: 0.0,
    centerGravity: 0.0012,
    giantGravity: 0.0,
    springStiffness: 0.035,
    degreeNorm: 0.55,
    bridgeMult: 2.0,
    springGap: 6.0,
    sizeExponent: 0.36,
    massExponent: 1.8,
    collisionMargin: 2.0,
    showAllLines: false,
    showZones: true,
  },
  hoveredNode: null,
  selectedNode: null,
  draggedNode: null,
  isSimRunning: true,
  isPaused: false,
};

let isPanning = false;
let dragStartX = 0;
let dragStartY = 0;
let lastMouseX = 0;
let lastMouseY = 0;
let growthInterval = null;

async function boot() {
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  await bridge.initialize();
  await loadDataset(state.params.dataset);

  setupEventListeners();
  setupSidebarBindings();
  syncInputsWithParams();
  updateViewToggleBtn();

  requestAnimationFrame(mainLoop);
}

async function loadDataset(datasetName) {
  await bridge.loadDatasetFile(datasetName);
  rebuildActiveSubset();
  resetCameraView();
}

function rebuildActiveSubset() {
  if (growthInterval) {
    clearInterval(growthInterval);
    growthInterval = null;
  }
  const isGlobe = state.viewMode === 'GLOBE';
  bridge.rebuildSubset(state.params, isGlobe);
  nodeCountEl.innerText = `${bridge.nodes.length.toLocaleString()} prac`;
  markSimActive();
}

function markSimActive() {
  bridge.universe.reheat();
  state.isSimRunning = true;
  statusDot.className = 'status-dot';
  statusText.innerText = 'Aktywna (Wasm)';
}

function updateViewToggleBtn() {
  if (state.viewMode === 'GLOBE') {
    btnViewToggle.innerText = '[ Widok: Glob 3D | Przełącz na 2D ]';
  } else {
    btnViewToggle.innerText = '[ Widok: Płaski 2D | Przełącz na Glob 3D ]';
  }
}

function resetCameraView() {
  state.camera.targetX = window.innerWidth / 2;
  state.camera.targetY = window.innerHeight / 2;
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  state.camera.targetScale =
    state.viewMode === 'GLOBE' ? minDim / 1420 : minDim / 1850;
  state.camera.x = state.camera.targetX;
  state.camera.y = state.camera.targetY;
  state.camera.scale = state.camera.targetScale;
}

function scrambleConfetti(rollNewSeed = true) {
  const seedInput = document.getElementById('input-scramble-seed');
  let seedVal = parseInt(seedInput.value, 10) || 42;
  if (rollNewSeed) {
    seedVal = Math.floor(Math.random() * 899999) + 100000;
    seedInput.value = seedVal;
    state.params.scrambleSeed = seedVal;
  }
  bridge.universe.scramble(seedVal >>> 0, state.viewMode === 'GLOBE');
  markSimActive();
}

function growOrganically() {
  if (growthInterval) {
    clearInterval(growthInterval);
    growthInterval = null;
  }
  if (state.viewMode === 'GLOBE') {
    state.viewMode = '2D';
    updateViewToggleBtn();
    bridge.universe.set_view_mode(false);
    resetCameraView();
  }

  const seedVal =
    parseInt(document.getElementById('input-scramble-seed').value, 10) || 42;
  const rng = mulberry32(seedVal);
  const sorted = [...bridge.nodes].sort((a, b) => b.citations - a.citations);
  const topCount = Math.min(25, sorted.length);

  sorted.forEach((n, idx) => {
    if (idx < topCount) {
      const a = (idx / topCount) * Math.PI * 2;
      const rad = 40 + rng() * 100;
      bridge.universe.move_node_2d(n.idx, Math.cos(a) * rad, Math.sin(a) * rad);
    } else {
      bridge.universe.move_node_2d(n.idx, 99999, 99999);
    }
  });

  let curIdx = topCount;
  growthInterval = setInterval(() => {
    if (curIdx >= sorted.length) {
      clearInterval(growthInterval);
      growthInterval = null;
      return;
    }
    const views = bridge.getViews();
    const batch = Math.min(30, sorted.length - curIdx);
    for (let b = 0; b < batch; b++) {
      const n = sorted[curIdx++];
      const parentId = n.connections.find((id) => {
        const p = bridge.nodeMap.get(id);
        return p && views.x[p.idx] < 50000;
      });
      const parent = parentId ? bridge.nodeMap.get(parentId) : null;
      if (parent) {
        const ang = rng() * Math.PI * 2;
        const dist = views.r[parent.idx] + views.r[n.idx] + 4;
        bridge.universe.move_node_2d(
          n.idx,
          views.x[parent.idx] + Math.cos(ang) * dist,
          views.y[parent.idx] + Math.sin(ang) * dist
        );
      } else {
        const ang = rng() * Math.PI * 2;
        const dist = 180 + rng() * 120;
        bridge.universe.move_node_2d(
          n.idx,
          Math.cos(ang) * dist,
          Math.sin(ang) * dist
        );
      }
    }
    markSimActive();
  }, 50);

  markSimActive();
}

function setupSidebarBindings() {
  btnToggleOptions.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  btnCloseSidebar.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });

  btnViewToggle.addEventListener('click', () => {
    state.viewMode = state.viewMode === 'GLOBE' ? '2D' : 'GLOBE';
    updateViewToggleBtn();
    bridge.universe.set_view_mode(state.viewMode === 'GLOBE');
    resetCameraView();
    markSimActive();
  });

  document.getElementById('select-dataset').addEventListener('change', async (e) => {
    state.params.dataset = e.target.value;
    await loadDataset(state.params.dataset);
  });

  const sampleSlider = document.getElementById('p-sample-count');
  const sampleNum = document.getElementById('num-sample-count');
  const updateSample = (val) => {
    state.params.sampleCount = parseInt(val, 10) || 1000;
    sampleSlider.value = state.params.sampleCount;
    sampleNum.value = state.params.sampleCount;
    rebuildActiveSubset();
  };
  sampleSlider.addEventListener('input', (e) => updateSample(e.target.value));
  sampleNum.addEventListener('change', (e) => updateSample(e.target.value));

  document.getElementById('input-dataset-seed').addEventListener('change', (e) => {
    state.params.datasetSeed = parseInt(e.target.value, 10) || 1337;
    rebuildActiveSubset();
  });

  const chkOnlyConnected = document.getElementById('chk-only-connected');
  chkOnlyConnected.addEventListener('change', (e) => {
    state.params.onlyConnected = e.target.checked;
    rebuildActiveSubset();
  });

  const bindPair = (sliderId, numId, paramKey, isInteger = false) => {
    const slider = document.getElementById(sliderId);
    const numInput = document.getElementById(numId);

    slider.addEventListener('input', (e) => {
      const val = isInteger
        ? parseInt(e.target.value, 10)
        : parseFloat(e.target.value);
      numInput.value = val;
      state.params[paramKey] = val;
      if (paramKey !== 'simSpeed') {
        bridge.universe.set_param(paramKey, val);
      }
      markSimActive();
    });

    numInput.addEventListener('change', (e) => {
      let val = isInteger
        ? parseInt(e.target.value, 10)
        : parseFloat(e.target.value);
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      if (isNaN(val)) val = state.params[paramKey];
      val = Math.max(min, Math.min(max, val));
      numInput.value = val;
      slider.value = val;
      state.params[paramKey] = val;
      if (paramKey !== 'simSpeed') {
        bridge.universe.set_param(paramKey, val);
      }
      markSimActive();
    });
  };

  bindPair('p-speed', 'num-speed', 'simSpeed', true);
  bindPair('p-scale', 'num-scale', 'radiusScale');
  bindPair('p-anchor', 'num-anchor', 'anchorStrength');
  bindPair('p-cohesion', 'num-cohesion', 'subfieldCohesion');
  bindPair('p-ghost', 'num-ghost', 'ghostAnnealing');
  bindPair('p-nebula', 'num-nebula', 'nebulaRepulsion');
  bindPair('p-center', 'num-center', 'centerGravity');
  bindPair('p-giant', 'num-giant', 'giantGravity');
  bindPair('p-spring', 'num-spring', 'springStiffness');
  bindPair('p-deg-norm', 'num-deg-norm', 'degreeNorm');
  bindPair('p-bridge', 'num-bridge', 'bridgeMult');
  bindPair('p-gap', 'num-gap', 'springGap');
  bindPair('p-gamma', 'num-gamma', 'sizeExponent');
  bindPair('p-mass', 'num-mass', 'massExponent');
  bindPair('p-margin', 'num-margin', 'collisionMargin');

  document.getElementById('chk-all-lines').addEventListener('change', (e) => {
    state.params.showAllLines = e.target.checked;
  });
  document.getElementById('chk-zones').addEventListener('change', (e) => {
    state.params.showZones = e.target.checked;
  });

  document
    .getElementById('btn-scramble')
    .addEventListener('click', () => scrambleConfetti(true));

  const inputScramble = document.getElementById('input-scramble-seed');
  if (inputScramble) {
    inputScramble.addEventListener('change', (e) => {
      state.params.scrambleSeed = parseInt(e.target.value, 10) || 42;
      scrambleConfetti(false);
    });
  }

  document.getElementById('btn-grow').addEventListener('click', growOrganically);
  document.getElementById('btn-reheat').addEventListener('click', markSimActive);

  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => {
    state.isPaused = !state.isPaused;
    btnPause.innerText = state.isPaused ? '[ wznów ]' : '[ pauza ]';
    btnPause.classList.toggle('active', state.isPaused);
  });

  document
    .getElementById('btn-reset-view')
    .addEventListener('click', resetCameraView);

  const selectPreset = document.getElementById('select-preset');
  const inputPresetName = document.getElementById('input-preset-name');
  const btnSavePreset = document.getElementById('btn-save-preset');
  const btnDeletePreset = document.getElementById('btn-delete-preset');

  const STORAGE_KEY = 'mathmap_custom_presets_v1';
  let customPresets = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) customPresets = JSON.parse(raw) || {};
  } catch (_) {
    customPresets = {};
  }

  const SNAPSHOT_KEYS = [
    'simSpeed',
    'radiusScale',
    'anchorStrength',
    'subfieldCohesion',
    'ghostAnnealing',
    'nebulaRepulsion',
    'centerGravity',
    'giantGravity',
    'springStiffness',
    'degreeNorm',
    'bridgeMult',
    'springGap',
    'sizeExponent',
    'massExponent',
    'collisionMargin',
    'onlyConnected',
    'showAllLines',
    'showZones',
  ];

  const rebuildPresetOptions = (selectedValue = null) => {
    // Remove previously rendered custom options
    const existingCustom = selectPreset.querySelectorAll('option[data-custom="1"]');
    existingCustom.forEach((opt) => opt.remove());

    const names = Object.keys(customPresets);
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = `custom:${name}`;
      opt.textContent = `[Własny] ${name}`;
      opt.setAttribute('data-custom', '1');
      selectPreset.appendChild(opt);
    });

    if (selectedValue) {
      selectPreset.value = selectedValue;
    }
    const isCustomSelected =
      selectPreset.value && selectPreset.value.startsWith('custom:');
    if (btnDeletePreset) {
      btnDeletePreset.style.display = isCustomSelected ? 'inline' : 'none';
    }
  };

  rebuildPresetOptions();

  const saveCurrentPreset = () => {
    const name = (inputPresetName.value || '').trim();
    if (!name) {
      inputPresetName.focus();
      return;
    }
    const snapshot = {};
    SNAPSHOT_KEYS.forEach((k) => {
      snapshot[k] = state.params[k];
    });
    customPresets[name] = snapshot;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
    } catch (_) {}

    const valKey = `custom:${name}`;
    rebuildPresetOptions(valKey);
    inputPresetName.value = '';
  };

  btnSavePreset.addEventListener('click', saveCurrentPreset);
  inputPresetName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCurrentPreset();
    }
  });

  if (btnDeletePreset) {
    btnDeletePreset.addEventListener('click', () => {
      const val = selectPreset.value;
      if (val && val.startsWith('custom:')) {
        const name = val.slice('custom:'.length);
        delete customPresets[name];
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
        } catch (_) {}
        rebuildPresetOptions('anchors');
      }
    });
  }

  selectPreset.addEventListener('change', (e) => {
    const val = e.target.value;
    const p = state.params;
    const prevOnlyConnected = p.onlyConnected;

    if (val.startsWith('custom:')) {
      const name = val.slice('custom:'.length);
      const saved = customPresets[name];
      if (saved) {
        SNAPSHOT_KEYS.forEach((k) => {
          if (saved[k] !== undefined) {
            p[k] = saved[k];
          }
        });
      }
      if (btnDeletePreset) btnDeletePreset.style.display = 'inline';
    } else {
      if (btnDeletePreset) btnDeletePreset.style.display = 'none';
      if (val === 'anchors') {
        p.anchorStrength = 1.0;
        p.subfieldCohesion = 0.0;
        p.ghostAnnealing = 0.0;
        p.nebulaRepulsion = 0.0;
        p.centerGravity = 0.0012;
        p.giantGravity = 0.0;
      } else if (val === 'pure') {
        p.anchorStrength = 0.0;
        p.subfieldCohesion = 0.0;
        p.ghostAnnealing = 0.35;
        p.nebulaRepulsion = 0.0;
        p.centerGravity = 0.0008;
        p.giantGravity = 0.0;
      } else if (val === 'cohesion') {
        p.anchorStrength = 0.0;
        p.subfieldCohesion = 0.45;
        p.ghostAnnealing = 0.5;
        p.nebulaRepulsion = 0.6;
        p.centerGravity = 0.0006;
        p.giantGravity = 0.0;
      } else if (val === 'nebula') {
        p.anchorStrength = 0.0;
        p.subfieldCohesion = 0.1;
        p.ghostAnnealing = 0.3;
        p.nebulaRepulsion = 1.2;
        p.centerGravity = 0.0002;
        p.giantGravity = 0.0;
      } else if (val === 'gravity') {
        p.anchorStrength = 0.0;
        p.subfieldCohesion = 0.15;
        p.ghostAnnealing = 0.25;
        p.nebulaRepulsion = 0.2;
        p.centerGravity = 0.001;
        p.giantGravity = 0.05;
      } else if (val === 'tight') {
        p.anchorStrength = 0.0;
        p.subfieldCohesion = 0.0;
        p.ghostAnnealing = 0.0;
        p.nebulaRepulsion = 0.0;
        p.centerGravity = 0.0035;
        p.springStiffness = 0.06;
        p.giantGravity = 0.0;
      }
    }

    syncInputsWithParams();
    if (p.onlyConnected !== prevOnlyConnected) {
      rebuildActiveSubset();
    } else {
      bridge.syncAllParams(p);
      markSimActive();
    }
  });
}

function syncInputsWithParams() {
  const p = state.params;
  const setVal = (sliderId, numId, val) => {
    const s = document.getElementById(sliderId);
    const n = document.getElementById(numId);
    if (s) s.value = val;
    if (n) n.value = val;
  };
  setVal('p-sample-count', 'num-sample-count', p.sampleCount);
  const dsSeed = document.getElementById('input-dataset-seed');
  if (dsSeed) dsSeed.value = p.datasetSeed;
  const scSeed = document.getElementById('input-scramble-seed');
  if (scSeed) scSeed.value = p.scrambleSeed;
  const chkConn = document.getElementById('chk-only-connected');
  if (chkConn) chkConn.checked = p.onlyConnected;
  const chkLines = document.getElementById('chk-all-lines');
  if (chkLines) chkLines.checked = p.showAllLines;
  const chkZones = document.getElementById('chk-zones');
  if (chkZones) chkZones.checked = p.showZones;

  setVal('p-scale', 'num-scale', p.radiusScale);
  setVal('p-anchor', 'num-anchor', p.anchorStrength);
  setVal('p-cohesion', 'num-cohesion', p.subfieldCohesion);
  setVal('p-ghost', 'num-ghost', p.ghostAnnealing);
  setVal('p-nebula', 'num-nebula', p.nebulaRepulsion);
  setVal('p-center', 'num-center', p.centerGravity);
  setVal('p-giant', 'num-giant', p.giantGravity);
  setVal('p-spring', 'num-spring', p.springStiffness);
  setVal('p-deg-norm', 'num-deg-norm', p.degreeNorm);
  setVal('p-bridge', 'num-bridge', p.bridgeMult);
  setVal('p-gap', 'num-gap', p.springGap);
  setVal('p-gamma', 'num-gamma', p.sizeExponent);
  setVal('p-mass', 'num-mass', p.massExponent);
  setVal('p-margin', 'num-margin', p.collisionMargin);
  setVal('p-speed', 'num-speed', p.simSpeed);
}

function setupEventListeners() {
  canvas.addEventListener('mousedown', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    const found = findNodeAtScreen(e.clientX, e.clientY);
    if (found) {
      state.draggedNode = found;
      bridge.universe.set_dragged_node(found.idx);
      markSimActive();
      return;
    }

    isPanning = true;
    dragStartX = e.clientX - state.camera.x;
    dragStartY = e.clientY - state.camera.y;
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
    if (state.draggedNode) {
      bridge.universe.set_dragged_node(-1);
      state.draggedNode = null;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (state.draggedNode) {
      if (state.viewMode === 'GLOBE') {
        const sp = unprojectScreenToSphere(
          e.clientX,
          e.clientY,
          state.globeRotation,
          state.camera
        );
        bridge.universe.move_node_3d(state.draggedNode.idx, sp.sx, sp.sy, sp.sz);
      } else {
        const wx = (e.clientX - state.camera.x) / state.camera.scale;
        const wy = (e.clientY - state.camera.y) / state.camera.scale;
        bridge.universe.move_node_2d(state.draggedNode.idx, wx, wy);
      }
      return;
    }

    if (isPanning) {
      if (state.viewMode === 'GLOBE') {
        state.globeRotation.y += dx * 0.006;
        state.globeRotation.x += dy * 0.006;
        state.globeRotation.x = Math.max(
          -Math.PI / 2.1,
          Math.min(Math.PI / 2.1, state.globeRotation.x)
        );
        tooltip.style.display = 'none';
        return;
      } else {
        state.camera.x = e.clientX - dragStartX;
        state.camera.y = e.clientY - dragStartY;
        state.camera.targetX = state.camera.x;
        state.camera.targetY = state.camera.y;
        tooltip.style.display = 'none';
        return;
      }
    }

    const found = findNodeAtScreen(e.clientX, e.clientY);
    if (found !== state.hoveredNode) {
      state.hoveredNode = found;
      if (state.hoveredNode) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX}px`;
        tooltip.style.top = `${e.clientY}px`;
        tooltip.innerHTML = `
          <div style="font-size:12px; max-width:280px; text-overflow:ellipsis; overflow:hidden;">${state.hoveredNode.title}</div>
          <div style="margin-top:2px; font-size:10px; color:#8b949e;">
            Cytowania: <span class="cit">${state.hoveredNode.citations.toLocaleString()}</span> (${state.hoveredNode.year || 'b.d.'})
          </div>
          <div style="font-size:10px; color:${state.hoveredNode.color};">${state.hoveredNode.field_name}</div>
        `;
      } else {
        tooltip.style.display = 'none';
      }
    } else if (state.hoveredNode) {
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY}px`;
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const z = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.min(5.0, Math.max(0.15, state.camera.scale * z));
      state.camera.scale = newScale;
      state.camera.targetScale = newScale;
    },
    { passive: false }
  );

  canvas.addEventListener('click', () => {
    if (state.hoveredNode) {
      selectNode(state.hoveredNode);
    } else {
      state.selectedNode = null;
      inspector.style.display = 'none';
    }
  });

  document.getElementById('ins-close').addEventListener('click', () => {
    state.selectedNode = null;
    inspector.style.display = 'none';
  });
}

function findNodeAtScreen(clientX, clientY) {
  const views = bridge.getViews();
  const nodes = bridge.nodes;
  if (state.viewMode === 'GLOBE') {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const p = projectSphere(
        views.sx[i],
        views.sy[i],
        views.sz[i],
        state.globeRotation,
        state.camera
      );
      if (p.depth > -0.15) {
        const rPx = Math.max(3, views.r[i] * state.camera.scale);
        if (Math.hypot(p.x - clientX, p.y - clientY) <= rPx + 3) {
          return nodes[i];
        }
      }
    }
  } else {
    const wx = (clientX - state.camera.x) / state.camera.scale;
    const wy = (clientY - state.camera.y) / state.camera.scale;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (
        views.x[i] < 50000 &&
        Math.hypot(views.x[i] - wx, views.y[i] - wy) <= views.r[i] + 2
      ) {
        return nodes[i];
      }
    }
  }
  return null;
}

function selectNode(n) {
  state.selectedNode = n;
  document.getElementById('ins-title').innerText = n.title;
  document.getElementById('ins-cites').innerText = n.citations.toLocaleString();
  document.getElementById('ins-year').innerText = n.year || 'b.d.';
  document.getElementById('ins-subfield').innerText = n.field_name;
  document.getElementById('ins-subfield').style.color = n.color;
  document.getElementById('ins-conn-count').innerText = n.connections.length;

  const list = document.getElementById('ins-connections');
  list.innerHTML = '';

  n.connections.forEach((id) => {
    const t = bridge.nodeMap.get(id);
    if (!t) return;
    const row = document.createElement('div');
    row.className = 'ins-conn-row';
    row.innerHTML = `
      <span style="max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.title}</span>
      <span class="cites">${t.citations.toLocaleString()}</span>
    `;
    row.addEventListener('click', () => selectNode(t));
    list.appendChild(row);
  });

  inspector.style.display = 'flex';
}

function mainLoop() {
  if (!state.isPaused) {
    const temp = bridge.universe.step(state.params.simSpeed);
    if (temp < 0.004 && state.isSimRunning) {
      state.isSimRunning = false;
      statusDot.className = 'status-dot frozen';
      statusText.innerText = 'Ustabilizowana';
    }
  }

  state.camera.x += (state.camera.targetX - state.camera.x) * 0.12;
  state.camera.y += (state.camera.targetY - state.camera.y) * 0.12;
  state.camera.scale += (state.camera.targetScale - state.camera.scale) * 0.12;

  const views = bridge.getViews();
  renderer.render(bridge, views, state);

  requestAnimationFrame(mainLoop);
}

boot();

