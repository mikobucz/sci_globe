// User Interface, Kittens Game Controls, Camera, and Main Simulation Loop

import { SimBridge, mulberry32, parseSnapshotPayload } from './wasm_loader.js';
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
const coordsReadout = document.getElementById('coords-readout');
const btnToggleSaved = document.getElementById('btn-toggle-saved');
const btnCloseSaved = document.getElementById('btn-close-saved');
const drawerSaved = document.getElementById('drawer-saved');
const btnToggleOptions = document.getElementById('btn-toggle-options');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');

const bridge = new SimBridge();
const renderer = new AtlasRenderer(canvas);

const state = {
  globeRotation: { x: 0.35, y: -0.2, targetX: null, targetY: null },
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
    globeRadius: 660,
    anchorStrength: 0.35,
    subfieldCohesion: 0.0,
    ghostAnnealing: 0.1,
    nebulaRepulsion: 0.0,
    nebulaCutoff: 0.45,
    centerGravity: 0.0,
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
  activeFieldId: null,
  isSimRunning: true,
  isPaused: false,
  simStartTime: Date.now(),
};

let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

async function boot() {
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  statusDot.className = 'status-dot frozen';
  statusText.innerText = 'Loading dataset...';

  await bridge.initialize();

  let bootedFromShowcase = false;
  try {
    const res = await fetch(`generated_maps.json?_t=${Date.now()}`);
    if (res.ok) {
      const maps = await res.json();
      const showcase = Array.isArray(maps) && maps.find((m) => Boolean(m.snapshotFile));
      if (showcase) {
        await applyGeneratedMap(showcase);
        bootedFromShowcase = true;
      }
    }
  } catch (_) {
    bootedFromShowcase = false;
  }

  if (!bootedFromShowcase) {
    await loadDataset(state.params.dataset);
  }

  setupEventListeners();
  setupSidebarBindings();
  setupSavedMapsBindings();
  setupLegendBindings();
  syncInputsWithParams();

  requestAnimationFrame(mainLoop);
}

async function loadDataset(datasetName) {
  statusDot.className = 'status-dot frozen';
  statusText.innerText = 'Loading dataset...';
  state.activeFieldId = null;
  await bridge.loadDatasetFile(datasetName);
  rebuildActiveSubset();
  resetCameraView();
}

function rebuildActiveSubset() {
  bridge.rebuildSubset(state.params, true);
  nodeCountEl.innerText = `${bridge.nodes.length.toLocaleString()} papers`;
  renderDisciplineLegend();
  markSimActive();
}

function markSimActive() {
  bridge.universe.reheat();
  state.isSimRunning = true;
  state.simStartTime = Date.now();
  statusDot.className = 'status-dot';
  statusText.innerText = 'Active (Wasm)';
}

function markSimFrozen(label = 'Converged (snapshot)') {
  state.isSimRunning = false;
  statusDot.className = 'status-dot frozen';
  statusText.innerText = label;
}

function resetCameraView() {
  state.camera.targetX = window.innerWidth / 2;
  state.camera.targetY = window.innerHeight / 2;
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  state.camera.targetScale = minDim / 1420;
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
  bridge.universe.scramble(seedVal >>> 0, true);
  markSimActive();
}

function setupSidebarBindings() {
  btnToggleOptions.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (drawerSaved) drawerSaved.classList.remove('open');
  });
  btnCloseSidebar.addEventListener('click', () => {
    sidebar.classList.remove('open');
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
    if (!slider || !numInput) return;

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
  bindPair('p-globe-radius', 'num-globe-radius', 'globeRadius', true);
  bindPair('p-anchor', 'num-anchor', 'anchorStrength');
  bindPair('p-cohesion', 'num-cohesion', 'subfieldCohesion');
  bindPair('p-ghost', 'num-ghost', 'ghostAnnealing');
  bindPair('p-nebula', 'num-nebula', 'nebulaRepulsion');
  bindPair('p-nebula-cut', 'num-nebula-cut', 'nebulaCutoff');
  bindPair('p-giant', 'num-giant', 'giantGravity');
  bindPair('p-spring', 'num-spring', 'springStiffness');
  bindPair('p-deg-norm', 'num-deg-norm', 'degreeNorm');
  bindPair('p-bridge', 'num-bridge', 'bridgeMult');
  bindPair('p-gap', 'num-gap', 'springGap');
  bindPair('p-gamma', 'num-gamma', 'sizeExponent');
  bindPair('p-mass', 'num-mass', 'massExponent');
  bindPair('p-margin', 'num-margin', 'collisionMargin');

  const chkAllLines = document.getElementById('chk-all-lines');
  if (chkAllLines) {
    chkAllLines.addEventListener('change', (e) => {
      state.params.showAllLines = e.target.checked;
    });
  }
  const chkZones = document.getElementById('chk-zones');
  if (chkZones) {
    chkZones.addEventListener('change', (e) => {
      state.params.showZones = e.target.checked;
    });
  }

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

  document.getElementById('btn-reheat').addEventListener('click', markSimActive);

  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => {
    state.isPaused = !state.isPaused;
    btnPause.innerText = state.isPaused ? '[ resume ]' : '[ pause ]';
    btnPause.classList.toggle('active', state.isPaused);
  });

  document
    .getElementById('btn-reset-view')
    .addEventListener('click', resetCameraView);

  const inputSearchPaper = document.getElementById('input-search-paper');
  const btnFindPaper = document.getElementById('btn-find-paper');
  const flyToQuery = () => {
    if (!inputSearchPaper) return;
    const q = (inputSearchPaper.value || '').trim();
    if (!q) return;

    // 1. Check if query is "#idx" or "idx=123"
    const idxMatch = q.match(/^(?:#|idx=)?(\d+)$/i);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10);
      if (idx >= 0 && idx < bridge.nodes.length) {
        flyToNode(bridge.nodes[idx]);
        return;
      }
    }

    // 2. Check if query is "lat, lon" coordinates (e.g. "-28.4, 127.1" or "+41.2, -15.0")
    const coordMatch = q.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const latDeg = parseFloat(coordMatch[1]);
      const lonDeg = parseFloat(coordMatch[2]);
      flyToLatLon(latDeg, lonDeg);
      return;
    }

    // 3. Otherwise search by paper title substring
    const lower = q.toLowerCase();
    let best = null;
    for (let i = 0; i < bridge.nodes.length; i++) {
      const n = bridge.nodes[i];
      if (n.title.toLowerCase().includes(lower)) {
        if (!best || n.citations > best.citations) {
          best = n;
        }
      }
    }
    if (best) {
      flyToNode(best);
    }
  };
  if (btnFindPaper) btnFindPaper.addEventListener('click', flyToQuery);
  if (inputSearchPaper) {
    inputSearchPaper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        flyToQuery();
      }
    });
  }

  const selectPreset = document.getElementById('select-preset');
  const inputPresetName = document.getElementById('input-preset-name');
  const btnSavePreset = document.getElementById('btn-save-preset');
  const btnDeletePreset = document.getElementById('btn-delete-preset');

  const STORAGE_KEY = 'sci_globe_custom_presets_v1';
  let customPresets = {};
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem('mathmap_custom_presets_v1');
    if (raw) customPresets = JSON.parse(raw) || {};
  } catch (_) {
    customPresets = {};
  }

  const SNAPSHOT_KEYS = [
    'dataset',
    'sampleCount',
    'datasetSeed',
    'scrambleSeed',
    'simSpeed',
    'radiusScale',
    'globeRadius',
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
    'onlyConnected',
    'showAllLines',
    'showZones',
  ];

  const syncPresetsToDisk = async () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
    } catch (_) {}
    try {
      await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customPresets),
      });
    } catch (_) {}
  };

  // Load presets from public/presets.json and merge with localStorage
  fetch('presets.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((diskPresets) => {
      if (diskPresets && typeof diskPresets === 'object') {
        customPresets = { ...diskPresets, ...customPresets };
      }
      rebuildPresetOptions();
      if (Object.keys(customPresets).length > 0) {
        syncPresetsToDisk();
      }
    })
    .catch(() => {});

  const rebuildPresetOptions = (selectedValue = null) => {
    // Remove previously rendered custom options
    const existingCustom = selectPreset.querySelectorAll('option[data-custom="1"]');
    existingCustom.forEach((opt) => opt.remove());

    const names = Object.keys(customPresets);
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = `custom:${name}`;
      opt.textContent = `[Custom] ${name}`;
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
    syncPresetsToDisk();

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
        syncPresetsToDisk();
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
    rebuildActiveSubset();
  });
}

function syncInputsWithParams() {
  const p = state.params;
  const selDs = document.getElementById('select-dataset');
  if (selDs && p.dataset) selDs.value = p.dataset;
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
  setVal('p-globe-radius', 'num-globe-radius', p.globeRadius || 660);
  setVal('p-anchor', 'num-anchor', p.anchorStrength);
  setVal('p-cohesion', 'num-cohesion', p.subfieldCohesion);
  setVal('p-ghost', 'num-ghost', p.ghostAnnealing);
  setVal('p-nebula', 'num-nebula', p.nebulaRepulsion);
  setVal('p-nebula-cut', 'num-nebula-cut', p.nebulaCutoff || 0.45);
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

function setupSavedMapsBindings() {
  if (btnToggleSaved) {
    btnToggleSaved.addEventListener('click', () => {
      drawerSaved.classList.toggle('open');
      if (drawerSaved.classList.contains('open')) {
        sidebar.classList.remove('open');
        loadGeneratedMaps();
      }
    });
  }
  if (btnCloseSaved) {
    btnCloseSaved.addEventListener('click', () => {
      drawerSaved.classList.remove('open');
    });
  }

  const btnSaveSnapshot = document.getElementById('btn-save-current-snapshot');
  const inputSnapshotName = document.getElementById('input-save-snapshot-name');
  if (btnSaveSnapshot) {
    btnSaveSnapshot.addEventListener('click', async () => {
      const selectPreset = document.getElementById('select-preset');
      const prName = selectPreset ? selectPreset.value.replace('custom:', '') : 'custom';
      const name =
        (inputSnapshotName.value || '').trim() ||
        `Globe ${bridge.nodes.length} papers (${prName})`;

      const elapsedSec = Math.max(1, Math.round((Date.now() - state.simStartTime) / 1000));
      const mapId = `web_${bridge.nodes.length}_${state.params.scrambleSeed}_${Date.now() % 10000}`;
      const positions = bridge.exportPositionsObject();

      const mapEntry = {
        id: mapId,
        name,
        preset: prName,
        dataset: state.params.dataset,
        sampleCount: bridge.nodes.length,
        datasetSeed: state.params.datasetSeed,
        scrambleSeed: state.params.scrambleSeed,
        onlyConnected: state.params.onlyConnected,
        globeRadius: state.params.globeRadius,
        computeTime: `${elapsedSec}s (browser)`,
        source: 'Web UI',
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        params: { ...state.params },
        snapshot: {
          version: 1,
          dataset: state.params.dataset,
          sampleCount: bridge.nodes.length,
          onlyConnected: state.params.onlyConnected,
          globeRadius: state.params.globeRadius,
          params: { ...state.params },
          positions,
        },
      };

      const prevText = btnSaveSnapshot.innerText;
      btnSaveSnapshot.innerText = '[ saving... ]';
      try {
        const res = await fetch('/api/generated_maps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mapEntry),
        });
        if (!res.ok) {
          // Static hosting fallback (e.g. GitHub Pages): download snapshot JSON directly
          const blob = new Blob([JSON.stringify(mapEntry.snapshot)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${mapId}.json`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
        if (inputSnapshotName) inputSnapshotName.value = '';
        await loadGeneratedMaps();
      } catch (err) {
        console.error('Failed to save map:', err);
      } finally {
        btnSaveSnapshot.innerText = prevText;
      }
    });
  }

  const btnImportSnapshot = document.getElementById('btn-import-snapshot');
  const inputImportSnapshot = document.getElementById('input-import-snapshot');
  const importStatus = document.getElementById('import-snapshot-status');
  if (btnImportSnapshot && inputImportSnapshot) {
    btnImportSnapshot.addEventListener('click', () => {
      inputImportSnapshot.value = '';
      inputImportSnapshot.click();
    });
    inputImportSnapshot.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        if (importStatus) importStatus.innerText = 'Loading...';
        const text = await file.text();
        const rawJson = JSON.parse(text);
        const result = await applySnapshotPayload(rawJson, { name: file.name });
        if (importStatus) {
          importStatus.innerText = `Loaded ${result.loadedCount} papers`;
        }
        if (drawerSaved) drawerSaved.classList.remove('open');
      } catch (err) {
        console.error('Failed to import coordinates file:', err);
        if (importStatus) {
          importStatus.innerText = err.message || 'Invalid JSON file';
        }
      }
    });
  }
}

async function loadGeneratedMaps() {
  const container = document.getElementById('saved-maps-list');
  if (!container) return;

  try {
    const res = await fetch(`generated_maps.json?_t=${Date.now()}`);
    if (!res.ok) throw new Error('File not found');
    const maps = await res.json();
    renderGeneratedMapsList(maps);
  } catch (err) {
    container.innerHTML = `<div style="font-size:12px; color:#8c92a0; padding:10px;">No saved maps found or failed to read generated_maps.json.</div>`;
  }
}

function renderGeneratedMapsList(maps) {
  const container = document.getElementById('saved-maps-list');
  if (!container) return;

  if (!maps || maps.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:#8c92a0; padding:10px;">No saved maps yet. Run 'sci_globe-cli --save-map' in the terminal or click '[ save state ]' above.</div>`;
    return;
  }

  container.innerHTML = '';
  maps.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'saved-map-card';

    const knnBadge = m.metrics?.knnPurity ? `<div>KNN: <strong>${m.metrics.knnPurity}</strong></div>` : '';
    const fpsBadge = m.metrics?.fps ? `<div>Speed: <strong>${m.metrics.fps} FPS</strong></div>` : '';
    const hasSnapshot = Boolean(m.snapshotFile);
    const stateBadge = hasSnapshot
      ? `<span class="saved-map-badge" style="color:#3fb950; background:rgba(63,185,80,0.14);">✓ Snapshot ready</span>`
      : `<span class="saved-map-badge" style="color:#8c92a0; background:rgba(140,146,160,0.14);">Seeds only</span>`;

    const dsSeed = m.datasetSeed ?? m.params?.datasetSeed ?? '-';
    const scSeed = m.scrambleSeed ?? m.params?.scrambleSeed ?? '-';
    const dsLabel = `${m.dataset || m.params?.dataset || 'global'}${(m.onlyConnected ?? m.params?.onlyConnected) ? ' (connected)' : ''}`;

    card.innerHTML = `
      <div class="saved-map-title">
        <span>${m.name}</span>
        <div style="display:flex; gap:6px; align-items:center;">
          ${stateBadge}
          <span class="saved-map-badge">${(m.sampleCount || 0).toLocaleString()} papers</span>
        </div>
      </div>
      <div class="saved-map-meta">
        <div>Preset: <strong>${m.preset || 'none'}</strong></div>
        <div>Dataset: <strong>${dsLabel}</strong></div>
        <div>Dataset Seed: <strong style="color:#d2a8ff;">${dsSeed}</strong></div>
        <div>Scramble Seed: <strong style="color:#d2a8ff;">${scSeed}</strong></div>
        <div>Compute Time: <strong>${m.computeTime || '-'}</strong></div>
        <div>Source: <strong>${m.source || '-'}</strong></div>
        ${knnBadge}
        ${fpsBadge}
      </div>
      <div class="saved-map-actions">
        ${hasSnapshot ? `<a class="kg-text-btn" href="${m.snapshotFile}" download="${m.id}.json" style="text-decoration:none;">[ download .json ]</a>` : ''}
        <button class="kg-text-btn btn-apply-saved-map">${hasSnapshot ? '[ load instantly ]' : '[ simulate from seeds ]'}</button>
        <button class="kg-text-btn btn-delete-saved-map" style="color:#f85149;">[ delete ]</button>
      </div>
    `;

    const btnApply = card.querySelector('.btn-apply-saved-map');
    btnApply.addEventListener('click', async () => {
      const prevLabel = btnApply.innerText;
      btnApply.innerText = '[ loading... ]';
      try {
        await applyGeneratedMap(m);
        if (drawerSaved) drawerSaved.classList.remove('open');
      } catch (err) {
        console.error('Failed to load map:', err);
        btnApply.innerText = '[ load error ]';
        return;
      }
      btnApply.innerText = prevLabel;
    });

    card.querySelector('.btn-delete-saved-map').addEventListener('click', async () => {
      try {
        await fetch(`/api/generated_maps?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        await loadGeneratedMaps();
      } catch (err) {
        console.error(err);
      }
    });

    container.appendChild(card);
  });
}

async function ensureDatasetLoaded(targetDataset) {
  if (targetDataset && (targetDataset !== state.params.dataset || !bridge.fullRawData)) {
    state.params.dataset = targetDataset;
    await bridge.loadDatasetFile(targetDataset);
  }
}

function setupLegendBindings() {
  const legendBox = document.getElementById('discipline-legend');
  const btnToggle = document.getElementById('btn-legend-toggle');
  const btnClear = document.getElementById('btn-legend-clear');

  if (btnToggle && legendBox) {
    btnToggle.addEventListener('click', () => {
      const collapsed = legendBox.classList.toggle('collapsed');
      btnToggle.innerText = collapsed ? '[ + ]' : '[ - ]';
    });
  }
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      state.activeFieldId = null;
      renderDisciplineLegend();
    });
  }
}

function renderDisciplineLegend() {
  const list = document.getElementById('legend-list');
  const btnClear = document.getElementById('btn-legend-clear');
  if (!list) return;

  const counts = new Map();
  for (let i = 0; i < bridge.nodes.length; i++) {
    const fid = bridge.nodes[i].field_id;
    counts.set(fid, (counts.get(fid) || 0) + 1);
  }

  if (btnClear) {
    btnClear.style.display = state.activeFieldId ? 'inline' : 'none';
  }

  list.innerHTML = '';
  (bridge.zones || []).forEach((z) => {
    const cnt = counts.get(z.id) || 0;
    if (cnt === 0) return;

    const item = document.createElement('div');
    item.className = 'legend-item';
    if (state.activeFieldId) {
      item.classList.add(state.activeFieldId === z.id ? 'active' : 'dimmed');
    }
    item.innerHTML = `
      <div class="legend-item-left">
        <span class="legend-dot" style="background:${z.color};"></span>
        <span class="legend-name">${z.name}</span>
      </div>
      <span class="legend-count">${cnt.toLocaleString()}</span>
    `;
    item.addEventListener('click', () => {
      state.activeFieldId = state.activeFieldId === z.id ? null : z.id;
      renderDisciplineLegend();
    });
    list.appendChild(item);
  });
}

async function applySnapshotPayload(rawJson, fallbackMeta = {}) {
  const { positionsMap, meta } = parseSnapshotPayload(rawJson);
  if (positionsMap.size === 0) {
    throw new Error('No valid coordinates (id -> x,y,z) found in file.');
  }

  const targetDataset = meta.dataset || fallbackMeta.dataset;
  if (targetDataset) {
    await ensureDatasetLoaded(targetDataset);
  } else {
    // Auto-detect dataset if none of the IDs match the currently loaded dataset
    const matchesCurrent = bridge.allAvailableNodes.some((n) => positionsMap.has(String(n.id)));
    if (!matchesCurrent) {
      const altDataset = state.params.dataset === 'math' ? 'global' : 'math';
      await ensureDatasetLoaded(altDataset);
    }
  }

  if (meta.params) {
    Object.assign(state.params, meta.params);
  }
  if (fallbackMeta.params) {
    Object.assign(state.params, fallbackMeta.params);
  }
  if (meta.globeRadius !== undefined) state.params.globeRadius = meta.globeRadius;
  if (meta.onlyConnected !== undefined) state.params.onlyConnected = meta.onlyConnected;

  const res = bridge.loadPrecomputedSubset(state.params, positionsMap, true);
  if (res.loadedCount === 0) {
    throw new Error('None of the paper IDs in the file match the selected dataset.');
  }
  state.params.sampleCount = res.loadedCount;
  state.activeFieldId = null;

  syncInputsWithParams();
  nodeCountEl.innerText = `${bridge.nodes.length.toLocaleString()} papers`;
  renderDisciplineLegend();
  markSimFrozen();
  resetCameraView();
  return res;
}

async function applyGeneratedMap(mapData) {
  const selectPreset = document.getElementById('select-preset');
  const btnDeletePreset = document.getElementById('btn-delete-preset');

  if (mapData.snapshotFile) {
    if (mapData.preset && selectPreset) {
      const opt = Array.from(selectPreset.options).find(
        (o) => o.value === mapData.preset || o.value === `custom:${mapData.preset}`
      );
      if (opt) {
        selectPreset.value = opt.value;
        if (btnDeletePreset) {
          btnDeletePreset.style.display = opt.value.startsWith('custom:') ? 'inline' : 'none';
        }
      }
    }
    if (mapData.datasetSeed !== undefined) state.params.datasetSeed = mapData.datasetSeed;
    if (mapData.scrambleSeed !== undefined) state.params.scrambleSeed = mapData.scrambleSeed;
    if (mapData.globeRadius !== undefined) state.params.globeRadius = mapData.globeRadius;
    if (mapData.onlyConnected !== undefined) state.params.onlyConnected = mapData.onlyConnected;

    const resp = await fetch(`${mapData.snapshotFile}?_t=${Date.now()}`);
    if (!resp.ok) {
      throw new Error(`Failed to fetch snapshot: ${mapData.snapshotFile}`);
    }
    const rawJson = await resp.json();
    await applySnapshotPayload(rawJson, mapData);
    return;
  }

  await ensureDatasetLoaded(mapData.dataset || state.params.dataset);

  if (mapData.preset && selectPreset) {
    let opt = Array.from(selectPreset.options).find(
      (o) => o.value === mapData.preset || o.value === `custom:${mapData.preset}`
    );
    if (opt) {
      selectPreset.value = opt.value;
      selectPreset.dispatchEvent(new Event('change'));
    }
  }

  if (mapData.params) {
    Object.assign(state.params, mapData.params);
  }

  if (mapData.datasetSeed !== undefined) state.params.datasetSeed = mapData.datasetSeed;
  if (mapData.scrambleSeed !== undefined) state.params.scrambleSeed = mapData.scrambleSeed;
  if (mapData.sampleCount !== undefined) state.params.sampleCount = mapData.sampleCount;
  if (mapData.globeRadius !== undefined) state.params.globeRadius = mapData.globeRadius;
  if (mapData.onlyConnected !== undefined) state.params.onlyConnected = mapData.onlyConnected;

  syncInputsWithParams();
  rebuildActiveSubset();
  scrambleConfetti(false);
  resetCameraView();
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
      const sp = unprojectScreenToSphere(
        e.clientX,
        e.clientY,
        state.globeRotation,
        state.camera,
        state.params.globeRadius || 660
      );
      bridge.universe.move_node_3d(state.draggedNode.idx, sp.sx, sp.sy, sp.sz);
      return;
    }

    if (isPanning) {
      state.globeRotation.y += dx * 0.006;
      state.globeRotation.x += dy * 0.006;
      state.globeRotation.x = Math.max(
        -Math.PI / 2.1,
        Math.min(Math.PI / 2.1, state.globeRotation.x)
      );
      tooltip.style.display = 'none';
      return;
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
            Citations: <span class="cit">${state.hoveredNode.citations.toLocaleString()}</span> (${state.hoveredNode.year || 'N/A'})
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

  // Touch drag & pinch-to-zoom for mobile/trackpad
  let touchStartPos = null;
  let touchMoved = false;
  let lastPinchDist = null;

  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        lastMouseX = t.clientX;
        lastMouseY = t.clientY;
        touchStartPos = { x: t.clientX, y: t.clientY };
        touchMoved = false;
        isPanning = true;
        lastPinchDist = null;
      } else if (e.touches.length === 2) {
        isPanning = false;
        touchMoved = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.hypot(dx, dy);
      }
    },
    { passive: true }
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && isPanning) {
        const t = e.touches[0];
        const dx = t.clientX - lastMouseX;
        const dy = t.clientY - lastMouseY;
        lastMouseX = t.clientX;
        lastMouseY = t.clientY;
        if (touchStartPos && Math.hypot(t.clientX - touchStartPos.x, t.clientY - touchStartPos.y) > 8) {
          touchMoved = true;
        }
        state.globeRotation.y += dx * 0.006;
        state.globeRotation.x += dy * 0.006;
        state.globeRotation.x = Math.max(
          -Math.PI / 2.1,
          Math.min(Math.PI / 2.1, state.globeRotation.x)
        );
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastPinchDist && dist > 0) {
          const factor = dist / lastPinchDist;
          const newScale = Math.min(5.0, Math.max(0.15, state.camera.scale * factor));
          state.camera.scale = newScale;
          state.camera.targetScale = newScale;
        }
        lastPinchDist = dist;
      }
    },
    { passive: false }
  );

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isPanning = false;
      lastPinchDist = null;
      if (touchStartPos && !touchMoved) {
        const tapped = findNodeAtScreen(touchStartPos.x, touchStartPos.y);
        if (tapped) {
          selectNode(tapped);
        } else {
          state.selectedNode = null;
          inspector.style.display = 'none';
        }
      }
      touchStartPos = null;
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
  const n = nodes.length;

  // Reuse renderer's depth-sorted projected buffers when available
  if (renderer.lastRenderedCount === n) {
    const ord = renderer.order;
    const pxArr = renderer.projX;
    const pyArr = renderer.projY;
    const depthArr = renderer.projDepth;
    for (let k = n - 1; k >= 0; k--) {
      const idx = ord[k];
      if (depthArr[idx] > -0.15) {
        const rPx = Math.max(3, views.r[idx] * state.camera.scale);
        if (Math.hypot(pxArr[idx] - clientX, pyArr[idx] - clientY) <= rPx + 3) {
          return nodes[idx];
        }
      }
    }
    return null;
  }

  for (let i = n - 1; i >= 0; i--) {
    const p = projectSphere(
      views.sx[i],
      views.sy[i],
      views.sz[i],
      state.globeRotation,
      state.camera,
      state.params.globeRadius || 660
    );
    if (p.depth > -0.15) {
      const rPx = Math.max(3, views.r[i] * state.camera.scale);
      if (Math.hypot(p.x - clientX, p.y - clientY) <= rPx + 3) {
        return nodes[i];
      }
    }
  }
  return null;
}

function selectNode(n) {
  state.selectedNode = n;
  const views = bridge.getViews();
  const sx = views.sx[n.idx] || 0;
  const sy = Math.max(-1, Math.min(1, views.sy[n.idx] || 0));
  const sz = views.sz[n.idx] || 0;
  const latDeg = (Math.asin(sy) * 180) / Math.PI;
  const lonDeg = (Math.atan2(sx, sz) * 180) / Math.PI;

  document.getElementById('ins-title').innerText = `[#${n.idx}] ${n.title}`;
  document.getElementById('ins-cites').innerText = n.citations.toLocaleString();
  document.getElementById('ins-year').innerText = `${n.year || 'N/A'} | lat: ${latDeg >= 0 ? '+' : ''}${latDeg.toFixed(1)}°, lon: ${lonDeg >= 0 ? '+' : ''}${lonDeg.toFixed(1)}°`;
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
      <span style="max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">[#${t.idx}] ${t.title}</span>
      <span class="cites">${t.citations.toLocaleString()}</span>
    `;
    row.addEventListener('click', () => flyToNode(t));
    list.appendChild(row);
  });

  inspector.style.display = 'flex';
}

function flyToLatLon(latDeg, lonDeg) {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;
  state.globeRotation.targetX = -latRad;
  state.globeRotation.targetY = lonRad;
}

function flyToNode(n) {
  if (!n) return;
  selectNode(n);
  const views = bridge.getViews();
  const sx = views.sx[n.idx];
  const sy = Math.max(-1, Math.min(1, views.sy[n.idx]));
  const sz = views.sz[n.idx];
  state.globeRotation.targetX = -Math.asin(sy);
  state.globeRotation.targetY = Math.atan2(sx, sz);
}

function mainLoop() {
  if (!state.isPaused) {
    const temp = bridge.universe.step(state.params.simSpeed);
    if (temp < 0.004 && state.isSimRunning) {
      state.isSimRunning = false;
      statusDot.className = 'status-dot frozen';
      statusText.innerText = 'Converged';
    }
  }

  if (state.globeRotation.targetX !== null && state.globeRotation.targetY !== null) {
    if (isPanning) {
      state.globeRotation.targetX = null;
      state.globeRotation.targetY = null;
    } else {
      const dx = state.globeRotation.targetX - state.globeRotation.x;
      let dy = state.globeRotation.targetY - state.globeRotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      state.globeRotation.x += dx * 0.14;
      state.globeRotation.y += dy * 0.14;
      if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) {
        state.globeRotation.x = state.globeRotation.targetX;
        state.globeRotation.y = state.globeRotation.targetY;
        state.globeRotation.targetX = null;
        state.globeRotation.targetY = null;
      }
    }
  }

  if (coordsReadout) {
    const latCenter = (-state.globeRotation.x * 180) / Math.PI;
    let lonCenter = ((state.globeRotation.y * 180) / Math.PI) % 360;
    if (lonCenter > 180) lonCenter -= 360;
    if (lonCenter < -180) lonCenter += 360;
    coordsReadout.innerText = `lat: ${latCenter >= 0 ? '+' : ''}${latCenter.toFixed(1)}°, lon: ${lonCenter >= 0 ? '+' : ''}${lonCenter.toFixed(1)}°`;
  }

  state.camera.x += (state.camera.targetX - state.camera.x) * 0.12;
  state.camera.y += (state.camera.targetY - state.camera.y) * 0.12;
  state.camera.scale += (state.camera.targetScale - state.camera.scale) * 0.12;

  const views = bridge.getViews();
  renderer.render(bridge, views, state);

  requestAnimationFrame(mainLoop);
}

boot();

