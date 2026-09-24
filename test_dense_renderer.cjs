'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;

class EventTargetStub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  dispatch(type, init = {}) {
    const event = { key: '', shiftKey: false, pointerId: 1, clientX: 0, clientY: 0, deltaY: 0,
      preventDefault() { this.defaultPrevented = true; }, ...init };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

function canvasContext() {
  const calls = Object.create(null);
  const methods = ['setTransform', 'fillRect', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo',
    'quadraticCurveTo', 'setLineDash', 'fillText'];
  const context = { measureText: text => ({ width: Array.from(String(text)).length * 7 }) };
  methods.forEach(name => { context[name] = () => { calls[name] = (calls[name] || 0) + 1; }; });
  context.calls = calls;
  return context;
}

class CanvasStub extends EventTargetStub {
  constructor() {
    super(); this.style = {}; this.attributes = new Map(); this.context = canvasContext(); this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 760 }; }
  setPointerCapture() {}
}

class ContainerStub {
  constructor() { this.clientWidth = 1200; this.clientHeight = 760; this.child = null; }
  appendChild(child) { this.child = child; child.parentNode = this; }
  removeChild(child) { assert.equal(child, this.child); child.parentNode = null; this.child = null; }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
}

function installDom() {
  let id = 0;
  const frames = new Map();
  const windowTarget = new EventTargetStub();
  global.window = global;
  global.devicePixelRatio = 2;
  global.addEventListener = windowTarget.addEventListener.bind(windowTarget);
  global.removeEventListener = windowTarget.removeEventListener.bind(windowTarget);
  global.document = { createElement: tag => { assert.equal(tag, 'canvas'); return new CanvasStub(); } };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.requestAnimationFrame = callback => { const next = ++id; frames.set(next, callback); return next; };
  global.cancelAnimationFrame = frame => frames.delete(frame);
  return {
    flush(limit = 200) {
      let count = 0;
      while (frames.size && count < limit) {
        const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(Date.now())); count += 1;
      }
      assert.ok(count < limit, `dense renderer did not settle within ${limit} frames`);
      return count;
    }
  };
}

function visible(view, node) {
  const x = node.x * view.camera.zoom + view.camera.x;
  const y = node.y * view.camera.zoom + view.camera.y;
  const radius = node.r * view.camera.zoom;
  return x - radius >= -0.01 && x + radius <= view.width + 0.01
    && y - radius >= -0.01 && y + radius <= view.height + 0.01;
}

const scheduler = installDom();
const model = require(path.join(ROOT, 'graph-model.js'));
require(path.join(ROOT, 'graph-view.js'));

const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'graph.json'), 'utf8'));
const filtered = model.create(graph).filter({ relations: ['科目', '候选考点'] });
assert.ok(filtered.questions.length >= 1500, 'real dense fixture should contain the extracted question corpus');

const selections = [];
const container = new ContainerStub();
const view = new global.LawGraphView(container, {
  presentation: 'dense',
  onSelect: selection => selections.push(selection)
});
view.setData(filtered);
const layoutFrames = scheduler.flush();

assert.equal(view.presentation, 'dense');
assert.equal(view.nodes.length, filtered.nodes.length);
assert.equal(view.edges.length, filtered.edges.length);
assert.ok(container.child.context.calls.quadraticCurveTo > 1000, 'dense relationship web should draw curved edges');

const questions = view.nodes.filter(node => node.label === 'Question');
const primary = view.nodes.filter(node => node.label !== 'Question');
assert.ok(primary.every(node => visible(view, node)), 'initial fit should keep all non-question nodes visible');

const xs = questions.map(node => node.x), ys = questions.map(node => node.y);
const spreadX = Math.max(...xs) - Math.min(...xs);
const spreadY = Math.max(...ys) - Math.min(...ys);
assert.ok(spreadX > spreadY * 1.7, `dense cloud should be horizontal (${spreadX.toFixed(1)} x ${spreadY.toFixed(1)})`);
assert.ok(spreadX < spreadY * 3.6, 'dense cloud should remain organic rather than flatten into a line');

const visibleLabels = view._labelNodes(view._selectionSets());
const visibleQuestionLabels = visibleLabels.filter(node => node.label === 'Question');
assert.ok(visibleQuestionLabels.length >= 200,
  `initial dense view should expose at least 200 question labels, got ${visibleQuestionLabels.length}`);
assert.ok(visibleLabels.length <= 1100, 'label cap should protect interaction performance');

const labelRegion = view._denseLabelRegions.find(region => region.node.label === 'Question' && region.r - region.l > 20);
assert.ok(labelRegion, 'dense renderer should cache clickable text rectangles');
const labelClick = { clientX: labelRegion.r - 1, clientY: (labelRegion.t + labelRegion.b) / 2, pointerId: 9 };
container.child.dispatch('pointerdown', labelClick);
container.child.dispatch('pointerup', labelClick);
assert.equal(view.selected.item, labelRegion.node, 'clicking rendered question text should select its node');
assert.equal(selections.at(-1).data.uuid, labelRegion.node.id, 'label click should use the normal selection callback');

const readable = visibleQuestionLabels.find(node => /[\u3400-\u9fff]{12}/.test(String(node.original.summary || '')));
assert.ok(readable, 'real corpus should contain a readable Chinese question summary');
assert.ok(readable.displayName.length <= 19, 'question label should be truncated to 18 characters plus ellipsis');
assert.doesNotMatch(readable.displayName, /\r|\n|\t/, 'question label should be a single clean line');

const suspiciousContainer = new ContainerStub();
const suspiciousView = new global.LawGraphView(suspiciousContainer, { presentation: 'dense' });
suspiciousView.setData({ nodes: [{ uuid: 'bad', name: '2020 基础·01', labels: ['Question'],
  summary: 'abcdefg hijklmnop qrstuvwxyz', attributes: { subject: '待核对' } }], edges: [] });
scheduler.flush();
assert.match(suspiciousView.nodes[0].displayName, /待核对/, 'Latin-heavy extraction noise should not become a hero label');
suspiciousView.destroy();

const selected = visibleQuestionLabels[0];
assert.equal(view.select(selected.id), true, 'dense node selection should remain available');
assert.equal(selections.at(-1).data.uuid, selected.id);
const selectedLabels = view._labelNodes(view._selectionSets());
assert.equal(selectedLabels[0], selected, 'selected label should reserve layout space before its neighbours');

const beforeZoom = view.camera.zoom;
const selectedScreen = {
  x: selected.x * view.camera.zoom + view.camera.x,
  y: selected.y * view.camera.zoom + view.camera.y
};
container.child.dispatch('wheel', { clientX: selectedScreen.x, clientY: selectedScreen.y, deltaY: -220 });
assert.ok(view.camera.zoom > beforeZoom, 'wheel interaction should zoom dense graph');
const zoomedLabels = view._labelNodes(view._selectionSets());
assert.ok(zoomedLabels.includes(selected), 'selected label should survive zoom-layer changes');

view.selected = null;
view.fit();
const svg = view.exportSVG();
assert.match(svg, /fill="#ffffff"/, 'dense export should use a clean white background');
assert.doesNotMatch(svg, /id="dots"/, 'dense export should not use the classic dotted backdrop');
assert.match(svg, new RegExp(readable.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  'dense SVG should export the same shortened question labels as Canvas');

const snapshot = path.join(ROOT, 'snapshots', '密集关系网.svg');
fs.mkdirSync(path.dirname(snapshot), { recursive: true });
fs.writeFileSync(snapshot, svg, 'utf8');
assert.ok(fs.statSync(snapshot).size > 300000, 'real dense SVG snapshot should contain the complete relationship web');

const report = {
  ok: true,
  presentation: view.presentation,
  nodes: view.nodes.length,
  questions: questions.length,
  edges: view.edges.length,
  layoutFrames,
  spread: { width: Math.round(spreadX), height: Math.round(spreadY) },
  initialVisibleLabels: visibleLabels.length,
  initialVisibleQuestionLabels: visibleQuestionLabels.length,
  snapshot,
  svgBytes: Buffer.byteLength(svg)
};
view.destroy();
console.log(JSON.stringify(report, null, 2));
