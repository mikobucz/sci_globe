import test from 'node:test';
import assert from 'node:assert/strict';
import { SimBridge } from '../public/js/wasm_loader.js';

function makeFrameBuffers(count, seed = 1) {
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sz = new Float32Array(count);
  const r = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = seed + i;
    y[i] = seed * 2 + i;
    sx[i] = 0.1 * (i + 1);
    sy[i] = 0.2 * (i + 1);
    sz[i] = 0.3 * (i + 1);
    r[i] = 5 + i;
  }
  return { x, y, sx, sy, sz, r };
}

function installMockWorker() {
  const originalWorker = globalThis.Worker;
  const instances = [];

  class MockWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.onmessage = null;
      this.onerror = null;
      this.posted = [];
      this.terminated = false;
      instances.push(this);
    }

    postMessage(msg, transfer = []) {
      this.posted.push({ msg, transfer });
      if (msg && msg.type === 'init') {
        queueMicrotask(() => {
          if (!this.terminated && this.onmessage) {
            this.onmessage({ data: { type: 'ready' } });
          }
        });
      }
    }

    emitFrame({ count = 3, temp = 0.5, fromStep = false, seed = 1 } = {}) {
      const bufs = makeFrameBuffers(count, seed);
      if (this.onmessage) {
        this.onmessage({
          data: {
            type: 'frame',
            temp,
            count,
            fromStep,
            ...bufs,
          },
        });
      }
      return bufs;
    }

    terminate() {
      this.terminated = true;
    }
  }

  globalThis.Worker = MockWorker;
  return {
    instances,
    restore() {
      globalThis.Worker = originalWorker;
    },
  };
}

test('SimBridge requestStep gates overlapping steps with stepInFlight', async (t) => {
  const mock = installMockWorker();
  t.after(() => mock.restore());

  const bridge = new SimBridge();
  await bridge.initialize();
  assert.equal(bridge.useWorker, true);
  assert.equal(mock.instances.length, 1);

  const worker = mock.instances[0];
  worker.emitFrame({ count: 3, temp: 0.8, fromStep: false });

  // First requestStep should send a step message
  assert.equal(bridge.requestStep(2), true);
  assert.equal(bridge.stepInFlight, true);
  const stepMsgs1 = worker.posted.filter((p) => p.msg.type === 'step');
  assert.equal(stepMsgs1.length, 1);
  assert.equal(stepMsgs1[0].msg.simSpeed, 2);

  // Overlapping requestStep while in flight must be gated
  assert.equal(bridge.requestStep(2), false);
  assert.equal(worker.posted.filter((p) => p.msg.type === 'step').length, 1);

  // Non-step frame must not clear stepInFlight
  worker.emitFrame({ count: 3, temp: 0.7, fromStep: false });
  assert.equal(bridge.stepInFlight, true);
  assert.equal(bridge.requestStep(2), false);

  // Step frame clears stepInFlight and records temp + hasStepResult
  worker.emitFrame({ count: 3, temp: 0.002, fromStep: true });
  assert.equal(bridge.stepInFlight, false);
  assert.equal(bridge.hasStepResult, true);
  assert.equal(bridge.lastTemp, 0.002);

  // Now another step can be requested
  assert.equal(bridge.requestStep(3), true);
  assert.equal(worker.posted.filter((p) => p.msg.type === 'step').length, 2);
});

test('SimBridge recycles previous views buffers back to worker on next requestStep', async (t) => {
  const mock = installMockWorker();
  t.after(() => mock.restore());

  const bridge = new SimBridge();
  await bridge.initialize();
  const worker = mock.instances[0];

  // Frame A arrives
  const frameA = worker.emitFrame({ count: 4, temp: 0.9, fromStep: false, seed: 10 });
  // Frame B arrives -> Frame A's buffers should be queued for recycling
  const frameB = worker.emitFrame({ count: 4, temp: 0.5, fromStep: true, seed: 20 });

  assert.equal(bridge.requestStep(1), true);
  const stepCall = worker.posted.find((p) => p.msg.type === 'step');
  assert.ok(stepCall);
  assert.ok(stepCall.msg.buffers);
  assert.equal(stepCall.msg.buffers.x, frameA.x);
  assert.equal(stepCall.msg.buffers.y, frameA.y);
  assert.equal(stepCall.msg.buffers.sx, frameA.sx);
  assert.equal(stepCall.msg.buffers.sy, frameA.sy);
  assert.equal(stepCall.msg.buffers.sz, frameA.sz);
  assert.equal(stepCall.msg.buffers.r, frameA.r);
  assert.deepEqual(stepCall.transfer, [
    frameA.x.buffer,
    frameA.y.buffer,
    frameA.sx.buffer,
    frameA.sy.buffer,
    frameA.sz.buffer,
    frameA.r.buffer,
  ]);

  // Frame C arrives -> Frame B's buffers should be queued for the next step
  worker.emitFrame({ count: 4, temp: 0.3, fromStep: true, seed: 30 });
  assert.equal(bridge.requestStep(1), true);
  const stepCalls = worker.posted.filter((p) => p.msg.type === 'step');
  assert.equal(stepCalls.length, 2);
  assert.equal(stepCalls[1].msg.buffers.x, frameB.x);
  assert.deepEqual(stepCalls[1].transfer, [
    frameB.x.buffer,
    frameB.y.buffer,
    frameB.sx.buffer,
    frameB.sy.buffer,
    frameB.sz.buffer,
    frameB.r.buffer,
  ]);
});

test('SimBridge moveNode3d updates main-thread views immediately and forwards to worker', async (t) => {
  const mock = installMockWorker();
  t.after(() => mock.restore());

  const bridge = new SimBridge();
  await bridge.initialize();
  const worker = mock.instances[0];

  worker.emitFrame({ count: 3, temp: 0.5, fromStep: false });

  bridge.moveNode3d(1, 0.25, -0.5, 0.75);

  const views = bridge.getViews();
  assert.equal(views.sx[1], Math.fround(0.25));
  assert.equal(views.sy[1], Math.fround(-0.5));
  assert.equal(views.sz[1], Math.fround(0.75));

  const moveMsgs = worker.posted.filter((p) => p.msg.type === 'move_node_3d');
  assert.equal(moveMsgs.length, 1);
  assert.deepEqual(moveMsgs[0].msg, {
    type: 'move_node_3d',
    idx: 1,
    sx: 0.25,
    sy: -0.5,
    sz: 0.75,
  });
});

test('SimBridge getViews returns stable cached views reference between frames', async (t) => {
  const mock = installMockWorker();
  t.after(() => mock.restore());

  const bridge = new SimBridge();
  await bridge.initialize();
  const worker = mock.instances[0];

  worker.emitFrame({ count: 5, temp: 0.4, fromStep: false });

  const v1 = bridge.getViews();
  const v2 = bridge.getViews();
  assert.equal(v1, v2);
  assert.equal(v1.x, v2.x);
  assert.equal(v1.sx, v2.sx);
  assert.equal(v1.count, 5);
});
